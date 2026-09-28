// Audiohub web relay — a Supabase Edge Function named "relay".
//
// Browsers (Safari on iPhone / iPad) block requests to services that don't
// allow cross-site calls (Hardcover, Audible, Goodreads, StoryShots, …). The web
// app sends only those requests here; this function forwards them and adds the
// headers the browser needs. Nothing is stored or logged.
//
// Deploy either way (same code):
//  • Supabase dashboard → Edge Functions → Deploy a new function → Via Editor →
//    name it  relay  → paste this file → Deploy.
//  • Cloudflare (works best for Safari / iPhone: no gateway in front): dash.cloudflare.com
//    → Workers & Pages → Create → Worker → Deploy → Edit code → paste this file → Deploy,
//    then put the worker's address (https://….workers.dev) in the app's relay box.
// (On Supabase it works with "Enforce JWT verification" on or off: the app signs in
// with your project's public key and sends the services' own tokens along.)
//
// Version 8: also takes one POST with a text body (?env=1) carrying the method,
// headers and body, so browsers skip the CORS pre-check (Safari / iPhone).

// Only these services can be reached through the relay.
const ALLOWED = [
  /^api\.hardcover\.app$/,
  /^api\.audible\.[a-z.]+$/,
  /^www\.goodreads\.com$/,
  /^(www\.)?getstoryshots\.com$/,
  /^itunes\.apple\.com$/,
  /^api\.torbox\.app$/,
  /^api\.real-debrid\.com$/,
  /^openlibrary\.org$/,
  /^www\.googleapis\.com$/,
  /^archive\.org$/,
  /^gutendex\.com$/,
  /^standardebooks\.org$/,
  /^librivox\.org$/,
  /^jsonkeeper\.com$/,
  /(^|\.)knaben\.(org|eu|net|cc)$/,
  /\.workers\.dev$/,
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  // "*" doesn't cover Authorization in browsers, so it's listed explicitly.
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-relay-headers, accept, user-agent',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Relay-Version, Content-Type, Content-Disposition, *',
  'Access-Control-Max-Age': '86400',
  'X-Relay-Version': '8',
};

// Headers meant for Supabase or the browser, never forwarded. The service's own
// headers (e.g. a TorBox or Hardcover token) arrive JSON-encoded in x-relay-headers.
const DROP_REQUEST = ['host', 'origin', 'referer', 'cookie', 'content-length', 'connection', 'authorization', 'apikey', 'x-client-info', 'x-relay-headers', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-real-ip', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'baggage', 'sb-request-id'];
const DROP_RESPONSE = ['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection'];

async function handle(req) {
  if (req.method === 'OPTIONS') {
    // Echo whatever headers the browser asks to send.
    const asked = req.headers.get('access-control-request-headers');
    return new Response('ok', { headers: asked ? { ...CORS, 'Access-Control-Allow-Headers': `${CORS['Access-Control-Allow-Headers']}, ${asked}` } : CORS });
  }
  const target = new URL(req.url).searchParams.get('url') || '';
  let url;
  try {
    url = new URL(target);
  } catch {
    return new Response('Missing or bad ?url=', { status: 400, headers: CORS });
  }
  // Podcast feeds (?feed=1): any https host, GET only, and only XML comes back.
  const feed = new URL(req.url).searchParams.get('feed') === '1';
  const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1)/i.test(url.hostname);
  if (url.protocol !== 'https:' || privateHost || (!feed && !ALLOWED.some((re) => re.test(url.hostname)))) {
    return new Response(`Host not allowed: ${url.hostname}`, { status: 403, headers: CORS });
  }
  const headers = new Headers(req.headers);
  for (const h of DROP_REQUEST) headers.delete(h);
  let method = req.method;
  let body;
  if (new URL(req.url).searchParams.get('env') === '1' && req.method === 'POST') {
    // The pre-check-free form: { method, headers, body } as text.
    headers.delete('content-type');
    try {
      const env = JSON.parse(await req.text());
      method = String(env.method || 'GET').toUpperCase();
      for (const [k, v] of Object.entries(env.headers || {})) if (typeof v === 'string') headers.set(k, v);
      if (typeof env.body === 'string' && method !== 'GET' && method !== 'HEAD') body = env.body;
    } catch {
      return new Response('Bad relay envelope', { status: 400, headers: CORS });
    }
  } else {
    try {
      const extra = JSON.parse(req.headers.get('x-relay-headers') || '{}');
      for (const [k, v] of Object.entries(extra)) if (typeof v === 'string') headers.set(k, v);
    } catch {
      // ignore malformed header bundle
    }
    body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  }
  if (!headers.has('user-agent') || /deno/i.test(headers.get('user-agent') || '')) {
    headers.set('user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
  }
  try {
    if (feed && method !== 'GET') return new Response('Feeds are read-only', { status: 403, headers: CORS });
    const res = await fetch(url, { method, headers, body, redirect: 'follow' });
    if (feed && !/xml|rss|atom|opml/i.test(res.headers.get('content-type') || '')) {
      // Many feeds are served as text/plain or octet-stream: peek at the start.
      const head = (await res.clone().text()).slice(0, 400);
      if (!/<(\?xml|rss|feed|opml)/i.test(head)) return new Response('Not a feed', { status: 403, headers: CORS });
    }
    const out = new Headers(res.headers);
    for (const h of DROP_RESPONSE) out.delete(h);
    for (const [k, v] of Object.entries(CORS)) out.set(k, v);
    return new Response(res.body, { status: res.status, headers: out });
  } catch (e) {
    return new Response(`Relay could not reach ${url.hostname}: ${e instanceof Error ? e.message : e}`, { status: 502, headers: CORS });
  }
}

// Supabase Edge Function (Deno) …
if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(handle);
// … or Cloudflare Worker (paste this same code into a Worker and deploy).
export default { fetch: handle };
