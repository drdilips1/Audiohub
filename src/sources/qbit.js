// Send your TorBox / Real-Debrid audiobooks home: the app hands each one's
// magnet to your own qBittorrent (Web UI, e.g. over Tailscale), saved into your
// Audiobookshelf library folder. qBittorrent then downloads it by itself, and
// Audiobookshelf picks the finished folder up.
import { Capacitor, CapacitorCookies, registerPlugin } from '@capacitor/core';
import { persisted } from '../lib/store.js';
import { requestText, requestFull, cleanUrl } from '../lib/http.js';
import { readTorrent } from '../lib/torrentfile.js';
import * as absSrc from './audiobookshelf.js';
import { words, matches, mainTitle } from '../lib/match.js';
import { infoHash, magnetFor, torboxLibrary, realdebridLibrary, tbConnected, rdConnected, hasAudio, forget as forgetCloud } from './debrid.js';

export const qbit = persisted('qbit', { url: '', lanUrl: '', username: '', password: '', apiKey: '', savePath: '', ebookPath: '', category: 'audiobooks', auto: false });

// qBittorrent 5.2+ API key (qbt_…): sent on every call, no login or cookie needed.
const apiKey = () => String(qbit.get().apiKey || '').trim();
// Hashes already sent (so auto-send never repeats one), newest last.
export const qbitSent = persisted('qbitSent', { items: {} });

export const configured = () => !!(qbit.get().url || qbit.get().lanUrl);
export const available = Capacitor.isNativePlatform();

const clean = (u) => (u ? cleanUrl(u, 'http').replace(/\/+$/, '') : '');
// The address in use: the home Wi-Fi one when it answers, else the Tailscale one.
let current = '';
let pickedAt = 0;
const base = () => current || clean(qbit.get().url) || clean(qbit.get().lanUrl);

/** Is anything answering at this Web UI address (any HTTP reply counts)? */
async function answers(u, ms = 2500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    await Promise.race([fetch(u + '/api/v2/app/version', { signal: ctrl.signal, headers: { Referer: u + '/', Origin: u } }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Choose the address to use (re-checked every few minutes or when the network changes). */
export async function pickAddress(force = false) {
  const lan = clean(qbit.get().lanUrl);
  const remote = clean(qbit.get().url);
  if (!lan) return (current = remote);
  if (!force && current && Date.now() - pickedAt < 3 * 60e3) return current;
  pickedAt = Date.now();
  if (await answers(lan)) return (current = lan);
  return (current = remote || lan);
}
if (typeof navigator !== 'undefined' && navigator.connection?.addEventListener) navigator.connection.addEventListener('change', () => (pickedAt = 0));
window.addEventListener?.('online', () => (pickedAt = 0));
export const addressInUse = () => current;
// qBittorrent refuses API calls whose Referer/Origin don't match its own address.
const headersFor = (extra = {}) => ({ Referer: base() + '/', Origin: base(), ...extra });

// The session cookie: "SID" up to qBittorrent 5.1, "QBT_SID_<port>" from 5.2.
let session = '';
const isSession = (k) => k === 'SID' || /^QBT_SID/i.test(k);
function takeSetCookie(headers) {
  const raw = headers?.get?.('set-cookie') || '';
  const m = /((?:QBT_)?SID[^=;,\s]*)=([^;,\s]+)/i.exec(raw);
  if (m) session = `${m[1]}=${m[2]}`;
}
async function cookie() {
  if (apiKey()) return { Authorization: `Bearer ${apiKey()}` };
  try {
    const c = await CapacitorCookies.getCookies({ url: base() });
    const found = Object.entries(c || {}).filter(([k]) => isSession(k));
    if (found.length) session = found.map(([k, v]) => `${k}=${v}`).join('; ');
  } catch {}
  return session ? { Cookie: session } : {};
}

async function login() {
  await pickAddress();
  if (apiKey()) return;
  const { username, password } = qbit.get();
  if (!username && !password) return; // Web UI set to skip login for this network
  const body = new URLSearchParams({ username, password }).toString();
  const r = await requestFull(base() + '/api/v2/auth/login', {
    method: 'POST',
    timeout: 15000,
    headers: headersFor({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body,
  }).catch((e) => {
    if (e.status === 401) throw new Error('qBittorrent rejected the username or password');
    if (e.status === 403) throw new Error('qBittorrent has temporarily banned this device after failed logins — wait a while, or check the Web UI settings');
    throw new Error(`Couldn't reach qBittorrent at ${base()} — are you on home Wi-Fi or is Tailscale on, and is the Web UI enabled? (${e.message})`);
  });
  takeSetCookie(r.headers);
  // Success is "Ok." (up to 5.1) or an empty 204 reply (5.2 and later).
  if (r.status === 204 || /^\s*ok/i.test(r.text)) return;
  throw new Error('qBittorrent rejected the username or password');
}

/** Call the Web API, signing in first (and again once if the session expired). */
async function api(path, { method = 'GET', body, contentType } = {}) {
  await pickAddress();
  const go = async () =>
    requestText(base() + '/api/v2/' + path, {
      method,
      timeout: 20000,
      headers: headersFor({ ...(await cookie()), ...(contentType ? { 'Content-Type': contentType } : {}) }),
      body,
    });
  try {
    return await go();
  } catch (e) {
    if (e.status !== 403 && e.status !== 401) throw e;
    if (apiKey()) throw new Error('qBittorrent rejected the API key — copy it again from the Web UI settings');
    await login();
    return go().catch((e2) => {
      if (e2.status === 401 || e2.status === 403)
        throw new Error("Signed in, but qBittorrent didn't accept the session on the next step. Use an API key instead (qBittorrent 5.2+: Web UI settings → API key), or allow your Tailscale devices without a password (bypass authentication for 100.64.0.0/10) and leave username/password empty here.");
      throw e2;
    });
  }
}

/** Check the connection; resolves with qBittorrent's version. */
export async function test() {
  if (!available) throw new Error('Sending to qBittorrent works in the Android app');
  await pickAddress(true);
  await login();
  const v = (await api('app/version')).trim();
  qbit.set((c) => ({ ...c, version: v, checkedAt: Date.now() }));
  const via = qbit.get().lanUrl && current === clean(qbit.get().lanUrl) ? 'home Wi-Fi' : qbit.get().lanUrl ? 'Tailscale' : '';
  return `Connected to qBittorrent ${v}${via ? ` via ${via}` : ''}`;
}

function multipart(fields) {
  const boundary = '----kathava' + Math.random().toString(16).slice(2);
  const body =
    Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
      .join('') + `--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// Well-known public trackers. A magnet with only an info-hash makes qBittorrent
// hunt for peers through DHT alone, which often leaves it stuck at
// "Downloading metadata"; trackers let it find peers straight away.
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'https://tracker.tamersunion.org:443/announce',
  'http://tracker.opentrackr.org:1337/announce',
];
export function withTrackers(magnet) {
  const have = new Set([...String(magnet).matchAll(/[?&]tr=([^&]+)/g)].map((m) => decodeURIComponent(m[1])));
  const extra = TRACKERS.filter((t) => !have.has(t)).map((t) => '&tr=' + encodeURIComponent(t)).join('');
  return magnet + extra;
}

const AUDIO_NAME = /\b(m4b|m4a|mp3|flac|aac|opus|audiobook|audio ?book|unabridged|narrated)\b/i;
const EBOOK_NAME = /\b(epub|pdf|mobi|azw3?|ebook|e-book)\b/i;
/** A name/format that reads as an ebook (and not an audiobook). */
export const isEbookName = (text) => EBOOK_NAME.test(text || '') && !AUDIO_NAME.test(text || '');
/** A .torrent whose files are books to read: ebook files and no audio files. */
function torrentIsEbook(bytes) {
  let t = '';
  for (let i = 0; i < bytes.length; i += 8192) t += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  t = t.toLowerCase();
  return !/\.(m4b|m4a|mp3|flac|aac|ogg|opus|wma|aax)\b/.test(t) && /\.(epub|pdf|mobi|azw3?|kfx|fb2|djvu|cbz|cbr)\b/.test(t);
}
/**
 * The ebooks folder: the one you set, or else an "Ebooks" folder next to the audiobook
 * folder on the same drive (/audiobooks -> /ebooks, /Volumes/My Book/Audiobooks -> /Volumes/My Book/Ebooks).
 */
export function ebookFolder() {
  const { savePath, ebookPath } = qbit.get();
  if (String(ebookPath || '').trim()) return ebookPath.trim();
  const p = String(savePath || '').trim().replace(/[\\/]+$/, '');
  const m = /^(.*[\\/])([^\\/]+)$/.exec(p);
  if (!m) return '';
  const name = m[2];
  const sibling = /^[A-Z]/.test(name) ? (name === name.toUpperCase() ? 'EBOOKS' : 'Ebooks') : 'ebooks';
  return m[1] + sibling;
}
/** Where a download goes: ebooks to the ebooks folder, the rest to the audiobook folder. */
function folderFor(ebook) {
  return (ebook && ebookFolder()) || qbit.get().savePath;
}

// Your Audiobookshelf library, looked up at most every 10 minutes.
let absList = null;
let absAt = 0;
async function absBooks() {
  if (!absSrc.connected()) return [];
  if (!absList || Date.now() - absAt > 10 * 60e3) {
    try {
      absList = await absSrc.all({ strict: true });
      absAt = Date.now();
    } catch {
      // An older copy of the list is fine; with none, we can't tell what you have.
      if (!absList) throw absDown();
    }
  }
  return absList;
}
const absDown = () => Object.assign(new Error("Couldn't reach your Audiobookshelf to check for duplicates"), { absDown: true });

// This server book is the same book as the torrent: every word of its title in the
// torrent's name, plus the author's first or last name unless the title is long.
function sameAs(a, text, hay) {
  if (a.kind === 'text') return false;
  const t = mainTitle(a.title);
  if (!words(t).length || !matches(t, text)) return false;
  const names = String(a.author || '').split(/,|&|\band\b/).flatMap((n) => {
    const w = words(n).filter((x) => x.length >= 3);
    return w.length ? [w[0], w[w.length - 1]] : [];
  });
  return names.some((n) => hay.has(n)) || (!names.length && words(t).length >= 2) || words(t).length >= 3;
}

/**
 * The Audiobookshelf book that is this same book, if your server already has it
 * (so it isn't downloaded twice). Checks your newest 500 books, then asks the server
 * itself (so older books in a big library count too). Throws when the server can't
 * be reached, so callers hold off instead of sending a possible duplicate.
 */
export async function onServer(book) {
  const text = `${book.title || ''} ${book.author || ''} ${book.rawName || ''}`;
  const hay = new Set(words(text));
  const hit = (await absBooks()).find((a) => sameAs(a, text, hay));
  if (hit) return hit;
  if (!absSrc.connected()) return null;
  // Torrent names often read "Author - Title (2021) [MP3]": search the whole title, then each part.
  const q = mainTitle(book.title || '').trim();
  const parts = q.split(/\s+[-–—|]\s+/).map((x) => x.trim()).filter((x) => x.length >= 4);
  const queries = [...new Set([q, ...parts])].filter((x) => x && x.length <= 90).slice(0, 3);
  for (const term of queries) {
    const found = await absSrc.search(term, { strict: true }).catch((e) => {
      throw e.status ? e : absDown();
    });
    const hit = found.find((a) => sameAs(a, text, hay));
    if (hit) return hit;
  }
  return null;
}

/** Add one cloud item (needs its info-hash) to qBittorrent. */
export async function send(book) {
  if (!available) throw new Error('Sending to qBittorrent works in the Android app');
  if (!configured()) throw new Error('Set up qBittorrent first (Settings → Home server)');
  const hash = String(book.hash || '').toLowerCase();
  if (!hash) throw new Error('Only torrents can be sent (this item has no magnet)');
  const { category } = qbit.get();
  const savePath = folderFor(book.ebook ?? isEbookName(`${book.rawName || ''} ${book.title || ''} ${book.format || ''}`));
  const magnet = withTrackers(magnetFor(book.magnet, hash, book.rawName || book.title));
  const { body, contentType } = multipart({ urls: magnet, savepath: savePath, category, tags: 'kathava', autoTMM: savePath ? 'false' : undefined });
  if (!session && !apiKey()) await login();
  const remember = () => qbitSent.set((s) => ({ ...s, items: { ...s.items, [hash]: { title: book.title, author: book.author || '', at: Date.now() } } }));
  let text = '';
  try {
    text = await api('torrents/add', { method: 'POST', body, contentType });
  } catch (e) {
    // 409 = nothing was added — usually because qBittorrent already has it.
    if (e.status !== 409) throw e;
    const have = await existing(hash);
    if (have) {
      remember();
      return `Already in qBittorrent — ${describe(have)}`;
    }
    throw new Error("qBittorrent didn't add it (409). Check that the save folder exists and the drive is connected, then try again");
  }
  // "Ok." up to 5.2.2; from 5.2.3 a JSON summary ({ success_count, … }).
  let added = !/^\s*fails\.?\s*$/i.test(text);
  try {
    const j = JSON.parse(text);
    if (j && typeof j.success_count === 'number') added = j.success_count > 0;
  } catch {}
  if (!added) {
    const have = await existing(hash);
    if (have) {
      remember();
      return `Already in qBittorrent — ${describe(have)}`;
    }
    throw new Error("qBittorrent didn't add it");
  }
  remember();
  return `Sent to qBittorrent${savePath ? ` → ${savePath}` : ''}`;
}

/** A torrent qBittorrent already has, or null. */
async function existing(hash) {
  try {
    const list = JSON.parse((await api('torrents/info?' + new URLSearchParams({ hashes: hash }))) || '[]');
    return list[0] || null;
  } catch {
    return null;
  }
}

const STATES = { downloading: 'downloading', stalledDL: 'waiting for peers', metaDL: 'fetching details', forcedMetaDL: 'fetching details', queuedDL: 'queued', pausedDL: 'paused', stoppedDL: 'paused', uploading: 'done, sharing', stalledUP: 'done', pausedUP: 'done', stoppedUP: 'done', queuedUP: 'done', checkingDL: 'checking', checkingUP: 'checking', error: 'error', missingFiles: 'files missing', moving: 'moving' };
export const stateLabel = (st) => STATES[st] || st || '';
function describe(t) {
  const pct = Math.round((t.progress || 0) * 100);
  return `${pct >= 100 ? 'finished' : `${pct}% · ${stateLabel(t.state)}`}${t.save_path ? ` · ${t.save_path}` : ''}`;
}

/** Send a pasted magnet link. */
export async function sendMagnet(magnet) {
  if (!/^magnet:\?/i.test(magnet)) throw new Error('Paste a magnet link (magnet:?…), or tap + with the box empty to pick a .torrent file');
  const hash = infoHash(magnet, '');
  if (!hash) throw new Error("That magnet link doesn't have a valid hash");
  const dn = (/[?&]dn=([^&]+)/.exec(magnet) || [])[1];
  const title = dn ? decodeURIComponent(dn.replace(/\+/g, ' ')) : 'Torrent';
  return send({ hash, magnet, title, rawName: title });
}

/** Upload a .torrent file to qBittorrent (same folder and category as magnets). */
export async function sendFile(file) {
  if (!available) throw new Error('Sending to qBittorrent works in the Android app');
  if (!configured()) throw new Error('Set up qBittorrent first (Settings → Home server)');
  if (!file) throw new Error('No file chosen');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { name, hash } = await readTorrent(bytes);
  const { category } = qbit.get();
  const savePath = folderFor(torrentIsEbook(bytes));
  const form = new FormData();
  form.append('torrents', new Blob([bytes], { type: 'application/x-bittorrent' }), file.name || 'book.torrent');
  if (savePath) {
    form.append('savepath', savePath);
    form.append('autoTMM', 'false');
  }
  if (category) form.append('category', category);
  form.append('tags', 'kathava');
  await pickAddress();
  if (!session && !apiKey()) await login();
  const post = async () => {
    const res = await fetch(base() + '/api/v2/torrents/add', { method: 'POST', headers: headersFor(await cookie()), body: form });
    return { status: res.status, text: await res.text().catch(() => '') };
  };
  let r = await post();
  if ((r.status === 401 || r.status === 403) && !apiKey()) {
    await login();
    r = await post();
  }
  const remember = () => hash && qbitSent.set((s) => ({ ...s, items: { ...s.items, [hash]: { title: name || file.name, author: '', at: Date.now() } } }));
  let refused = r.status === 409 || /^\s*fails\.?\s*$/i.test(r.text);
  try {
    const j = JSON.parse(r.text);
    if (j && typeof j.success_count === 'number') refused = j.success_count === 0;
  } catch {}
  if (refused) {
    const have = hash ? await existing(hash) : null;
    if (have) {
      remember();
      return `Already in qBittorrent — ${describe(have)}`;
    }
    throw new Error("qBittorrent didn't add it — check the save folder and that the drive is connected");
  }
  if (r.status >= 400) throw new Error(`qBittorrent: HTTP ${r.status}${r.text ? ` — ${r.text.slice(0, 80)}` : ''}`);
  remember();
  return `Sent “${name || file.name}” to qBittorrent${savePath ? ` → ${savePath}` : ''}`;
}

const known = (hash) => qbitSent.get().items[String(hash || '').toLowerCase()];
/** Sent to qBittorrent (ebooks auto-send skipped don't count). */
export const wasSent = (hash) => !!known(hash) && !known(hash).skipped;

/** All torrent-based audiobooks in your clouds that haven't been sent yet. */
export async function unsent() {
  const lists = await Promise.all([tbConnected() ? torboxLibrary().catch(() => []) : [], rdConnected() ? realdebridLibrary().catch(() => []) : []]);
  const seen = new Set();
  // Items the debrid service is still fetching count: qBittorrent downloads the torrent itself.
  return lists.flat().filter((b) => b.hash && !known(b.hash) && !seen.has(b.hash) && seen.add(b.hash));
}


// What the list shows: sent after the last "Clear list", and not removed.
const listed = () => {
  const { items, clearedAt = 0 } = qbitSent.get();
  return Object.keys(items).filter((h) => (items[h]?.at || 0) > clearedAt && !items[h]?.removed && !items[h]?.hidden);
};

/**
 * Hide everything sent so far from the list (it's still remembered, so nothing is sent twice).
 * [shown] = hashes on screen right now; each one is marked hidden, so it stays gone
 * whatever its timestamp says.
 */
export function clearList(shown = []) {
  qbitSent.set((s) => {
    const items = { ...s.items };
    for (const h of [...Object.keys(items), ...shown.map((x) => String(x).toLowerCase())]) items[h] = { ...(items[h] || { title: '' }), hidden: true };
    return { ...s, items, clearedAt: Date.now() };
  });
}

/** Broken downloads: qBittorrent can't find their files, or reports an error. */
export const isBroken = (t) => t.progress < 1 && /missingFiles|error/i.test(t.state || '');

/**
 * Remove broken torrents from qBittorrent. Only the torrent entry goes — files
 * already on disk are never deleted.
 */
export async function removeBroken(list) {
  const bad = list.filter(isBroken).map((t) => t.hash);
  if (!bad.length) return 'Nothing broken to remove';
  const form = new URLSearchParams({ hashes: bad.join('|'), deleteFiles: 'false' }).toString();
  await api('torrents/delete', { method: 'POST', body: form, contentType: 'application/x-www-form-urlencoded' });
  qbitSent.set((s) => {
    const items = { ...s.items };
    for (const h of bad) if (items[h]) items[h] = { ...items[h], removed: true };
    return { ...s, items };
  });
  return `Removed ${bad.length} broken download${bad.length === 1 ? '' : 's'} from qBittorrent (files kept)`;
}

/** Progress of what we've sent, straight from qBittorrent. */
export async function status() {
  const hashes = listed();
  if (!hashes.length) return [];
  const text = await api('torrents/info?' + new URLSearchParams({ hashes: hashes.slice(-50).join('|') }));
  // Only what we sent (and haven't cleared): qBittorrent can answer with every torrent it has.
  const want = new Set(hashes);
  const list = JSON.parse(text || '[]').filter((t) => want.has(String(t.hash || '').toLowerCase()));
  return list
    .map((t) => ({ hash: t.hash, name: t.name, progress: t.progress, state: t.state, eta: t.eta, speed: t.dlspeed, savePath: t.save_path }))
    .sort((a, b) => (qbitSent.get().items[b.hash]?.at || 0) - (qbitSent.get().items[a.hash]?.at || 0));
}

/**
 * Unstick what we've sent: add trackers and re-announce (stuck at metadata /
 * no peers), and re-check torrents in an error or missing-files state.
 */
export async function fixStuck() {
  const hashes = Object.keys(qbitSent.get().items);
  if (!hashes.length) return 'Nothing sent yet';
  const list = JSON.parse((await api('torrents/info?' + new URLSearchParams({ hashes: hashes.join('|') }))) || '[]');
  if (!list.length) return 'None of the sent torrents are in qBittorrent any more';
  const form = (fields) => ({ method: 'POST', body: new URLSearchParams(fields).toString(), contentType: 'application/x-www-form-urlencoded' });
  const urls = TRACKERS.join('\n');
  for (const t of list) await api('torrents/addTrackers', form({ hash: t.hash, urls })).catch(() => {});
  const all = list.map((t) => t.hash).join('|');
  await api('torrents/reannounce', form({ hashes: all })).catch(() => {});
  const broken = list.filter((t) => /error|missingFiles/i.test(t.state));
  if (broken.length) await api('torrents/recheck', form({ hashes: broken.map((t) => t.hash).join('|') })).catch(() => {});
  // Paused/stopped ones: start them again (5.x uses start, older versions resume).
  const stopped = list.filter((t) => /^(paused|stopped)DL$/.test(t.state)).map((t) => t.hash).join('|');
  if (stopped) await api('torrents/start', form({ hashes: stopped })).catch(() => api('torrents/resume', form({ hashes: stopped })).catch(() => {}));
  return `Added trackers to ${list.length} torrent${list.length === 1 ? '' : 's'}${broken.length ? ` · re-checking ${broken.length} with errors` : ''}`;
}

// Auto-send: forward new cloud audiobooks to qBittorrent. Runs when the app opens or
// comes back, every few minutes while it's open, and right after you add something
// to TorBox / Real-Debrid in the app. A failed attempt is retried at the next chance.
export const autoLast = persisted('qbitAutoLast', { at: 0, sent: 0, error: '' });
let lastAuto = 0;
let running = null;
const friendly = (m) =>
  /failed to fetch|network|timed? ?out|connect|unreachable/i.test(m) ? "couldn't reach qBittorrent — is Tailscale on, or are you on home Wi-Fi? Retrying when you come back to the app" : m;

export function autoForward({ force = false } = {}) {
  const cfg = qbit.get();
  if (!available || !configured() || !cfg.auto) return Promise.resolve('');
  if (running) return running;
  if (!force && Date.now() - lastAuto < 3 * 60e3) return Promise.resolve('');
  running = (async () => {
    try {
      // Only items added to your cloud after auto-send was switched on. Items still
      // downloading on the debrid service count too: qBittorrent fetches the torrent itself.
      const fresh = (await unsent()).filter((b) => (b.addedAt || 0) >= (cfg.autoSince || 0));
      // Audiobooks only: ebooks in the cloud stay there.
      const list = [];
      let held = '';
      for (const b of fresh) {
        const audio = await hasAudio(b).catch(() => null);
        // Already on your Audiobookshelf server: don't download it again.
        // Server not answering: hold it for the next check rather than risk a duplicate.
        let have = null;
        if (audio) {
          try {
            have = await onServer(b);
          } catch (e) {
            held = e.message;
            continue;
          }
        }
        if (have) {
          qbitSent.set((st) => ({ ...st, items: { ...st.items, [b.hash]: { title: b.title, at: Date.now(), removed: true, skipped: 'on-server' } } }));
          continue;
        }
        if (audio) list.push(b);
        // Remember ebooks as handled (hidden from the list) so they aren't checked again.
        else if (audio === false) qbitSent.set((st) => ({ ...st, items: { ...st.items, [b.hash]: { title: b.title, at: Date.now(), removed: true, skipped: 'ebook' } } }));
      }
      let ok = 0;
      let err = '';
      for (const b of list) await send(b).then(() => ok++, (e) => (err = e.message || String(e)));
      if (ok === list.length && !held) lastAuto = Date.now(); // a failed or held send is retried at the next chance
      autoLast.set({ at: Date.now(), sent: ok, error: ok < list.length ? friendly(err) : held ? `${held} — waiting before sending` : '' });
      return ok ? `Sent ${ok} new audiobook${ok === 1 ? '' : 's'} to qBittorrent` : '';
    } catch (e) {
      autoLast.set({ at: Date.now(), sent: 0, error: friendly(e.message || String(e)) });
      return ''; // not counted: tried again when the app comes back
    } finally {
      running = null;
    }
  })();
  return running;
}


/**
 * You added a result to TorBox / Real-Debrid in the app: with auto-send on, send
 * its magnet to qBittorrent right away (no need to wait for the debrid service to
 * list the files). Ebooks are left out.
 */
export async function autoSendAdded({ hash, magnet, title, author, rawName, format }) {
  const cfg = qbit.get();
  if (!available || !configured() || !cfg.auto) return '';
  const h = String(hash || '').toLowerCase() || infoHash(magnet, '');
  if (!h || known(h)) return '';
  if (EBOOK_NAME.test(`${rawName || ''} ${format || ''}`)) return '';
  let have = null;
  try {
    have = await onServer({ title, author, rawName });
  } catch (e) {
    autoLast.set({ at: Date.now(), sent: 0, error: `${e.message} — waiting before sending` });
    autoForwardSoon(); // checked and sent once your server answers
    return 'Not sent home yet: waiting for your Audiobookshelf to answer, so a book you already have isn’t downloaded twice';
  }
  if (have) {
    qbitSent.set((st) => ({ ...st, items: { ...st.items, [h]: { title, at: Date.now(), removed: true, skipped: 'on-server' } } }));
    return `Already on your Audiobookshelf (“${have.title}”) — not sent home again`;
  }
  try {
    await send({ hash: h, magnet, title, author: author || '', rawName });
    autoLast.set({ at: Date.now(), sent: 1, error: '' });
    return 'Also sent to your home server (qBittorrent)';
  } catch (e) {
    autoLast.set({ at: Date.now(), sent: 0, error: friendly(e.message || String(e)) });
    autoForwardSoon(); // try again shortly
    return '';
  }
}

/** After adding something to TorBox / Real-Debrid in the app: forward it once it shows up there. */
export function autoForwardSoon() {
  if (!available || !qbit.get().auto) return;
  for (const ms of [8000, 30000, 90000])
    setTimeout(() => {
      forgetCloud(); // fresh TorBox / Real-Debrid lists, so the new item is seen
      autoForward({ force: true }).catch(() => {});
    }, ms);
}

// ---- Tracker tab: a site you sign in to, whose downloads go to qBittorrent ----
export const tracker = persisted('tracker', { url: '', search: '' });

/** Your tracker's search page for [query], if you've set its search address ({q} = the words). */
export function trackerSearchUrl(query, filtered = false, ebook = false) {
  const { url, search, search2, search3 } = tracker.get();
  const tpl = String((filtered ? (ebook && search3) || search2 : search) || '').trim();
  if (tpl.includes('{q}')) return tpl.replace('{q}', encodeURIComponent(query));
  return String(url || '').trim();
}
/** Your own short name for the second, filtered search address (e.g. "FL"), or '' if none is saved. */
export const trackerFilterLabel = () => {
  const t = tracker.get();
  return String(t.search2 || '').includes('{q}') ? String(t.label2 || '').trim() || 'Filtered' : '';
};
export const trackerName = () => String(tracker.get().url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const Web = registerPlugin('InkwellWeb');
const canBrowse = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');

/** Open the tracker site in the in-app browser; its .torrent downloads and magnets come here. */
export async function openTracker(query = '', filtered = false, ebook = false) {
  const url = query ? trackerSearchUrl(query, filtered, ebook) : String(tracker.get().url || '').trim();
  if (!url) throw new Error('Add your tracker site address first');
  if (!canBrowse) return window.open(url, '_blank');
  // The browser screen sends captured downloads itself (the app is paused behind it).
  const c = qbit.get();
  const qb = JSON.stringify({ url: await pickAddress(true), apiKey: c.apiKey || '', username: c.username || '', password: c.password || '', savePath: c.savePath || '', ebookPath: ebookFolder(), category: c.category || '', trackers: TRACKERS });
  return Web.open({ url: /^https?:\/\//i.test(url) ? url : 'https://' + url, title: '', capture: true, qbit: qb });
}

/** What happened to the last download tapped in the tracker browser. */
export const lastCapture = persisted('qbitLastCapture', { at: 0, ok: true, text: '' });

const nativeToast = (text) => (canBrowse ? Web.toast({ text }).catch(() => {}) : Promise.resolve());

// Downloads caught in the in-app browser: the browser screen already sent them to
// qBittorrent; here we only note them so they show under "Downloads at home".
if (canBrowse) {
  Web.addListener('captured', async (e) => {
    lastCapture.set({ at: Date.now(), ok: !!e.sent, text: e.message || (e.sent ? 'Sent to qBittorrent' : "Didn't reach qBittorrent") });
    if (!e.sent) return;
    try {
      let hash = '';
      let title = e.name || 'Torrent';
      if (e.type === 'magnet') {
        hash = infoHash(e.url, '');
        const dn = (/[?&]dn=([^&]+)/.exec(e.url) || [])[1];
        if (dn) title = decodeURIComponent(dn.replace(/\+/g, ' '));
      } else {
        const bin = atob(e.data || '');
        const info = await readTorrent(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
        hash = info.hash;
        title = info.name || title;
      }
      if (hash) qbitSent.set((s) => ({ ...s, items: { ...s.items, [hash]: { title: title.replace(/\.torrent$/i, ''), author: '', at: Date.now() } } }));
    } catch {}
  });
}
