// "Source" addons in the InkShelf declarative format: the manifest describes an
// HTTP request (with {TITLE}/{AUTHOR}/{QUERY} placeholders) and how to map the
// JSON response into results carrying a magnet link / info-hash. Inkwell hands
// the magnet to the user's TorBox or Real-Debrid account to stream it.
import { getJson, sendJson } from '../lib/http.js';
import { addons, persisted } from '../lib/store.js';
import { logError, redact } from '../lib/report.js';
import { words, matches, mainTitle } from '../lib/match.js';
import { infoHash, torboxCached } from './debrid.js';

export const isSourceManifest = (m) => !!(m && typeof m === 'object' && m.id && m.name && m.adapters?.source?.request?.url);

export const sourceAddons = () => addons.get().filter((a) => a.kind === 'source');

// ---- helpers ----------------------------------------------------------------
function fill(v, vars, encode) {
  if (typeof v === 'string')
    return v.replace(/\{(TITLE|AUTHOR|QUERY|NARRATOR|ISBN|LIMIT)\}/gi, (_, k) => {
      const val = vars[k.toUpperCase()] ?? '';
      return encode ? encodeURIComponent(val) : val;
    });
  if (Array.isArray(v)) return v.map((x) => fill(x, vars, encode));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, vars, encode)]));
  return v;
}

const at = (obj, path) =>
  !path ? obj : String(path).split('.').reduce((o, k) => (o == null ? undefined : Array.isArray(o) && /^\d+$/.test(k) ? o[+k] : o[k]), obj);

// Share of the wanted title's words found in a result title, 0..1 — release
// names carry lots of extra words (author, format, uploader), so containment
// works better than symmetric similarity here.
function similarity(wanted, title) {
  const A = new Set(words(wanted)), B = new Set(words(title));
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((w) => B.has(w) && n++);
  return n / A.size;
}

export function fmtSize(bytes) {
  const n = Number(bytes);
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
}

// Per-addon rate limiting + short result cache.
const calls = new Map();
const cache = new Map();
// Results survive restarts for a few hours, so reopening a book shows its sources at once.
const saved = persisted('sourceCache', {}); // key -> { t, v }
const SAVED_TTL = 6 * 3600e3;
function remembered(key) {
  const hit = cache.get(key) || saved.get()[key];
  return hit && Date.now() - hit.t < (cache.has(key) ? 10 * 60e3 : SAVED_TTL) ? hit.v : null;
}
// When a site doesn't answer: what it found for the same search before (up to 30 days old).
function fallback(addon, attempts) {
  for (const p of attempts) {
    const { title = '', author = '', query = '' } = p;
    const vars = { TITLE: title || query, AUTHOR: author, QUERY: query || [title, author].filter(Boolean).join(' '), LIMIT: '20' };
    const hit = saved.get()[addon.manifest.id + '|' + JSON.stringify(vars)];
    if (hit && Date.now() - hit.t < 30 * 86400e3 && hit.v?.length) return Object.assign([...hit.v], { older: hit.t });
  }
  return null;
}
function remember(key, v) {
  const e = { t: Date.now(), v };
  cache.set(key, e);
  saved.set((c) => {
    const next = { ...c, [key]: e };
    const keys = Object.keys(next);
    if (keys.length > 80) keys.sort((a, b) => next[a].t - next[b].t).slice(0, keys.length - 80).forEach((k) => delete next[k]);
    return next;
  });
}
// Respect an addon's requests-per-minute by waiting for a free slot instead of
// failing the search.
async function takeSlot(addon) {
  const rpm = addon.manifest.rateLimit?.requestsPerMinute;
  if (!rpm) return;
  for (let tries = 0; tries < 30; tries++) {
    const now = Date.now();
    const recent = (calls.get(addon.manifest.id) || []).filter((t) => now - t < 60e3);
    if (recent.length < rpm) {
      recent.push(now);
      calls.set(addon.manifest.id, recent);
      return;
    }
    calls.set(addon.manifest.id, recent);
    await new Promise((r) => setTimeout(r, Math.min(5000, 60e3 - (now - recent[0]) + 50)));
  }
  throw new Error(`${addon.manifest.name}: too many searches right now — try again in a minute`);
}

function cachedFlag(v) {
  if (v === true) return { any: true };
  if (!v || typeof v !== 'object') return { any: false };
  const flat = JSON.stringify(v).toLowerCase();
  return {
    torbox: /torbox|"tb"/.test(flat) && /true|cached|instant/.test(flat) ? !!(v.torbox ?? v.tb ?? v.TorBox ?? true) : false,
    realdebrid: /real|"rd"/.test(flat) && /true|cached|instant/.test(flat) ? !!(v.realdebrid ?? v.rd ?? v.RealDebrid ?? v['real-debrid'] ?? true) : false,
    any: /true|cached|instant/.test(flat),
  };
}

// ---- search ------------------------------------------------------------------
async function run(addon, params, onSlow) {
  // Try the precise search first; if it finds nothing, widen it (title only, then
  // the plain query). A dropped connection or a slow site (often a free server
  // waking up, or a busy search for a popular title) gets one more, longer go.
  const { title = '', author = '', query = '' } = params;
  const attempts = [params];
  if (author) attempts.push({ title, query });
  let lastErr = null;
  for (const p of attempts) {
    for (let retry = 0; retry < 2; retry++) {
      try {
        const r = await runOnce(addon, p, retry);
        if (r.length) return r;
        break;
      } catch (e) {
        lastErr = e;
        if (e.final || /too many searches/.test(e.message)) throw e;
        // Twice too slow: say so rather than make you wait through a wider search too.
        if (retry) {
          if (e.timeout) throw e;
          break;
        }
        if (e.timeout) onSlow?.();
        await new Promise((res) => setTimeout(res, 800));
      }
    }
  }
  if (lastErr) {
    const old = fallback(addon, attempts);
    if (old) return old;
    throw lastErr;
  }
  return [];
}

// The same search already on its way (the book page refreshing, a second list) shares
// that request instead of sending another to a slow site.
const inflight = new Map();
function runOnce(addon, p, retry = 0) {
  const { title = '', author = '', query = '' } = p;
  const vars = { TITLE: title || query, AUTHOR: author, QUERY: query || [title, author].filter(Boolean).join(' '), LIMIT: '20' };
  const key = addon.manifest.id + '|' + JSON.stringify(vars);
  const hit = remembered(key);
  if (hit) return Promise.resolve(hit);
  if (!inflight.has(key)) inflight.set(key, searchOnce(addon, vars, key, p, retry).finally(() => inflight.delete(key)));
  return inflight.get(key);
}

async function searchOnce(addon, vars, key, { title = '', author = '', query = '' }, retry) {
  const src = addon.manifest.adapters.source;
  await takeSlot(addon);

  const req = src.request || {};
  const method = (req.method || 'GET').toUpperCase();
  const url = fill(req.url, vars, true);
  const headers = req.headers || {};
  // Torrent search sites can take a while; the second go waits longer.
  const timeout = Math.max(req.timeout || 0, retry ? 60000 : 30000);
  const data =
    method === 'GET'
      ? await getJson(url, { headers, timeout, fresh: true })
      : await sendJson(url, method, fill(req.body || {}, vars, false), headers, { timeout });

  const res = src.response || {};
  const list = at(data, res.resultsPath);
  // Say why nothing shows instead of failing silently (these aren't retried).
  const why = (msg) => Object.assign(new Error(msg), { final: true });
  const hasData = data && typeof data === 'object' && Object.keys(data).length > 0;
  if ((list === undefined && hasData) || (list != null && !Array.isArray(list)))
    throw why(`unexpected reply — no result list at "${res.resultsPath || '(top level)'}" (keys: ${Object.keys(data || {}).slice(0, 6).join(', ')})`);
  const map = res.mapping || {};
  const get = (row, field) => (map[field] ? at(row, map[field]) : row[field]);
  const threshold = addon.manifest.matching?.threshold ?? 0;
  const wanted = title || query;

  const all = (Array.isArray(list) ? list : [])
    .map((row, i) => {
      const r = {
        key: `${addon.manifest.id}:${i}:${get(row, 'infoHash') || get(row, 'title')}`,
        addon: addon.manifest.name,
        title: String(get(row, 'title') || 'Untitled'),
        author: get(row, 'author') || '',
        narrator: get(row, 'narrator') || '',
        magnet: get(row, 'magnetUrl') || get(row, 'magnet') || '',
        hash: '',
        size: Number(get(row, 'sizeBytes')) || 0,
        seeders: Number(get(row, 'seeders')) || 0,
        format: get(row, 'format') || '',
        language: get(row, 'language') || '',
        date: get(row, 'date') || '',
        cache: cachedFlag(get(row, 'debridCache')),
        link: get(row, 'downloadUrl') || get(row, 'url') || get(row, 'link') || get(row, 'pageUrl') || '',
      };
      r.hash = infoHash(r.magnet, get(row, 'infoHash'));
      r.score = wanted ? similarity(wanted, r.title) : 1;
      return r;
    })
    .filter((r) => r.magnet || r.hash || /^https?:/i.test(r.link));
  if (list?.length && !all.length) throw why(`found ${list.length} result${list.length === 1 ? '' : 's'} but none had a magnet, info-hash or link — check the addon's mapping`);
  // Keep close matches; if the addon's threshold would hide everything, show the best few anyway.
  const close = all.filter((r) => r.score >= Math.min(threshold, 0.9));
  let results = close.length ? close : all.filter((r) => r.score >= 0.34).slice(0, 8);
  // From a book page (title and author known), keep only results for that book.
  if (title && author) results = sameBook(results, title, author);

  results.sort((a, b) => Number(b.cache.any) - Number(a.cache.any) || Number(b.seeders > 0) - Number(a.seeders > 0) || b.score - a.score || b.seeders - a.seeders);
  // For "Report a problem": what was asked and how many came back / were kept.
  noteSearch(addon, url, {
    reply: data == null ? 'empty reply' : Array.isArray(list) ? `${list.length} results` : 'no result list',
    usable: all.length,
    kept: results.filter((r) => !r.loose).length,
    loose: results.filter((r) => r.loose).length,
  });
  // Only remember searches that found something, so a temporary empty answer isn't sticky.
  if (results.length) remember(key, results);
  return results;
}

// The last few searches per source, for Settings → Report a problem.
const searchLog = [];
function noteSearch(addon, url, info) {
  searchLog.push({ t: Date.now(), name: addon.manifest.name, url: redact(url), ...info });
  if (searchLog.length > 12) searchLog.shift();
}
export const recentSearches = () => searchLog.slice();

// The book's author(s) as first and last names: "Vivek H. Murthy, Jane Doe" ->
// { last: [murthy, doe], first: [vivek, jane] } (initials and "Dr" / "PhD" left out).
const NOT_NAMES = new Set(['phd', 'md', 'mrs', 'jr', 'sr', 'prof', 'dr']);
function names(author) {
  const last = [];
  const first = [];
  for (const a of String(author).split(/,|&|\band\b|;/)) {
    const w = words(a).filter((x) => x.length >= 3 && !NOT_NAMES.has(x));
    if (!w.length) continue;
    last.push(w[w.length - 1]);
    if (w.length > 1) first.push(w[0]);
  }
  return { last, first };
}

// Release details that say nothing about which book it is.
const NOISE = /^(\d+|\d+kbps|kbps|mp3|m4b|m4a|aac|flac|opus|epub|pdf|mobi|azw3|audiobook|audio|book|ebook|unabridged|abridged|retail|vbr|cbr|read|narrated|english|eng|web|dl|rip|cd|part|pt|vol|volume|edition|complete|series|full|cast)$/;

/**
 * How surely a result is this book (from a book page, where title and author are known):
 * - title + the author's last name: yes
 * - title + only the first name: yes if the rest of the name is just release details
 *   ("Together (Vivek) MP3"), not other words ("Together Again – Vivek's Show")
 * - a long title (3+ words) with every word present: yes, even without the author
 * Anything else is marked loose: hidden behind "Show loose matches", never lost.
 */
function sameBook(list, title, author) {
  const t = mainTitle(title);
  const tw = new Set(words(t));
  const { last, first } = names(author);
  const long = tw.size >= 3;
  return list.map((r) => {
    const text = `${r.title} ${r.author || ''} ${r.narrator || ''}`;
    let ok = false;
    if (matches(t, text)) {
      const hay = new Set(words(text));
      if (last.some((n) => hay.has(n))) ok = true;
      else if (long && r.score >= 0.6) ok = true;
      else if (first.some((n) => hay.has(n))) {
        const rest = words(r.title).filter((w) => !tw.has(w) && !first.includes(w) && !NOISE.test(w));
        ok = rest.length <= 1;
      }
    }
    return ok ? r : { ...r, loose: true };
  });
}

/**
 * Search the installed source addons (all, or just those named in `only`).
 * `onResult(addonName, results, error, slow)` per addon; `slow` means it's still trying.
 */
export function searchSources(params, onResult, only = null) {
  return Promise.all(
    sourceAddons()
      .filter((a) => !only || only.includes(a.manifest.name))
      .map((a) =>
        run(a, params, () => onResult(a.manifest.name, [], null, true))
          .then((r) => {
            // Show results straight away; which ones TorBox can stream instantly is filled in after.
            // Didn't answer, but found this book before: show that, and say so.
            if (r.older) return onResult(a.manifest.name, r, Object.assign(new Error('older'), { older: r.older }));
            onResult(a.manifest.name, r, null);
            return markInstant(r).then((marked) => marked && onResult(a.manifest.name, marked, null));
          })
          .catch((e) => {
            logError(`source ${a.manifest.name}`, `${e.status ? `HTTP ${e.status} ` : ''}${e.message}`);
            onResult(a.manifest.name, [], e);
          })
      )
  );
}

/** The results again with TorBox's instant (cached) ones marked and moved up, or null if none. */
async function markInstant(results) {
  const instant = await Promise.race([torboxCached(results.map((r) => r.hash)), new Promise((r) => setTimeout(() => r(new Set()), 8000))]);
  if (!instant.size) return null;
  const out = results.map((r) => (instant.has(r.hash) ? { ...r, cache: { ...r.cache, torbox: true, any: true } } : r));
  return out.sort((a, b) => Number(b.cache.any) - Number(a.cache.any) || Number(b.seeders > 0) - Number(a.seeders > 0) || b.score - a.score || b.seeders - a.seeders);
}
