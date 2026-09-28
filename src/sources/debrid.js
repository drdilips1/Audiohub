// Debrid cloud libraries — stream the audiobooks already sitting in your
// TorBox or Real-Debrid account, and add new magnets / links to it.
import { getJson, sendForm, qs } from '../lib/http.js';
import { debrid } from '../lib/store.js';
import { matches } from '../lib/match.js';

const AUDIO = /\.(mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav|wma|mka|mp4a)$/i;
// Ebook files in the cloud: EPUB opens in the app's reader; the rest go to Kindle or another app.
export const EBOOK = /\.(epub|pdf|mobi|azw3?|fb2|djvu|cbz|cbr)$/i;
const fmtOf = (name) => (EBOOK.exec(name)?.[1] || '').toUpperCase();
const TB = 'https://api.torbox.app/v1/api';
const RD = 'https://api.real-debrid.com/rest/1.0';

const tbKey = () => debrid.get().torbox.trim();
const rdKey = () => debrid.get().realdebrid.trim();
export const tbConnected = () => !!tbKey();
export const rdConnected = () => !!rdKey();

const naturalSort = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const baseName = (p) => String(p).split('/').pop();

// "Author - Title (Unabridged) [64kbps] {MP3}" -> "Author - Title"
export function cleanTitle(name) {
  return String(name)
    .replace(/\.(zip|rar|7z|m4b|mp3|epub|pdf|mobi|azw3?)$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/[\[({][^\])}]*[\])}]/g, ' ')
    .replace(/\b(unabridged|abridged|audiobook|audio ?book|\d{2,3} ?kbps|mp3|m4b|aac|flac|retail|vbr|cbr|epub|pdf|mobi|azw3|ebook)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–]+|[\s\-–]+$/g, '')
    .trim() || String(name);
}

function splitAuthor(title) {
  const m = /^(.+?)\s[-–]\s(.+)$/.exec(title);
  return m && m[1].length < 40 ? { author: m[1], title: m[2] } : { author: '', title };
}

function toBook(prefix, source, id, name, files, extra = {}) {
  const clean = cleanTitle(name);
  const { author, title } = splitAuthor(clean);
  return {
    uid: `${prefix}:${id}`,
    source,
    kind: 'audio',
    title,
    author,
    cover: '',
    rawName: name,
    parts: files.length,
    ...extra,
  };
}

// ---------------- TorBox ----------------
const tbHeaders = () => ({ Authorization: `Bearer ${tbKey()}` });

// TorBox answers much faster from its own cache; skip it only right after something
// changed (you added an item in the app, or pulled to refresh).
let tbStale = false;
async function tbList(kind, bypass = tbStale) {
  const data = await getJson(`${TB}/${kind}/mylist${bypass ? '?bypass_cache=true' : ''}`, { headers: tbHeaders(), fresh: true });
  return Array.isArray(data?.data) ? data.data : [];
}

const TB_KINDS = [
  ['torrents', 't', 'torrent_id'],
  ['usenet', 'u', 'usenet_id'],
  ['webdl', 'w', 'web_id'],
];

const memo = {};
const remember = (key, fn) => {
  const hit = memo[key];
  if (hit && Date.now() - hit.t < 60e3) return hit.p;
  const p = fn().catch((e) => {
    delete memo[key];
    throw e;
  });
  memo[key] = { t: Date.now(), p };
  return p;
};
export const forget = () => {
  Object.keys(memo).forEach((k) => delete memo[k]);
  tbStale = true;
};

export const torboxLibrary = () => (tbConnected() ? remember('tb', torboxLibraryRaw) : Promise.resolve([]));
export const realdebridLibrary = () => (rdConnected() ? remember('rd', realdebridLibraryRaw) : Promise.resolve([]));

async function torboxLibraryRaw() {
  const bypass = tbStale;
  const lists = await Promise.all(TB_KINDS.map(([k]) => tbList(k, bypass).catch(() => [])));
  tbStale = false;
  const out = [];
  lists.forEach((items, i) => {
    const [, code] = TB_KINDS[i];
    for (const it of items) {
      const files = (it.files || []).filter((f) => AUDIO.test(f.name || f.short_name || ''));
      const ebooks = files.length ? [] : (it.files || []).filter((f) => EBOOK.test(f.name || f.short_name || ''));
      if (!files.length && !ebooks.length) continue;
      const done = code !== 't' || !!(it.download_finished || it.download_present);
      const b = toBook('tb', 'tb', `${code}:${it.id}`, it.name, files.length ? files : ebooks, code === 't' && it.hash ? { hash: String(it.hash).toLowerCase() } : {});
      if (!files.length) Object.assign(b, { kind: 'text', format: fmtOf(ebooks[0].name || ebooks[0].short_name || '') });
      out.push({ ...b, addedAt: Date.parse(it.created_at) || 0, ...(done ? {} : { fetching: Number(it.progress) || 0 }) });
    }
  });
  return out.sort((a, b) => b.addedAt - a.addedAt);
}

// Items prepareMagnet just fetched, so opening them doesn't need another round trip.
const tbSeen = new Map();

async function tbDetails(book) {
  const [, code, id] = book.uid.split(':');
  const [kind, , param] = TB_KINDS.find(([, c]) => c === code);
  let it = tbSeen.get(`${code}:${id}`);
  tbSeen.delete(`${code}:${id}`);
  if (!it && kind === 'torrents') it = await tbOne(id);
  if (!it) it = (await tbList(kind, true)).find((x) => String(x.id) === id);
  if (!it) throw new Error('This item is no longer in your TorBox account');
  const done = code !== 't' || !!(it.download_finished || it.download_present);
  const pending = done ? null : { provider: 'torbox', hash: String(it.hash || '').toLowerCase(), progress: Number(it.progress) || 0, state: it.download_state || '' };
  const files = (it.files || [])
    .filter((f) => AUDIO.test(f.name || f.short_name || ''))
    .map((f) => ({ ...f, name: f.short_name || baseName(f.name) }))
    .sort(naturalSort);
  const tbLink = async (f) => {
    const r = await getJson(`${TB}/${kind}/requestdl?` + qs({ token: tbKey(), [param]: id, file_id: f.id, redirect: 'false' }), { fresh: true });
    if (!r?.data) throw new Error(r?.detail || 'TorBox did not return a link');
    return r.data;
  };
  const ebooks = (it.files || [])
    .filter((f) => EBOOK.test(f.name || f.short_name || ''))
    .map((f) => ({ name: f.short_name || baseName(f.name), format: fmtOf(f.short_name || f.name), size: Number(f.size) || 0, resolve: () => tbLink(f) }))
    .sort(naturalSort);
  if (!files.length && ebooks.length)
    return {
      ...book,
      kind: 'text',
      ...(code === 't' && it.hash ? { hash: String(it.hash).toLowerCase() } : {}),
      description: `${ebooks.length} ebook file${ebooks.length === 1 ? '' : 's'} in your TorBox ${kind === 'webdl' ? 'web downloads' : kind}.`,
      fetching: pending,
      tracks: [],
      ebooks,
    };
  return {
    ...book,
    ...(code === 't' && it.hash ? { hash: String(it.hash).toLowerCase() } : {}),
    description: `${files.length} audio file${files.length === 1 ? '' : 's'} in your TorBox ${kind === 'webdl' ? 'web downloads' : kind}.`,
    ebooks,
    fetching: pending,
    tracks: files.map((f, i) => ({
      title: f.name.replace(AUDIO, ''),
      index: i,
      // Download links expire, so they're requested right before playback.
      resolve: async () => {
        // Still downloading on TorBox: the link would be a partial file, so report progress instead.
        if (pending) {
          const st = await fetchStatus(book);
          if (!st.ready) throw pendingError(st);
        }
        const r = await getJson(`${TB}/${kind}/requestdl?` + qs({ token: tbKey(), [param]: id, file_id: f.id, redirect: 'false' }), { fresh: true });
        if (!r?.data) throw new Error(r?.detail || 'TorBox did not return a link');
        return r.data;
      },
    })),
  };
}

async function tbAdd(link) {
  const isMagnet = /^magnet:/i.test(link);
  const path = isMagnet ? '/torrents/createtorrent' : '/webdl/createwebdownload';
  const r = await sendForm(TB + path, 'POST', isMagnet ? { magnet: link } : { link }, tbHeaders());
  if (r && r.success === false) throw new Error(r.detail || 'TorBox rejected the link');
  return r?.detail || 'Added to TorBox';
}

/** Upload a .torrent file to TorBox. */
async function tbAddFile(file) {
  const form = new FormData();
  form.append('file', new Blob([await file.arrayBuffer()], { type: 'application/x-bittorrent' }), file.name || 'book.torrent');
  const res = await fetch(TB + '/torrents/createtorrent', { method: 'POST', headers: tbHeaders(), body: form });
  const r = await res.json().catch(() => null);
  if (!res.ok || (r && r.success === false)) throw new Error(r?.detail || `TorBox rejected the file (HTTP ${res.status})`);
  return r?.detail || 'Added to TorBox';
}

// ---------------- Real-Debrid ----------------
const rdHeaders = () => ({ Authorization: `Bearer ${rdKey()}` });

async function realdebridLibraryRaw() {
  const items = await getJson(`${RD}/torrents?limit=200`, { headers: rdHeaders(), fresh: true });
  // The list endpoint has no file names, so show finished torrents whose name looks
  // like an audiobook; the detail view filters to audio files.
  return (items || [])
    .filter((t) => t.status === 'downloaded')
    .filter((t) => AUDIO.test(t.filename) || !/\.(mkv|avi|mp4|iso|exe|apk)$/i.test(t.filename))
    .map((t) => ({ ...toBook('rd', 'rd', t.id, t.filename, t.links || [], t.hash ? { hash: String(t.hash).toLowerCase() } : {}), addedAt: Date.parse(t.added) || 0 }));
}

async function rdDetails(book) {
  const id = book.uid.slice(3);
  const info = await getJson(`${RD}/torrents/info/${id}`, { headers: rdHeaders(), fresh: true });
  // Links map 1:1 onto the selected files, in file order.
  const selected = (info.files || []).filter((f) => f.selected).sort((a, b) => a.id - b.id);
  // Fewer links than files means Real-Debrid packed them into one archive: nothing to stream.
  const packedLinks = (info.links || []).length > 0 && (info.links || []).length < selected.length;
  const linked = (packedLinks ? [] : selected).map((f, i) => ({ name: baseName(f.path), link: (info.links || [])[i], size: Number(f.bytes) || 0 }));
  const files = linked.filter((f) => f.link && AUDIO.test(f.name)).sort(naturalSort);
  const rdLink = async (f) => {
    const r = await sendForm(`${RD}/unrestrict/link`, 'POST', { link: f.link }, rdHeaders());
    if (!r?.download) throw new Error('Real-Debrid did not return a link');
    return r.download;
  };
  const ebooks = linked
    .filter((f) => f.link && EBOOK.test(f.name))
    .map((f) => ({ name: f.name, format: fmtOf(f.name), size: f.size, resolve: () => rdLink(f) }))
    .sort(naturalSort);
  if (!files.length && ebooks.length)
    return {
      ...book,
      kind: 'text',
      ...(info.hash ? { hash: String(info.hash).toLowerCase() } : {}),
      description: `${ebooks.length} ebook file${ebooks.length === 1 ? '' : 's'} in your Real-Debrid cloud.`,
      tracks: [],
      ebooks,
    };
  if (!files.length) {
    // Same book ready in TorBox? Play that copy instead.
    const hash = String(info.hash || book.hash || '').toLowerCase();
    if (hash && tbConnected()) {
      const tb = (await tbList('torrents').catch(() => [])).find((t) => String(t.hash || '').toLowerCase() === hash && (t.download_finished || t.download_present));
      if (tb) return tbDetails({ ...book, uid: `tb:t:${tb.id}`, source: 'tb', hash });
    }
    const packed = packedLinks || selected.some((f) => /\.(rar|zip|7z)$/i.test(f.path));
    // Archived on Real-Debrid: TorBox keeps the separate files, so fetch it there instead.
    if (packed && hash && tbConnected()) {
      try {
        const stub = await prepareMagnet('torbox', { hash, title: info.filename || book.title });
        return tbDetails({ ...book, uid: stub.uid, source: 'tb', hash, parts: stub.parts });
      } catch (e) {
        if (e.pending) {
          const err = new Error(`Real-Debrid packed this one into an archive, so it's being fetched from TorBox instead (${Math.round((e.pending.progress || 0) * 100)}%). Try again in a little while.`);
          err.pending = e.pending;
          throw err;
        }
        throw e;
      }
    }
    throw new Error(
      packed
        ? 'Real-Debrid packed this one into an archive (.rar/.zip), which can’t be streamed. Connect TorBox (it keeps the files separate) or add a different version.'
        : info.status && info.status !== 'downloaded'
          ? `Real-Debrid hasn’t finished this one yet (${info.status}${info.progress != null ? ` · ${info.progress}%` : ''}).`
          : 'This Real-Debrid torrent has no audio files (it may be an ebook or a video).'
    );
  }
  return {
    ...book,
    ...(info.hash ? { hash: String(info.hash).toLowerCase() } : {}),
    description: `${files.length} audio file${files.length === 1 ? '' : 's'} in your Real-Debrid cloud.`,
    ebooks,
    tracks: files.map((f, i) => ({
      title: f.name.replace(AUDIO, ''),
      index: i,
      resolve: async () => {
        const r = await sendForm(`${RD}/unrestrict/link`, 'POST', { link: f.link }, rdHeaders());
        if (!r?.download) throw new Error('Real-Debrid did not return a link');
        return r.download;
      },
    })),
  };
}

/** Upload a .torrent file to Real-Debrid, then pick all its files. */
async function rdAddFile(file) {
  const res = await fetch(`${RD}/torrents/addTorrent`, { method: 'PUT', headers: { ...rdHeaders(), 'Content-Type': 'application/x-bittorrent' }, body: new Uint8Array(await file.arrayBuffer()) });
  const r = await res.json().catch(() => null);
  if (!res.ok || !r?.id) throw new Error(r?.error ? `Real-Debrid: ${r.error}` : `Real-Debrid rejected the file (HTTP ${res.status})`);
  await sendForm(`${RD}/torrents/selectFiles/${r.id}`, 'POST', { files: 'all' }, rdHeaders()).catch(() => {});
  return 'Added to Real-Debrid';
}

/** Add a .torrent file to TorBox or Real-Debrid. */
export async function addTorrentFile(provider, file) {
  if (!file) throw new Error('No file chosen');
  if (!/\.torrent$/i.test(file.name || '') && file.type !== 'application/x-bittorrent') throw new Error('Choose a .torrent file');
  return provider === 'torbox' ? tbAddFile(file) : rdAddFile(file);
}

async function rdAdd(link) {
  if (/^magnet:/i.test(link)) {
    const r = await sendForm(`${RD}/torrents/addMagnet`, 'POST', { magnet: link }, rdHeaders());
    if (!r?.id) throw new Error('Real-Debrid rejected the magnet');
    await sendForm(`${RD}/torrents/selectFiles/${r.id}`, 'POST', { files: 'all' }, rdHeaders()).catch(() => {});
    return 'Added to Real-Debrid';
  }
  const r = await sendForm(`${RD}/unrestrict/link`, 'POST', { link }, rdHeaders());
  if (!r?.download) throw new Error('Real-Debrid could not unrestrict that link');
  return 'Link unrestricted';
}

// ---------------- shared ----------------
function pendingError(st) {
  const e = new Error(`${st.provider === 'torbox' ? 'TorBox' : 'Real-Debrid'} is still downloading this (${Math.round((st.progress || 0) * 100)}%)`);
  e.pending = st;
  return e;
}

/**
 * Live download status of a library item: { provider, ready, progress (0..1), state }.
 * Web/usenet downloads and anything we can't look up count as ready.
 */
export async function fetchStatus(book) {
  const [src, code, id] = book.uid.split(':');
  if (src === 'tb') {
    if (code !== 't') return { provider: 'torbox', ready: true, progress: 1 };
    const data = await getJson(`${TB}/torrents/mylist?` + qs({ id, bypass_cache: 'true' }), { headers: tbHeaders(), fresh: true });
    const it = Array.isArray(data?.data) ? data.data[0] : data?.data;
    if (!it) return { provider: 'torbox', ready: true, progress: 1 };
    return { provider: 'torbox', ready: !!(it.download_finished || it.download_present), progress: Number(it.progress) || 0, state: it.download_state || '', hash: String(it.hash || '').toLowerCase() };
  }
  if (src === 'rd') {
    const info = await getJson(`${RD}/torrents/info/${code}`, { headers: rdHeaders(), fresh: true });
    return { provider: 'realdebrid', ready: info.status === 'downloaded', progress: (Number(info.progress) || 0) / 100, state: info.status || '', hash: String(info.hash || '').toLowerCase() };
  }
  return { ready: true, progress: 1 };
}

export async function verify(provider, key) {
  key = key.trim();
  if (provider === 'torbox') {
    const r = await getJson(`${TB}/user/me`, { headers: { Authorization: `Bearer ${key}` }, fresh: true });
    return r?.data?.email || 'TorBox account';
  }
  const r = await getJson(`${RD}/user`, { headers: { Authorization: `Bearer ${key}` }, fresh: true });
  return `${r?.username || 'Real-Debrid'}${r?.type ? ` · ${r.type}` : ''}`;
}

export const addLink = (provider, link) => (provider === 'torbox' ? tbAdd(link.trim()) : rdAdd(link.trim()));

/**
 * Is this cloud item an audiobook (has audio files)? TorBox items already list
 * their files; Real-Debrid's list has only a name, so its file list is checked.
 * Used to keep ebooks out of auto-send to qBittorrent.
 */
export async function hasAudio(book) {
  if (book.kind === 'text' || EBOOK.test(book.rawName || '')) return false;
  if (book.uid?.startsWith('tb:')) return book.kind === 'audio';
  const info = await getJson(`${RD}/torrents/info/${book.uid.slice(3)}`, { headers: rdHeaders(), fresh: true });
  return (info.files || []).some((f) => AUDIO.test(f.path || ''));
}

export function details(book) {
  return book.uid.startsWith('tb:') ? tbDetails(book) : rdDetails(book);
}

export async function search(term) {
  const [a, b] = await Promise.all([torboxLibrary().catch(() => []), realdebridLibrary().catch(() => [])]);
  return [...a, ...b].filter((x) => matches(term, `${x.title} ${x.author} ${x.rawName || ''}`));
}

// ---------------- magnet → stream ----------------
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function base32ToHex(s) {
  let bits = '';
  for (const c of s.toLowerCase()) {
    const v = B32.indexOf(c);
    if (v < 0) return '';
    bits += v.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Info-hash (lowercase hex) from a magnet link or a raw hash. */
export function infoHash(magnet, hash) {
  let h = String(hash || '').trim();
  if (!h) h = (/xt=urn:btih:([a-z0-9]+)/i.exec(magnet || '') || [])[1] || '';
  if (/^[a-z2-7]{32}$/i.test(h)) h = base32ToHex(h);
  return /^[a-f0-9]{40}$/i.test(h) ? h.toLowerCase() : '';
}

export function magnetFor(magnet, hash, name) {
  if (magnet) return magnet;
  const h = infoHash('', hash);
  return h ? `magnet:?xt=urn:btih:${h}${name ? `&dn=${encodeURIComponent(name)}` : ''}` : '';
}

export const preferredProvider = (pref) =>
  pref === 'realdebrid' && rdConnected() ? 'realdebrid' : pref === 'torbox' && tbConnected() ? 'torbox' : tbConnected() ? 'torbox' : rdConnected() ? 'realdebrid' : null;

/** Which of these hashes TorBox can stream instantly (one batched call). */
export async function torboxCached(hashes) {
  const list = [...new Set(hashes.filter(Boolean))];
  if (!tbConnected() || !list.length) return new Set();
  try {
    const r = await getJson(`${TB}/torrents/checkcached?` + qs({ hash: list.join(','), format: 'list', list_files: 'false' }), { headers: tbHeaders() });
    const data = r?.data;
    const found = Array.isArray(data) ? data.map((d) => d.hash) : data && typeof data === 'object' ? Object.keys(data) : [];
    return new Set(found.map((h) => String(h).toLowerCase()));
  } catch {
    return new Set();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tbAudioCount = (it) => (it.files || []).filter((f) => AUDIO.test(f.name || f.short_name || '')).length;

// One torrent by id: much faster than listing the whole account.
async function tbOne(id) {
  const data = await getJson(`${TB}/torrents/mylist?` + qs({ id, bypass_cache: 'true' }), { headers: tbHeaders(), fresh: true }).catch(() => null);
  return (Array.isArray(data?.data) ? data.data[0] : data?.data) || null;
}

async function tbEnsure(magnet, hash, onStatus) {
  // The (60s-cached) account list usually already knows whether we have it.
  const items = await remember('tb-status', async () => tbList('torrents')).catch(() => []);
  let it = hash ? items.find((t) => String(t.hash || '').toLowerCase() === hash) : null;
  if (it) return (await tbOne(it.id)) || it;
  onStatus?.('Adding to TorBox…', null);
  let r;
  try {
    // TorBox can take a while to answer for torrents it doesn't have cached.
    r = await sendForm(`${TB}/torrents/createtorrent`, 'POST', { magnet }, tbHeaders(), { timeout: 60000 });
  } catch (e) {
    if (!e.timeout) throw e;
    // Slow answer, but it usually did add it: look for it before giving up.
    for (let i = 0; i < 3; i++) {
      await sleep(2000);
      const found = hash && (await tbList('torrents').catch(() => [])).find((t) => String(t.hash || '').toLowerCase() === hash);
      if (found) {
        forget();
        return (await tbOne(found.id)) || found;
      }
    }
    throw new Error('TorBox is slow to answer — it may still be adding it. Check again in a minute.');
  }
  if (r && r.success === false && !/already|duplicate/i.test(`${r.error} ${r.detail}`)) throw new Error(r.detail || 'TorBox rejected the magnet');
  forget();
  const id = r?.data?.torrent_id;
  if (id) {
    for (let i = 0; i < 6; i++) {
      it = await tbOne(id);
      if (it?.files?.length || it?.download_finished || it?.download_present) break;
      await sleep(700);
    }
    return it || { id, name: r.data.name || '', files: [] };
  }
  // Older API responses without an id: fall back to finding it by hash.
  for (let i = 0; i < 4 && !it; i++) {
    await sleep(1000);
    it = (await tbList('torrents')).find((t) => String(t.hash || '').toLowerCase() === hash);
  }
  return it;
}

async function rdEnsure(magnet, hash, onStatus) {
  const list = await getJson(`${RD}/torrents?limit=200`, { headers: rdHeaders(), fresh: true });
  let t = (list || []).find((x) => String(x.hash || '').toLowerCase() === hash);
  if (!t) {
    onStatus?.('Adding to Real-Debrid…', null);
    const r = await sendForm(`${RD}/torrents/addMagnet`, 'POST', { magnet }, rdHeaders());
    if (!r?.id) throw new Error('Real-Debrid rejected the magnet');
    t = { id: r.id };
    forget();
  }
  return t;
}

/**
 * Put a magnet into the user's debrid account (reusing it when it's already
 * there) and wait briefly until it can stream. Resolves to a book stub whose
 * details list the audio files; throws a friendly "still downloading" error
 * when the service needs more time.
 */
export async function prepareMagnet(provider, { magnet, hash, title }, onStatus) {
  const h = infoHash(magnet, hash);
  const m = magnetFor(magnet, h, title);
  if (!m) throw new Error('This result has no magnet link');

  if (provider === 'torbox') {
    let it = await tbEnsure(m, h, onStatus);
    const ready = (x) => x?.download_finished || x?.download_present;
    for (let i = 0; i < 16 && !(ready(it) && tbAudioCount(it)); i++) {
      if (!ready(it) && i >= 8) break; // really downloading: hand over to "play when ready"
      onStatus?.(ready(it) ? 'Getting the file list…' : 'TorBox is fetching it…', ready(it) ? 1 : Number(it?.progress) || 0);
      await sleep(i < 6 ? 1000 : 2500);
      it = (await tbOne(it.id)) || it;
    }
    if (!ready(it)) {
      forget();
      const e = new Error(`Downloading on TorBox (${Math.round((it?.progress || 0) * 100)}%)`);
      e.pending = { provider, hash: String(it?.hash || h).toLowerCase(), progress: Number(it?.progress) || 0 };
      throw e;
    }
    if (!tbAudioCount(it)) throw new Error('That torrent has no playable audio files');
    forget();
    tbSeen.set(`t:${it.id}`, it);
    return toBook('tb', 'tb', `t:${it.id}`, it.name || title, it.files || []);
  }

  let t = await rdEnsure(m, h, onStatus);
  for (let i = 0; i < 12; i++) {
    const info = await getJson(`${RD}/torrents/info/${t.id}`, { headers: rdHeaders(), fresh: true });
    if (info.status === 'waiting_files_selection') {
      await sendForm(`${RD}/torrents/selectFiles/${t.id}`, 'POST', { files: 'all' }, rdHeaders()).catch(() => {});
    } else if (info.status === 'downloaded') {
      forget();
      return toBook('rd', 'rd', t.id, info.filename || title, info.links || []);
    } else if (/error|dead|virus|magnet_error/.test(info.status)) {
      throw new Error(`Real-Debrid could not fetch this torrent (${info.status})`);
    }
    onStatus?.('Real-Debrid is fetching it…', (Number(info.progress) || 0) / 100);
    await sleep(i < 4 ? 1000 : 2500);
  }
  forget();
  const e = new Error('Downloading on Real-Debrid');
  e.pending = { provider, hash: h, progress: 0 };
  throw e;
}

/**
 * Direct download links for a result: puts it in the account (or reuses it),
 * waits briefly until the service has it, then lists every file with a
 * resolver for its link. TorBox can also zip the whole folder.
 * Resolves { provider, name, files: [{ name, size, resolve }], zip? }.
 */
export async function downloadLinks(provider, { magnet, hash, title }, onStatus) {
  const h = infoHash(magnet, hash);
  const m = magnetFor(magnet, h, title);
  if (!m) throw new Error('This result has no magnet link');
  if (provider === 'torbox') {
    let it = await tbEnsure(m, h, onStatus);
    const ready = (x) => x?.download_finished || x?.download_present;
    for (let i = 0; i < 10 && !ready(it); i++) {
      onStatus?.('TorBox is fetching it…', Number(it?.progress) || 0);
      await sleep(i < 5 ? 1000 : 2500);
      it = (await tbOne(it.id)) || it;
    }
    forget();
    if (!ready(it)) throw new Error(`Still downloading on TorBox (${Math.round((Number(it?.progress) || 0) * 100)}%) — links work once it's finished`);
    const link = (extra) => async () => {
      const r = await getJson(`${TB}/torrents/requestdl?` + qs({ token: tbKey(), torrent_id: it.id, redirect: 'false', ...extra }), { fresh: true });
      if (!r?.data) throw new Error(r?.detail || 'TorBox did not return a link');
      return r.data;
    };
    const files = (it.files || [])
      .map((f) => ({ name: f.short_name || baseName(f.name), size: Number(f.size) || 0, resolve: link({ file_id: f.id }) }))
      .sort(naturalSort);
    return { provider, name: it.name || title, files, zip: files.length > 1 ? link({ zip_link: 'true' }) : null };
  }
  const t = await rdEnsure(m, h, onStatus);
  for (let i = 0; i < 12; i++) {
    const info = await getJson(`${RD}/torrents/info/${t.id}`, { headers: rdHeaders(), fresh: true });
    if (info.status === 'waiting_files_selection') {
      await sendForm(`${RD}/torrents/selectFiles/${t.id}`, 'POST', { files: 'all' }, rdHeaders()).catch(() => {});
    } else if (info.status === 'downloaded') {
      forget();
      const selected = (info.files || []).filter((f) => f.selected).sort((a, b) => a.id - b.id);
      const links = info.links || [];
      // Fewer links than files: Real-Debrid packed them into archive(s).
      const rows = links.length === selected.length ? selected.map((f, i) => ({ name: baseName(f.path), size: Number(f.bytes) || 0, link: links[i] })) : links.map((l, i) => ({ name: `${info.filename || title}${links.length > 1 ? ` (part ${i + 1})` : ''} [archive]`, size: 0, link: l }));
      const files = rows
        .map((f) => ({
          name: f.name,
          size: f.size,
          resolve: async () => {
            const r = await sendForm(`${RD}/unrestrict/link`, 'POST', { link: f.link }, rdHeaders());
            if (!r?.download) throw new Error('Real-Debrid did not return a link');
            return r.download;
          },
        }))
        .sort(naturalSort);
      return { provider, name: info.filename || title, files, zip: null };
    } else if (/error|dead|virus|magnet_error/.test(info.status)) {
      throw new Error(`Real-Debrid could not fetch this torrent (${info.status})`);
    }
    onStatus?.('Real-Debrid is fetching it…', (Number(info.progress) || 0) / 100);
    await sleep(i < 4 ? 1000 : 2500);
  }
  forget();
  throw new Error('Still downloading on Real-Debrid — links work once it has finished');
}

/** Add without waiting. */
export async function addMagnetOnly(provider, { magnet, hash, title }) {
  const h = infoHash(magnet, hash);
  const m = magnetFor(magnet, h, title);
  if (!m) throw new Error('This result has no magnet link');
  if (provider === 'torbox') await tbEnsure(m, h);
  else {
    const t = await rdEnsure(m, h);
    await sendForm(`${RD}/torrents/selectFiles/${t.id}`, 'POST', { files: 'all' }, rdHeaders()).catch(() => {});
  }
  forget();
  return provider === 'torbox' ? 'Added to TorBox' : 'Added to Real-Debrid';
}

/**
 * Status of everything already in the user's debrid accounts, keyed by
 * info-hash: { provider, ready, progress (0..1), state, seeds }.
 */
// One entry per hash (TorBox first, as before) plus .both = { torbox, realdebrid }.
function setBoth(out, hash, provider, st) {
  const cur = out.get(hash);
  const both = { ...(cur?.both || {}), [provider]: st };
  out.set(hash, { ...(cur && cur.provider === 'torbox' ? cur : st), both });
}

export async function accountStatus() {
  const out = new Map();
  const jobs = [];
  if (tbConnected())
    jobs.push(
      remember('tb-status', async () => tbList('torrents'))
        .then((items) => {
          for (const t of items) {
            if (!t.hash) continue;
            setBoth(out, String(t.hash).toLowerCase(), 'torbox', {
              provider: 'torbox',
              ready: !!(t.download_finished || t.download_present),
              progress: Number(t.progress) || 0,
              state: t.download_state || '',
              seeds: t.seeds,
            });
          }
        })
        .catch(() => {})
    );
  if (rdConnected())
    jobs.push(
      remember('rd-status', async () => getJson(`${RD}/torrents?limit=200`, { headers: rdHeaders(), fresh: true }))
        .then((items) => {
          for (const t of items || []) {
            if (!t.hash) continue;
            setBoth(out, String(t.hash).toLowerCase(), 'realdebrid', {
              provider: 'realdebrid',
              ready: t.status === 'downloaded',
              progress: (Number(t.progress) || 0) / 100,
              state: t.status || '',
              seeds: t.seeders,
            });
          }
        })
        .catch(() => {})
    );
  await Promise.all(jobs);
  return out;
}
