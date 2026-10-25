// Chapter marks inside one long M4B / M4A file (the "chpl" list most audiobook tools write).
// Only the few boxes on the way to it are read, with small ranged requests — never the
// whole file. Remembered per book. Gives single-file books a chapter list, "end of
// chapter" for the sleep timer and "next chapter" by voice.
import { persisted } from './store.js';

const known = persisted('m4bChapters', {}); // uid -> [{ title, start, end }] (or [] when none)

const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u64 = (b, i) => u32(b, i) * 2 ** 32 + u32(b, i + 4);
const type = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

async function range(url, headers, from, n) {
  const res = await fetch(url, { headers: { ...(headers || {}), Range: `bytes=${from}-${from + n - 1}` } });
  // A server that ignores Range would send the whole file: give up rather than download it.
  if (res.status !== 206) throw new Error('no ranges');
  return new Uint8Array(await res.arrayBuffer());
}

/** The boxes inside [from, to): finds the first of `want`, reading only box headers. */
async function find(url, headers, from, to, want) {
  let pos = from;
  for (let i = 0; i < 64 && pos + 8 <= to; i++) {
    const h = await range(url, headers, pos, 16);
    let size = u32(h, 0);
    const t = type(h, 4);
    let head = 8;
    if (size === 1) (size = u64(h, 8)), (head = 16);
    else if (size === 0) size = to - pos;
    if (size < head) return null;
    if (t === want) return { pos, size, head };
    pos += size;
  }
  return null;
}

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

/** The chapters of one remote audio file, or [] (none, or the server can't do ranges). */
export async function m4bChapters(uid, url, headers, duration = 0) {
  const have = known.get()[uid];
  if (have) return have;
  let list = [];
  try {
    const moov = await find(url, headers, 0, Infinity, 'moov');
    if (moov) {
      const end = moov.pos + moov.size;
      const udta = await find(url, headers, moov.pos + moov.head, end, 'udta');
      const chpl = udta && (await find(url, headers, udta.pos + udta.head, udta.pos + udta.size, 'chpl'));
      if (chpl && chpl.size < 256 * 1024) {
        const marks = parseChpl(await range(url, headers, chpl.pos + chpl.head, chpl.size - chpl.head));
        list = marks.map((c, k) => ({ title: c.title, start: c.start, end: marks[k + 1]?.start ?? (duration || null) }));
      }
    }
  } catch {
    return []; // not remembered: maybe next time (a fresh link)
  }
  known.set((all) => {
    const keys = Object.keys(all);
    const next = keys.length > 300 ? Object.fromEntries(keys.slice(-200).map((k) => [k, all[k]])) : { ...all };
    next[uid] = list.length > 1 ? list : [];
    return next;
  });
  return list.length > 1 ? list : [];
}
