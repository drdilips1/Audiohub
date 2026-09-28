// Small fetch wrapper: timeout, JSON/text helpers and a short-lived memory cache.
// On Android, Capacitor's native HTTP patches fetch(), so sources without CORS work too.

import { Capacitor } from '@capacitor/core';

const cache = new Map();
const TTL = 10 * 60 * 1000;

// ---- Web app (iPhone / iPad) --------------------------------------------------
// Browsers block services that don't allow cross-site requests (CORS). The web
// app sends those through a small relay (a Supabase Edge Function, see
// inkwell/relay/). The Android app talks to everything directly.
const WEB = !Capacitor.isNativePlatform();
const RELAY_HOSTS = /^(api\.hardcover\.app|api\.audible\.[a-z.]+|www\.goodreads\.com|(www\.)?getstoryshots\.com|itunes\.apple\.com)$/i;
const DEFAULT_RELAY = import.meta.env.VITE_SUPABASE_URL ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/relay` : '';

export function relayUrl() {
  try {
    const v = localStorage.getItem('inkwell:relayUrl');
    if (v === 'off') return '';
    return v || DEFAULT_RELAY;
  } catch {
    return DEFAULT_RELAY;
  }
}
export function setRelayUrl(v) {
  try {
    // Empty (or the built-in address) means "use the built-in relay".
    if (!v || v === DEFAULT_RELAY) localStorage.removeItem('inkwell:relayUrl');
    else localStorage.setItem('inkwell:relayUrl', v);
    localStorage.removeItem('inkwell:relayVer');
  } catch {}
}
export const defaultRelayUrl = () => DEFAULT_RELAY;
export const isWeb = WEB;

// The relay's code version, as it last answered (v8 takes the pre-check-free form).
export function relayVersion() {
  try {
    return Number(localStorage.getItem('inkwell:relayVer')) || 0;
  } catch {
    return 0;
  }
}
function rememberRelayVersion(v) {
  try {
    localStorage.setItem('inkwell:relayVer', String(Number(v) || 0));
  } catch {}
}

// Hosts the relay will forward to (keep in step with relay/index.ts). Anything
// else — e.g. your own Audiobookshelf server — must allow the web app directly.
const RELAY_ALLOWED = /^(api\.hardcover\.app|api\.audible\.[a-z.]+|www\.goodreads\.com|(www\.)?getstoryshots\.com|itunes\.apple\.com|api\.torbox\.app|api\.real-debrid\.com|openlibrary\.org|www\.googleapis\.com|archive\.org|gutendex\.com|standardebooks\.org|librivox\.org|jsonkeeper\.com|([a-z0-9-]+\.)*knaben\.(org|eu|net|cc)|[a-z0-9.-]+\.workers\.dev)$/i;
function relayable(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && RELAY_ALLOWED.test(u.hostname);
  } catch {
    return false;
  }
}

const viaRelay = (url) => `${relayUrl()}?url=${encodeURIComponent(url)}`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
// Supabase checks its own Authorization header, so the service's headers travel
// JSON-encoded in x-relay-headers and the relay puts them back.
const relayHeaders = (headers) => ({
  ...(ANON ? { Authorization: `Bearer ${ANON}`, apikey: ANON } : {}),
  'x-relay-headers': JSON.stringify(Object.fromEntries(Object.entries(headers || {}).filter(([k]) => !/^content-type$/i.test(k)))),
  ...Object.fromEntries(Object.entries(headers || {}).filter(([k]) => /^content-type$/i.test(k))),
});
function needsRelay(url) {
  if (!WEB || !relayUrl()) return false;
  try {
    return RELAY_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function request(url, { timeout = 15000, headers, method = 'GET', body, feed = false } = {}) {
  const ctrl = new AbortController();
  let timer;
  // Android's native HTTP ignores abort signals, so also race a timer:
  // a slow server then fails with a clear error instead of hanging forever.
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      const e = new Error(`Timed out after ${Math.round(timeout / 1000)}s — pull down to try again`);
      e.timeout = true;
      reject(e);
    }, timeout);
  });
  try {
    const go = (u, h, m = method, b = body) => Promise.race([fetch(u, { method: m, headers: h, body: b, signal: ctrl.signal }), timedOut]);
    // Podcast feeds live on countless hosts: the relay fetches those read-only (?feed=1, XML only).
    const relayed = async () => {
      const u = viaRelay(url) + (feed ? '&feed=1' : '');
      const fromRelay = (r) => {
        const v = r.headers.get('x-relay-version');
        if (v) rememberRelayVersion(v);
        return !!v;
      };
      // Relay v8+: one POST with a text body and the public key in the address. Browsers
      // send that without a CORS pre-check, which Safari (every iPhone browser) is
      // fussiest about. The service's own method, headers and body travel inside it.
      if (relayVersion() >= 8 && (body == null || typeof body === 'string')) {
        try {
          const r = await go(`${u}&env=1${ANON ? `&apikey=${encodeURIComponent(ANON)}` : ''}`, { 'Content-Type': 'text/plain' }, 'POST', JSON.stringify({ method, headers: headers || {}, body: body ?? null }));
          if (fromRelay(r)) return r;
        } catch (e) {
          if (e.timeout) throw e;
        }
      }
      // A plain GET also skips the pre-check. Only trusted if the relay itself answered
      // (Supabase's gateway may refuse a request without the key).
      if (method === 'GET' && !Object.keys(headers || {}).length) {
        try {
          const r = await go(`${u}${ANON ? `&apikey=${encodeURIComponent(ANON)}` : ''}`, undefined);
          if (fromRelay(r)) return r;
        } catch (e) {
          if (e.timeout) throw e;
        }
      }
      const r = await go(u, relayHeaders(headers));
      fromRelay(r);
      return r;
    };
    let res;
    if (needsRelay(url)) res = await relayed();
    else {
      try {
        res = await go(url, headers);
      } catch (e) {
        // In a browser a CORS block looks like a network error: try the relay once.
        if (!WEB || e.timeout || !relayUrl() || !(relayable(url) || (feed && /^https:/i.test(url)))) throw e;
        res = await relayed();
      }
    }
    if (!res.ok) {
      let detail = '';
      try {
        const text = await res.text();
        try {
          const j = JSON.parse(text);
          detail = j.message || j.detail || j.error_description || (typeof j.error === 'string' ? j.error : '') || (typeof j.result === 'string' ? j.result : '') || '';
        } catch {}
        if (!detail) detail = text.slice(0, 160).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      } catch {}
      const relayMissing = WEB && res.status === 404 && /\/functions\/v1\/relay/.test(res.url || '') && /function/i.test(detail);
      const err = new Error(relayMissing ? 'This service needs the web relay — see Settings → Web app' : `HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
      err.url = url.replace(/([?&](token|apikey|api_key)=)[^&]+/gi, '$1…');
      err.status = res.status;
      throw err;
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson(url, opts = {}) {
  const key = opts.method && opts.method !== 'GET' ? null : 'j:' + url + JSON.stringify(opts.headers || {});
  if (key && !opts.fresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < TTL) return hit.v;
  }
  const res = await request(url, opts);
  const v = await res.json();
  if (key) cache.set(key, { t: Date.now(), v });
  return v;
}

export async function getText(url, opts = {}) {
  const key = 't:' + url;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const res = await request(url, { timeout: 30000, ...opts });
  const v = await res.text();
  cache.set(key, { t: Date.now(), v });
  return v;
}

/**
 * Download a file's bytes (ebooks etc.). A plain fetch: on Android, Capacitor
 * routes GETs through its native proxy, which streams binary data directly
 * (the CapacitorHttp plugin would hand it over as one huge base64 string,
 * which froze the app on big ebooks).
 */
export async function getBytes(url, { timeout = 180000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The download took too long — try again');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Remove whitespace and invisible characters that phone keyboards like to insert
// (e.g. "http:// 192.168.1.2"), and add a scheme when one is missing.
export function cleanUrl(u, defaultScheme = 'https') {
  u = String(u || '').replace(/[\s\u200B-\u200D\uFEFF\u00A0]+/g, '');
  if (u && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = `${defaultScheme}://${u}`;
  return u;
}

/** Any request, returning the response text (no caching). */
export async function requestText(url, opts = {}) {
  const res = await request(url, opts);
  return res.text();
}

/** Any request, returning { status, text, headers } (no caching). */
export async function requestFull(url, opts = {}) {
  const res = await request(url, opts);
  return { status: res.status, text: await res.text().catch(() => ''), headers: res.headers };
}

export function sendForm(url, method, params, headers = {}, { timeout } = {}) {
  return request(url, {
    method,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: qs(params),
    ...(timeout ? { timeout } : {}),
  }).then((r) => (r.status === 204 ? null : r.json().catch(() => null)));
}

export function sendJson(url, method, data, headers = {}) {
  return request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  }).then((r) => (r.status === 204 ? null : r.json().catch(() => null)));
}

export function clearHttpCache() {
  cache.clear();
}

export const qs = (params) =>
  Object.entries(params)
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

/** Web app: is the relay deployed, and which version? */
export async function probeRelay() {
  const url = relayUrl();
  if (!url) return { ok: false, error: 'Relay is switched off' };
  // Open Library: generous with shared addresses (Apple rate-limits Cloudflare's).
  const target = 'https://openlibrary.org/search.json?q=habit&limit=1&fields=title';
  const key = ANON ? `&apikey=${encodeURIComponent(ANON)}` : '';
  const version = (res) => Number(res.headers.get('x-relay-version')) || 0;
  const tries = [
    ['text', () => fetch(`${viaRelay(target)}&env=1${key}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ method: 'GET', headers: {}, body: null }) })],
    ['plain', () => fetch(viaRelay(target) + key)],
    ['key', () => fetch(viaRelay(target), { headers: relayHeaders({}) })],
  ];
  const seen = [];
  for (const [how, run] of tries) {
    let res;
    try {
      res = await run();
    } catch (e) {
      seen.push(`${how}: ${e.message}`);
      continue;
    }
    const v = version(res);
    // The relay answered (whatever the service behind it said): it works.
    if (v) {
      rememberRelayVersion(v);
      // Works — but Safari / iPhone need the pre-check-free form (v8).
      if (v < 8) return { ok: true, version: v, how, error: '', note: 'Works here. For Safari and iPhone, copy the new relay code (v8) below and deploy it again' };
      return { ok: true, version: v, how, error: '' };
    }
    seen.push(`${how}: HTTP ${res.status}${v ? '' : ' (from Supabase, not the relay)'}`);
    if (res.status === 503 || res.status === 540) return { ok: false, error: `Supabase answered ${res.status} — your project may be paused: open supabase.com and restore it` };
  }
  const host = url.replace(/^https?:\/\//, '');
  const all = seen.join(' · ');
  if (/HTTP 404/.test(all) && !/Load failed|Failed to fetch/i.test(all))
    return { ok: false, error: `Supabase says there's nothing at ${host}${url !== DEFAULT_RELAY && DEFAULT_RELAY ? ' — this browser uses its own relay address: tap "Use built-in address" below' : ' — deploy the relay (steps below)'}` };
  if (/HTTP 401/.test(all)) return { ok: false, error: 'Supabase refused the request (401): open the relay function in Supabase and turn off "Verify JWT", then Check again' };
  return { ok: false, error: `Can't reach the relay at ${host} (${all}). Copy the new relay code (v8) below and deploy it again; if it still fails, a content blocker, iCloud Private Relay or "Limit IP address tracking" may be blocking supabase.co` };
}
