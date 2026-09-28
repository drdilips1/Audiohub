// Audiobookshelf — connect your self-hosted server: browse libraries, stream,
// and sync listening progress back to the server.
import { isWeb, getJson, sendJson, qs, cleanUrl } from '../lib/http.js';
import { abs } from '../lib/store.js';

const cfg = () => abs.get();
const auth = () => ({ Authorization: `Bearer ${cfg().token}` });
// Two addresses for the same server (e.g. home LAN + Tailscale). The one that
// answers is used; on a connection failure the other is tried automatically.
let active = '';
let checkedAt = 0;
const trim = (u) => (u || '').replace(/\/+$/, '');
const base = () => trim(active || cfg().server);
export const activeServer = () => base();

async function reachable(url) {
  try {
    const r = await getJson(trim(url) + '/ping', { timeout: 3500, fresh: true });
    return r?.success !== false;
  } catch (e) {
    return !!e.status; // an HTTP error still means the host answered
  }
}

/** Pick the address that currently answers (cached for a minute). */
// The web app (an https page) can't use plain http:// addresses: browsers block them.
const usable = (u) => !(isWeb && typeof location !== 'undefined' && location.protocol === 'https:' && /^http:/i.test(u || ''));

export async function resolveServer(force = false) {
  const { server, altServer } = cfg();
  const both = [server, altServer].filter(Boolean);
  const ok = both.filter(usable);
  if (ok.length <= 1) return (active = trim(ok[0] || server));
  if (!force && active && Date.now() - checkedAt < 60e3) return active;
  checkedAt = Date.now();
  const order = active === trim(altServer) ? [altServer, server] : [server, altServer];
  for (const u of order) {
    if (await reachable(u)) {
      if (trim(u) !== active && active) console.info('Audiobookshelf: switched to', u);
      return (active = trim(u));
    }
  }
  return (active = trim(server));
}
export const connected = () => !!(cfg().server && cfg().token);

function normalizeServer(server) {
  const bare = cleanUrl(server, '').replace(/^:\/\//, '');
  // LAN servers are almost always plain http, so default to that when no scheme is typed.
  const isLocal = /^((\d{1,3}\.){3}\d{1,3}|localhost|[^/:]+\.local)([:/]|$)/i.test(bare);
  return cleanUrl(server, isLocal ? 'http' : 'https').replace(/\/+$/, '').replace(/\/login$/i, '');
}

// Authenticated GET/POST that transparently refreshes short-lived access
// tokens (Audiobookshelf 2.26+) once before giving up.
async function call(path, { method = 'GET', body, fresh } = {}) {
  const run = () =>
    method === 'GET' ? getJson(base() + path, { headers: auth(), fresh }) : sendJson(base() + path, method, body, auth());
  await resolveServer();
  if (!usable(base()))
    throw new Error("The web app can't use an http:// Audiobookshelf address — add your https (Tailscale) address in Settings → Audiobookshelf (as the main or the second address)");
  try {
    return await run();
  } catch (e) {
    // Network failure (no HTTP status): try the other address once.
    if (!e.status && cfg().altServer) {
      const before = base();
      if ((await resolveServer(true)) !== before) return run();
    }
    if (e.status === 401 && cfg().refreshToken && (await refresh())) return run();
    if (e.status === 401) throw new Error('Audiobookshelf session expired — please sign in again');
    if (!e.status && isWeb)
      throw new Error(`Can't reach ${base().replace(/^https?:\/\//, '')} from the web app — is Tailscale on here, and was Audiobookshelf started with ALLOW_CORS=1?`);
    throw e;
  }
}

async function refresh() {
  try {
    const res = await sendJson(base() + '/auth/refresh', 'POST', undefined, { 'x-refresh-token': cfg().refreshToken });
    const token = res?.user?.accessToken;
    if (!token) return false;
    abs.patch({ token, refreshToken: res.user.refreshToken || cfg().refreshToken });
    return true;
  } catch {
    return false;
  }
}

async function pickLibrary() {
  const libs = await libraries();
  const book = libs.find((l) => l.mediaType === 'book') || libs[0];
  abs.patch({ libraryId: book?.id || '' });
  return libs;
}

export async function login(server, username, password) {
  server = normalizeServer(server);
  let res;
  try {
    res = await sendJson(server + '/login', 'POST', { username: username.trim(), password }, { 'x-return-tokens': 'true' });
  } catch (e) {
    if (e.status === 401) throw new Error('Wrong username or password');
    if (!e.status && isWeb && /^http:/i.test(server)) throw new Error('The web app can only reach Audiobookshelf over https:// (browsers block http:// from secure pages) — use your Tailscale HTTPS address');
    if (!e.status && isWeb) throw new Error(`${server} refused the web app — in Audiobookshelf, set ALLOW_CORS=1 and restart the server (the Android app doesn't need this)`);
    if (!e.status) throw new Error(`Can't reach ${server} — check the address and that your phone is on the same network`);
    throw e;
  }
  const u = res?.user || {};
  // Prefer the long-lived legacy token when the server still issues one.
  const token = u.token || u.accessToken;
  if (!token) throw new Error('Login failed — the server returned no token');
  abs.set({ server, altServer: cfg().altServer || '', token, refreshToken: u.token ? '' : u.refreshToken || '', username: u.username || username, libraryId: '' });
  active = server;
  return pickLibrary();
}

// Sign in with an API key (Settings → API Keys in Audiobookshelf 2.26+) or a legacy token.
export async function loginWithKey(server, key) {
  server = normalizeServer(server);
  const token = String(key).trim().replace(/^Bearer\s+/i, '');
  const me = await getJson(server + '/api/me', { headers: { Authorization: `Bearer ${token}` }, fresh: true }).catch((e) => {
    throw new Error(e.status === 401 ? 'That API key was rejected' : `Can't reach ${server}`);
  });
  abs.set({ server, altServer: cfg().altServer || '', token, refreshToken: '', username: me.username || 'API key', libraryId: '' });
  active = server;
  return pickLibrary();
}

export function setAltServer(url) {
  const u = url.trim() ? normalizeServer(url) : '';
  abs.patch({ altServer: u });
  active = '';
  return resolveServer(true);
}

export function logout() {
  abs.set({ server: '', altServer: cfg().altServer, token: '', refreshToken: '', username: '', libraryId: '' });
  active = '';
}

let libNames = {};
export async function libraries() {
  const data = await call('/api/libraries', { fresh: true });
  const libs = data.libraries || [];
  libNames = Object.fromEntries(libs.map((l) => [l.id, l.name]));
  return libs;
}

/** Why a list came back empty: which library, on which address. */
export function emptyHint() {
  const name = libNames[cfg().libraryId];
  if (!name) libraries().catch(() => {}); // learn the names for next time
  const where = base().replace(/^https?:\/\//, '');
  return `No books in ${name ? `the library “${name}”` : 'the chosen library'} on ${where}. If that's the wrong library, pick your audiobook library in Settings → Audiobookshelf.`;
}

function toBook(item) {
  const li = item.libraryItem || item;
  const md = li.media?.metadata || {};
  return {
    uid: 'abs:' + li.id,
    source: 'abs',
    kind: li.media?.numAudioFiles === 0 && li.media?.ebookFormat ? 'text' : 'audio',
    title: md.title || li.name || 'Untitled',
    author: md.authorName || (md.authors || []).map((a) => a.name).join(', '),
    cover: `${base()}/api/items/${li.id}/cover?${qs({ token: cfg().token, width: 400 })}`,
    year: md.publishedYear || '',
    duration: li.media?.duration || 0,
    genres: [...(md.genres || []), ...(li.media?.tags || [])],
  };
}

// The main library, plus the ebooks library when one is chosen (Settings → Audiobookshelf).
const libIds = () => [...new Set([cfg().libraryId, cfg().ebookLibraryId].filter(Boolean))];
// A library that can't be reached is skipped; if none can be reached, that's an error
// (not an empty list). strict: any unreachable library is an error.
async function fromLibraries(path, pick, strict = false) {
  const res = await Promise.allSettled(libIds().map((id) => call(`/api/libraries/${id}${path}`).then(pick)));
  const bad = res.filter((r) => r.status === 'rejected');
  if (bad.length && (strict || bad.length === res.length)) throw bad[0].reason;
  return res.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).map(toBook);
}

// No library chosen yet (e.g. signed in on another device): pick the audiobook library.
async function ensureLibrary() {
  if (!cfg().libraryId) await pickLibrary();
  return !!cfg().libraryId;
}

export async function recent() {
  if (!connected() || !(await ensureLibrary())) return [];
  return fromLibraries('/items?' + qs({ limit: 30, sort: 'addedAt', desc: 1, minified: 1 }), (d) => d.results || []);
}

/** Whole library (up to 500 items), newest first. */
export async function all({ strict = false } = {}) {
  if (!connected() || !(await ensureLibrary())) return [];
  return fromLibraries('/items?' + qs({ limit: 500, sort: 'addedAt', desc: 1, minified: 1 }), (d) => d.results || [], strict);
}

export async function inProgress() {
  if (!connected()) return [];
  const data = await call('/api/me/items-in-progress?limit=20', { fresh: true });
  return (data.libraryItems || []).map(toBook);
}

export async function search(term, { strict = false } = {}) {
  if (!connected() || !term.trim() || !(await ensureLibrary())) return [];
  return fromLibraries('/search?' + qs({ q: term, limit: 25 }), (d) => d.book || d.podcast || [], strict);
}

export async function details(book) {
  const id = book.uid.slice(4);
  const li = await call(`/api/items/${id}?expanded=1`);
  const b = toBook(li);
  const md = li.media?.metadata || {};
  return {
    ...book,
    ...b,
    description: md.description || '',
    subjects: md.genres || [],
    narrator: md.narratorName,
    series: md.seriesName,
    chaptersMeta: (li.media?.chapters || []).map((c) => ({ title: c.title, start: c.start, end: c.end })),
    // Its ebook file (EPUB opens in the reader; any format can go to Kindle / another app).
    ebooks: ebookOf(li),
    tracks: null, // resolved at play time through a playback session
    resolveTracks: () => startSession(id),
    link: `${base()}/item/${id}`,
  };
}

function ebookOf(li) {
  const f = li.media?.ebookFile;
  if (!f) return [];
  const format = String(f.ebookFormat || (f.metadata?.ext || '').replace('.', '') || 'epub').toUpperCase();
  const url = `${base()}/api/items/${li.id}/ebook?` + qs({ token: cfg().token });
  return [{ name: f.metadata?.filename || `${li.media?.metadata?.title || 'Book'}.${format.toLowerCase()}`, format, size: f.metadata?.size || 0, url, resolve: async () => url }];
}

async function startSession(id) {
  const s = await call(`/api/items/${id}/play`, { method: 'POST', body: {
    deviceInfo: { clientName: 'Inkwell', deviceId: 'inkwell-android' },
    forceDirectPlay: true,
    mediaPlayer: 'html5',
    supportedMimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/webm', 'audio/x-m4b'],
  } });
  const tok = cfg().token;
  const tracks = (s.audioTracks || []).map((t, i) => ({
    title: t.title || t.metadata?.filename || `Part ${i + 1}`,
    url: (/^https?:/.test(t.contentUrl) ? t.contentUrl : base() + t.contentUrl) + (t.contentUrl.includes('?') ? '&' : '?') + qs({ token: tok }),
    duration: t.duration,
    offset: t.startOffset,
    server: /^https?:/.test(t.contentUrl) ? '' : base(), // which address the link points at (for switching)
    // Native playback sends the token as a header too (newer servers prefer it).
    headers: { Authorization: `Bearer ${tok}` },
    index: i,
  }));
  return { tracks, sessionId: s.id, startTime: s.currentTime || 0 };
}

/**
 * Playback on one address failed or stalled: if the other address answers, point the
 * book's audio links at it. Returns the new address, or '' when there's nothing to switch to.
 */
export async function switchTracks(tracks) {
  if (!cfg().altServer || !tracks?.some((t) => t.server)) return '';
  const now = await resolveServer(true);
  let moved = false;
  for (const t of tracks) {
    if (t.server && t.server !== now && t.url?.startsWith(t.server)) {
      t.url = now + t.url.slice(t.server.length);
      t.server = now;
      moved = true;
    }
  }
  return moved ? now : '';
}

export async function syncProgress(uid, currentTime, duration, isFinished = false) {
  if (!connected() || !uid.startsWith('abs:')) return;
  try {
    await call(`/api/me/progress/${uid.slice(4)}`, {
      method: 'PATCH',
      body: { currentTime, duration, progress: duration ? Math.min(1, currentTime / duration) : 0, isFinished },
    });
  } catch {}
}
