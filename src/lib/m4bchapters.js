// Chapters for a book that is one long audio file. Read from the file itself, with small
// ranged requests (never the whole file):
//  - M4B / M4A: the "chpl" list, or the QuickTime chapter track (what most converters write)
//  - MP3: ID3 "CHAP" frames
// With none inside, the book's published chapter list (Audible's, through Audnexus) is
// used, fitted to this file's length. Remembered per book. Gives single-file books a
// chapter list, "end of chapter" for the sleep timer and "next chapter" by voice.
import { persisted } from './store.js';

const known = persisted('m4bChapters2', {}); // uid -> [{ title, start, end }] (or [] when none)
const missAt = persisted('m4bChapterMiss', {}); // uid -> when none were found (looked at again later)

const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u64 = (b, i) => u32(b, i) * 2 ** 32 + u32(b, i + 4);
const type = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

/** Reads parts of a remote file in 64 KB blocks (several small reads share one request). */
function reader(url, headers) {
  const BLOCK = 64 * 1024;
  const blocks = new Map();
  let requests = 0;
  const block = async (n) => {
    if (!blocks.has(n)) {
      if (++requests > 80) throw new Error('too many reads');
      const from = n * BLOCK;
      const res = await fetch(url, { headers: { ...(headers || {}), Range: `bytes=${from}-${from + BLOCK - 1}` } });
      // A server that ignores Range would send the whole file: give up rather than download it.
      if (res.status !== 206) throw new Error('no ranges');
      blocks.set(n, new Uint8Array(await res.arrayBuffer()));
    }
    return blocks.get(n);
  };
  return async (from, n) => {
    const out = new Uint8Array(n);
    let got = 0;
    while (got < n) {
      const pos = from + got;
      const b = await block(Math.floor(pos / BLOCK));
      const at = pos % BLOCK;
      const take = Math.min(n - got, b.length - at);
      if (take <= 0) break; // end of file
      out.set(b.subarray(at, at + take), got);
      got += take;
    }
    return got === n ? out : out.subarray(0, got);
  };
}

/** The boxes directly inside [from, to): [{ type, pos, size, head }]. */
async function boxes(read, from, to, max = 64) {
  const out = [];
  let pos = from;
  while (out.length < max && pos + 8 <= to) {
    const h = await read(pos, 16);
    if (h.length < 8) break;
    let size = u32(h, 0);
    let head = 8;
    if (size === 1) (size = u64(h, 8)), (head = 16);
    else if (size === 0) size = to - pos;
    if (size < head) break;
    out.push({ type: type(h, 4), pos, size, head });
    pos += size;
  }
  return out;
}
const child = async (read, box, want) => (await boxes(read, box.pos + box.head, box.pos + box.size)).find((b) => b.type === want) || null;
const body = (read, box) => read(box.pos + box.head, box.size - box.head);

/** Parse a chpl box: [{ title, start }] in seconds. */
export function parseChpl(b) {
  let i = 0;
  const version = b[i];
  i += 4; // version + flags
  if (version) i += 4;
  const n = b[i++];
  const out = [];
  const dec = new TextDecoder();
  for (let k = 0; k < n && i + 9 <= b.length; k++) {
    const start = u64(b, i) / 1e7;
    const len = b[i + 8];
    const title = dec.decode(b.subarray(i + 9, i + 9 + len)).trim();
    out.push({ title: title || `Chapter ${k + 1}`, start });
    i += 9 + len;
  }
  return out;
}

/** The QuickTime chapter track (a text track of chapter names with their times). */
async function chapterTrack(read, moov) {
  for (const trak of (await boxes(read, moov.pos + moov.head, moov.pos + moov.size)).filter((b) => b.type === 'trak')) {
    const mdia = await child(read, trak, 'mdia');
    const hdlr = mdia && (await child(read, mdia, 'hdlr'));
    if (!hdlr) continue;
    const h = await body(read, hdlr);
    if (!['text', 'sbtl'].includes(type(h, 8))) continue;
    const mdhd = await body(read, await child(read, mdia, 'mdhd'));
    const scale = mdhd[0] === 1 ? u32(mdhd, 20) : u32(mdhd, 12);
    const minf = await child(read, mdia, 'minf');
    const stbl = minf && (await child(read, minf, 'stbl'));
    if (!stbl || !scale) continue;
    const parts = {};
    for (const b of await boxes(read, stbl.pos + stbl.head, stbl.pos + stbl.size)) {
      if (['stts', 'stsz', 'stsc', 'stco', 'co64'].includes(b.type) && b.size < 512 * 1024) parts[b.type] = await body(read, b);
    }
    const { stts, stsz, stsc } = parts;
    const co = parts.stco || parts.co64;
    if (!stts || !stsz || !stsc || !co) continue;
    // Sample start times.
    const times = [];
    let t = 0;
    for (let k = 0, n = u32(stts, 4); k < n; k++) {
      const count = u32(stts, 8 + k * 8);
      const delta = u32(stts, 12 + k * 8);
      for (let j = 0; j < count && times.length < 2000; j++) times.push(t / scale), (t += delta);
    }
    // Sample sizes and file offsets (chunks hold runs of samples).
    const fixed = u32(stsz, 4);
    const count = Math.min(u32(stsz, 8), times.length);
    const size = (k) => (fixed || u32(stsz, 12 + k * 4));
    const chunks = u32(co, 4);
    const chunkAt = (c) => (parts.co64 ? u64(co, 8 + c * 8) : u32(co, 8 + c * 4));
    const runs = [];
    for (let k = 0, n = u32(stsc, 4); k < n; k++) runs.push({ first: u32(stsc, 8 + k * 12) - 1, per: u32(stsc, 12 + k * 12) });
    const offsets = [];
    for (let c = 0, s = 0; c < chunks && s < count; c++) {
      const run = [...runs].reverse().find((r) => r.first <= c);
      let at = chunkAt(c);
      for (let j = 0; j < (run?.per || 1) && s < count; j++, s++) offsets.push(at), (at += size(s));
    }
    const out = [];
    for (let k = 0; k < offsets.length; k++) {
      const s = await read(offsets[k], Math.min(size(k), 512));
      const len = u16(s, 0);
      let title = '';
      const raw = s.subarray(2, 2 + len);
      if (raw[0] === 0xfe && raw[1] === 0xff) title = new TextDecoder('utf-16be').decode(raw.subarray(2));
      else if (raw[0] === 0xff && raw[1] === 0xfe) title = new TextDecoder('utf-16le').decode(raw.subarray(2));
      else title = new TextDecoder().decode(raw);
      out.push({ title: title.trim() || `Chapter ${k + 1}`, start: times[k] });
    }
    if (out.length > 1) return out;
  }
  return [];
}

async function mp4Chapters(read) {
  const moov = (await boxes(read, 0, Infinity)).find((b) => b.type === 'moov');
  if (!moov) return [];
  const udta = await child(read, moov, 'udta');
  const chpl = udta && (await child(read, udta, 'chpl'));
  if (chpl && chpl.size < 256 * 1024) {
    const list = parseChpl(await body(read, chpl));
    if (list.length > 1) return list;
  }
  return chapterTrack(read, moov);
}

/** ID3v2 CHAP frames at the start of an MP3. */
async function mp3Chapters(read) {
  const h = await read(0, 10);
  if (type(h, 0).slice(0, 3) !== 'ID3') return [];
  const v = h[3];
  const synch = (b, i) => (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3];
  const size = synch(h, 6);
  if (size > 8 * 1024 * 1024) return [];
  const tag = await read(10, size);
  const text = (b) => {
    const enc = b[0];
    const s = b.subarray(1);
    const dec = enc === 1 || enc === 2 ? new TextDecoder(enc === 2 ? 'utf-16be' : 'utf-16') : new TextDecoder(enc === 3 ? 'utf-8' : 'latin1');
    return dec.decode(s).replace(/\0+$/, '').trim();
  };
  const frames = (b, from, to) => {
    const out = [];
    for (let i = from; i + 10 <= to; ) {
      const id = type(b, i);
      const len = v === 4 ? synch(b, i + 4) : u32(b, i + 4);
      if (!/^[A-Z0-9]{4}$/.test(id) || len <= 0 || i + 10 + len > to) break;
      out.push({ id, data: b.subarray(i + 10, i + 10 + len) });
      i += 10 + len;
    }
    return out;
  };
  const list = [];
  for (const f of frames(tag, 0, tag.length)) {
    if (f.id !== 'CHAP') continue;
    const d = f.data;
    const z = d.indexOf(0);
    if (z < 0) continue;
    const start = u32(d, z + 1) / 1000;
    const sub = frames(d, z + 17, d.length).find((x) => x.id === 'TIT2');
    list.push({ title: (sub && text(sub.data)) || '', start });
  }
  return list.sort((a, b) => a.start - b.start).map((c, k) => ({ ...c, title: c.title || `Chapter ${k + 1}` }));
}

/** The book's published chapters (Audible, through Audnexus), fitted to this file's length. */
async function publishedChapters(book, getDuration) {
  if (!book?.title) return [];
  // The file's own length (known once it starts playing) — not the catalogue's.
  let duration = 0;
  for (let i = 0; i < 30 && !(duration = getDuration()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!duration) throw new Error('length unknown'); // tried again next time
  const { mainTitle } = await import('./match.js');
  const title = mainTitle(book.title);
  const author = String(book.author || '').split(',')[0].trim();
  // Candidates: this book's own Audible id, then Audible's editions of it — the one whose
  // length matches this file (another edition, abridged or another narrator, would put the
  // chapters in the wrong places).
  const asins = [];
  if (book.uid?.startsWith('au:')) asins.push({ asin: book.uid.slice(3), min: 0 });
  for (const kw of [`${title} ${author}`.trim(), title]) {
    if (asins.length > 6) break;
    try {
      const res = await fetch('https://api.audible.com/1.0/catalog/products?' + new URLSearchParams({ keywords: kw, num_results: '8', products_sort_by: 'Relevance', response_groups: 'product_attrs' }));
      const d = res.ok ? await res.json() : {};
      for (const p of d.products || []) if (p.asin && !asins.some((x) => x.asin === p.asin)) asins.push({ asin: p.asin, min: p.runtime_length_min || 0 });
    } catch {}
  }
  const close = (min) => !min || Math.abs(1 - duration / (min * 60)) <= 0.08;
  const ranked = asins.filter((x) => close(x.min)).sort((x, y) => Math.abs(duration - x.min * 60) - Math.abs(duration - y.min * 60));
  for (const { asin } of ranked.slice(0, 4)) {
    const res = await fetch(`https://api.audnex.us/books/${asin}/chapters`).catch(() => null);
    if (!res?.ok) continue;
    const d = await res.json().catch(() => null);
    const flat = [];
    const walk = (list) => (list || []).forEach((c) => (flat.push(c), walk(c.chapters)));
    walk(d?.chapters);
    const total = (d?.runtimeLengthMs || flat.reduce((a, c) => a + (c.lengthMs || 0), 0)) / 1000;
    if (flat.length < 2 || !total) continue;
    const k = duration / total;
    if (Math.abs(1 - k) > 0.08) continue; // another edition
    return flat.map((c, i) => ({ title: c.title || `Chapter ${i + 1}`, start: ((c.startOffsetMs || 0) / 1000) * k, published: true }));
  }
  return [];
}

/** The chapters of one remote audio file, or [] (none found). `book` gives the published list. */
export async function m4bChapters(uid, url, headers, duration = 0, book = null) {
  const getDuration = typeof duration === 'function' ? duration : () => duration;
  const have = known.get()[uid];
  // A book that had none: looked at again after a day (the lookup can fail for a moment).
  if (have && (have.length || Date.now() - (missAt.get()[uid] || 0) < 864e5)) return have;
  let list = [];
  let failed = false;
  let why = '';
  try {
    const read = reader(url, headers);
    const head = await read(0, 12);
    list = type(head, 0).startsWith('ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) ? await mp3Chapters(read) : type(head, 4) === 'ftyp' ? await mp4Chapters(read) : [];
  } catch (e) {
    failed = true; // maybe next time (a fresh link)
    why = `file: ${e?.message || e}`;
  }
  if (list.length < 2)
    list = await publishedChapters(book, getDuration).catch((e) => {
      failed = true;
      why += ` · published: ${e?.message || e}`;
      return [];
    });
  if (list.length < 2) import('./report.js').then((m) => m.logError('chapters', `${book?.title || uid}: none found${why ? ` (${why})` : ''}`)).catch(() => {});
  if (list.length < 2 && (failed || !getDuration())) return [];
  list = list.length > 1 ? list.map((c, k) => ({ title: c.title, start: c.start, end: list[k + 1]?.start ?? (getDuration() || null), ...(c.published ? { published: true, estimated: true } : {}) })) : [];
  known.set((all) => {
    const keys = Object.keys(all);
    const next = keys.length > 300 ? Object.fromEntries(keys.slice(-200).map((k) => [k, all[k]])) : { ...all };
    next[uid] = list;
    return next;
  });
  if (!list.length) missAt.set((m) => ({ ...m, [uid]: Date.now() }));
  return list;
}
