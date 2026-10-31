// Shared quotes: a highlight, note or transcript quote as a link (and a quote card image)
// that another Audiohub user can open — to read it, or to play / read the book from there.
// The quote travels inside the link itself (nothing is stored on a server):
//   https://api.audiohubapp.com/q/<data>   (a web page anyone can read; "Open in Audiohub")
//   audiohub://q/<data>                    (opens the app straight away)
import { Capacitor, registerPlugin, CapacitorHttp } from '@capacitor/core';
import { persisted, library, progress } from './store.js';
import { sameWork, preferred } from './works.js';
import { fmtTime } from './format.js';

const Web = registerPlugin('InkwellWeb');
const native = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');
export const SHARE_BASE = 'https://api.audiohubapp.com/q/';

const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/**
 * A quote to share: { kind: 'audio' | 'text', title, author, cover, quote, note, global }
 * (global: seconds into the whole audiobook).
 */
function packQuote(q) {
  return {
    v: 1,
    k: q.kind === 'text' ? 'e' : 'a',
    t: String(q.title || '').slice(0, 140),
    a: String(q.author || '').slice(0, 80),
    q: String(q.quote || '').slice(0, 600),
    ...(q.note ? { n: String(q.note).slice(0, 1200) } : {}),
    ...(q.cover && /^https:\/\//.test(q.cover) && q.cover.length < 300 ? { c: q.cover } : {}),
    ...(q.kind !== 'text' && q.global >= 0 ? { g: Math.round(q.global) } : {}),
  };
}
const unpack = (d) =>
  d?.t && d?.q ? { kind: d.k === 'e' ? 'text' : 'audio', title: d.t, author: d.a || '', quote: d.q, note: d.n || '', cover: d.c || '', global: d.g ?? null } : null;

/** The long link: the quote itself, inside the link (works without the server keeping it). */
export function quoteLink(q) {
  const d = packQuote(q);
  return SHARE_BASE + b64u(JSON.stringify({ ...d, ...(d.n ? { n: d.n.slice(0, 400) } : {}) }));
}

/** A short link (the server keeps the quote), or null when that isn't available. */
export async function shortLink(q) {
  try {
    const body = JSON.stringify(packQuote(q));
    const timeout = new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 5000));
    const r = native
      ? await Promise.race([CapacitorHttp.post({ url: SHARE_BASE.replace(/\/q\/$/, '/q'), headers: { 'Content-Type': 'application/json' }, data: body, connectTimeout: 5000, readTimeout: 5000 }), timeout])
      : await Promise.race([fetch(SHARE_BASE.replace(/\/q\/$/, '/q'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).then(async (x) => ({ status: x.status, data: await x.json() })), timeout]);
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    return r.status < 300 && d?.url ? d.url : null;
  } catch {
    return null;
  }
}

/** The quote in a shared link (either form; a short one is { short: id } until resolved), or null. */
export function parseQuoteLink(url) {
  const u = String(url || '').trim();
  const s = /(?:api\.audiohubapp\.com\/q\/s\/|^(?:audiohub|app\.inkwell\.books):\/\/q\/s\/)([A-Za-z0-9]{5,12})/.exec(u);
  if (s) return { short: s[1] };
  const m = /(?:api\.audiohubapp\.com\/q\/|^(?:audiohub|app\.inkwell\.books):\/\/q\/)([A-Za-z0-9_-]{8,})/.exec(u);
  if (!m) return null;
  try {
    return unpack(JSON.parse(unb64u(m[1])));
  } catch {
    return null;
  }
}

/** A parsed link made whole: a short link's quote fetched from the server. */
export async function resolveQuote(p) {
  if (!p?.short) return p;
  const url = `${SHARE_BASE}s/${p.short}.json`;
  const r = native ? await CapacitorHttp.get({ url, connectTimeout: 8000, readTimeout: 8000 }) : await fetch(url).then(async (x) => ({ status: x.status, data: await x.json() }));
  const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  const q = r.status < 300 ? unpack(d) : null;
  if (!q) throw new Error('This shared quote has expired or the link is broken');
  return q;
}

export const atLabel = (q) => (q.kind === 'audio' && q.global != null ? fmtTime(q.global) : '');

// ---- receiving -----------------------------------------------------------------
// The open quote (shown by SharedQuoteSheet) and the one waiting until you have the book.
export const sharedQuote = persisted('sharedQuote', { open: null, pending: null });

export async function openSharedQuote(q) {
  // A short link: fetch the quote first.
  if (q?.short) {
    try {
      q = await resolveQuote(q);
    } catch (e) {
      const { toast } = await import('../components/common.jsx');
      return toast(e.message);
    }
  }
  sharedQuote.set((s) => ({ ...s, open: q }));
}

/** Your copy of the quoted book (audiobook or ebook, as quoted), if you have one. */
export function findMine(q) {
  const want = { title: q.title, author: q.author };
  const prog = progress.get();
  const all = [...Object.values(library.get()), ...Object.values(prog).map((p) => p?.book)].filter(Boolean);
  const fits = all.filter((b) => sameWork(b, want) && (q.kind === 'text' ? b.kind === 'text' : b.kind !== 'text'));
  return fits.length ? preferred(fits) : null;
}

/** The quote waiting for this book (once you have it), if any. */
export function pendingFor(book) {
  const p = sharedQuote.get().pending;
  return p && sameWork(book, { title: p.title, author: p.author }) ? p : null;
}
export const clearPending = () => sharedQuote.set((s) => ({ ...s, pending: null }));

/** The paragraph of an ebook that holds the quote (its first words), or -1. */
export function findQuoteBlock(blocks, quote) {
  const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const words = norm(quote).split(' ').filter(Boolean);
  for (const n of [8, 5, 3]) {
    if (words.length < Math.min(n, 3)) continue;
    const probe = words.slice(0, n).join(' ');
    const i = blocks.findIndex((b) => norm(b.textContent).includes(probe));
    if (i >= 0) return i;
  }
  return -1;
}

// ---- sharing -------------------------------------------------------------------
async function coverData(url) {
  if (!url) return null;
  try {
    if (native) {
      const r = await CapacitorHttp.get({ url, responseType: 'blob', connectTimeout: 10000, readTimeout: 15000 });
      if (r.status >= 400 || !r.data) return null;
      const type = (r.headers?.['Content-Type'] || r.headers?.['content-type'] || 'image/jpeg').split(';')[0];
      return String(r.data).startsWith('data:') ? r.data : `data:${type};base64,${r.data}`;
    }
    const blob = await (await fetch(url, { mode: 'cors' })).blob();
    return await new Promise((ok) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const loadImg = (src) =>
  new Promise((ok, bad) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = bad;
    i.src = src;
  });

/**
 * Words into lines of at most `width`, balanced like a printed page: the breaks are
 * chosen together so no line is left with a big gap (the last line may be short).
 */
function wrap(ctx, text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const w = words.map((x) => ctx.measureText(x).width);
  const space = ctx.measureText(' ').width;
  const n = words.length;
  const best = new Array(n + 1).fill(Infinity);
  const from = new Array(n + 1).fill(0);
  best[0] = 0;
  for (let i = 1; i <= n; i++) {
    let len = -space;
    for (let j = i - 1; j >= 0; j--) {
      len += w[j] + space;
      if (len > width && j < i - 1) break;
      const slack = Math.max(0, width - len);
      const cost = i === n ? 0 : (slack / width) ** 2 * 100 + (i - j === 1 ? 4 : 0);
      if (best[j] + cost < best[i]) {
        best[i] = best[j] + cost;
        from[i] = j;
      }
    }
  }
  const lines = [];
  for (let i = n; i > 0; i = from[i]) lines.unshift(words.slice(from[i], i));
  return lines;
}

/** Lines of words, justified like a printed page (the last line, and lone words, ragged). */
function drawJustified(ctx, lines, x, y, width, lead, last = true) {
  lines.forEach((words, n) => {
    const final = n === lines.length - 1 && last;
    if (final || words.length < 2) {
      ctx.fillText(words.join(' '), x, y + n * lead);
      return;
    }
    const used = words.reduce((sum, w) => sum + ctx.measureText(w).width, 0);
    const gap = (width - used) / (words.length - 1);
    // Only a line of two or three words would gape badly: leave that one ragged.
    if (words.length < 4 && gap > ctx.measureText(' ').width * 4) return ctx.fillText(words.join(' '), x, y + n * lead);
    let at = x;
    for (const w of words) {
      ctx.fillText(w, at, y + n * lead);
      at += ctx.measureText(w).width + gap;
    }
  });
}

// The card's looks: the paper of a book, the cover's own colours, or ink on night.
export const CARD_STYLES = ['paper', 'cover', 'night'];
const LOOK = {
  paper: { bg: '#f5eee2', ink: '#2a2119', soft: '#7a6a58', accent: '#c2410c', mark: 'rgba(194,65,12,0.16)' },
  cover: { bg: '#15110d', ink: '#fffaf2', soft: 'rgba(255,245,230,0.72)', accent: '#ffb35c', mark: 'rgba(255,255,255,0.14)' },
  night: { bg: '#0f0d0b', ink: '#f2ebe1', soft: '#9b8f80', accent: '#f7931e', mark: 'rgba(247,147,30,0.18)' },
};

/** The quote card (1080×1350 JPEG, base64 without the data: prefix). */
export async function quoteCard(q, style = 'paper') {
  const W = 1080, H = 1350, P = 104;
  const L = LOOK[style] || LOOK.paper;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  const serif = "'Literata Variable', Georgia, serif";
  const sans = "'Figtree Variable', system-ui, sans-serif";
  try {
    await document.fonts?.load(`400 60px ${serif}`);
    await document.fonts?.load(`700 30px ${sans}`);
  } catch {}
  const coverSrc = await coverData(q.cover);
  const cover = coverSrc ? await loadImg(coverSrc).catch(() => null) : null;

  // Background.
  x.fillStyle = L.bg;
  x.fillRect(0, 0, W, H);
  if (style === 'cover' && cover) {
    // The cover itself, blurred and deepened: every book gets its own colours.
    const k = Math.max(W / cover.width, H / cover.height) * 1.2;
    x.filter = 'blur(60px) saturate(1.5)';
    x.drawImage(cover, (W - cover.width * k) / 2, (H - cover.height * k) / 2, cover.width * k, cover.height * k);
    x.filter = 'none';
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(10,8,6,0.45)');
    g.addColorStop(0.6, 'rgba(10,8,6,0.62)');
    g.addColorStop(1, 'rgba(10,8,6,0.85)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  } else if (style === 'paper') {
    // A faint page grain and a soft edge.
    const g = x.createRadialGradient(W / 2, H * 0.4, 200, W / 2, H / 2, H * 0.8);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(120,90,50,0.12)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  } else {
    const g = x.createRadialGradient(W, 0, 50, W * 0.7, H * 0.3, H);
    g.addColorStop(0, 'rgba(247,147,30,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  }

  // Opening mark.
  x.fillStyle = L.accent;
  x.font = `700 170px ${serif}`;
  x.fillText('“', P - 10, 228);

  // The quote as large as fits, justified, with your note under it (a long note — an AI
  // explanation, say — is shortened here; the full text goes with the message).
  const quote = String(q.quote).trim().replace(/\s+/g, ' ');
  const top = 270;
  const end = H - 330; // where the book row begins
  const width = W - P * 2;
  const NOTE = 34, NLEAD = 48;
  x.font = `500 ${NOTE}px ${sans}`;
  const noteAll = q.note ? wrap(x, String(q.note).replace(/\s+/g, ' '), width - 40) : [];
  let cut = false;
  let size = 64, lead = 0, lines = [], nl = [];
  const noteH = (n) => (n ? 70 + n * NLEAD : 0);
  for (; size >= 32; size -= 2) {
    x.font = `400 ${size}px ${serif}`;
    lead = size * 1.42;
    lines = wrap(x, quote, width);
    // The note gets up to 6 lines, fewer when the quote needs the room (at least 2).
    const room = end - top - lines.length * lead;
    const fitN = Math.floor((room - 70) / NLEAD);
    nl = noteAll.slice(0, Math.max(0, Math.min(6, fitN)));
    if (lines.length * lead + noteH(nl.length) <= end - top && (nl.length >= Math.min(2, noteAll.length) || size === 32)) break;
  }
  if (nl.length < noteAll.length) {
    cut = true;
    if (nl.length) nl[nl.length - 1] = [...nl[nl.length - 1], '…'];
  }
  const maxQ = Math.floor((end - top - noteH(nl.length)) / lead);
  if (lines.length > maxQ) {
    cut = true;
    lines = lines.slice(0, Math.max(1, maxQ));
    lines[lines.length - 1] = [...lines[lines.length - 1].slice(0, -1), lines[lines.length - 1].slice(-1)[0] + '…'];
  }
  // A short quote sits in the middle of the space, not at the top.
  const blockH = lines.length * lead + noteH(nl.length);
  const y0 = top + Math.max(0, (end - top - blockH) / 2.4);
  x.fillStyle = L.ink;
  x.font = `400 ${size}px ${serif}`;
  // A few lines read best ragged; a longer passage justified, like a page.
  if (lines.length >= 4) drawJustified(x, lines, P, y0 + size, width, lead);
  else lines.forEach((words, n) => x.fillText(words.join(' '), P, y0 + size + n * lead));
  let y = y0 + size + (lines.length - 1) * lead;
  if (nl.length) {
    y += 84;
    x.font = `500 ${NOTE}px ${sans}`;
    x.fillStyle = L.accent;
    x.fillRect(P, y - 32, 6, nl.length * NLEAD - 8);
    x.fillStyle = L.soft;
    nl.forEach((words, n) => x.fillText(words.join(' '), P + 34, y + n * NLEAD));
  }

  // The book: a rule, the cover, title, author, where.
  const by = H - P - 132;
  x.fillStyle = L.mark;
  x.fillRect(P, by - 44, width, 2);
  let tx = P;
  if (cover) {
    const ch = 132, cw = Math.round(Math.min(ch, (cover.width / cover.height) * ch));
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.35)';
    x.shadowBlur = 24;
    x.shadowOffsetY = 8;
    const rr = new Path2D();
    rr.roundRect(P, by, cw, ch, 10);
    x.fill(rr);
    x.restore();
    x.save();
    x.clip(rr);
    x.drawImage(cover, P, by, cw, ch);
    x.restore();
    tx = P + cw + 30;
  }
  const room = W - tx - P;
  const fit = (text, font) => {
    x.font = font;
    let t = String(text || '');
    while (t && x.measureText(t).width > room) t = t.slice(0, -2).trimEnd() + '…';
    return t;
  };
  x.fillStyle = L.ink;
  x.fillText(fit(q.title, `700 40px ${sans}`), tx, by + 46);
  x.fillStyle = L.soft;
  x.fillText(fit(q.author, `500 32px ${sans}`), tx, by + 90);
  const at = atLabel(q);
  x.fillStyle = L.accent;
  x.font = `700 24px ${sans}`;
  x.fillText((q.kind === 'text' ? 'EBOOK' : at ? `AUDIOBOOK · ${at}` : 'AUDIOBOOK') + '   ·   AUDIOHUB', tx, by + 128);
  return { data: c.toDataURL('image/jpeg', 0.92).split(',')[1], cut };
}

// ---- sharing: a sheet with the card's look, then the picture (or text) -----------
const subs = new Set();
let pendingShare = null;
/** The quote waiting in the share sheet (a tiny store for useStore). */
export const shareRequest = {
  get: () => pendingShare,
  set(v) {
    pendingShare = v;
    subs.forEach((f) => f(v));
  },
  subscribe(f) {
    subs.add(f);
    return () => subs.delete(f);
  },
};
export const cardStyle = persisted('quoteCardStyle', 'paper');

/** Share a quote: opens the share sheet (look, picture or text). */
export async function shareQuote(q) {
  shareRequest.set(q);
}

const byline = (q) => `${q.title}${q.author ? `, ${q.author}` : ''}${atLabel(q) ? ` (at ${atLabel(q)})` : ''}`;

/** The words for the message: short with a picture; everything as text (or when the picture had to shorten it). */
export function quoteMessage(q, link, full) {
  const open = `▶ Open in Audiohub: ${link}`;
  if (!full) return `From “${q.title}”${q.author ? ` by ${q.author}` : ''}${atLabel(q) ? ` · at ${atLabel(q)}` : ''}\n${open}`;
  return `“${q.quote}”\n— ${byline(q)}${q.note ? `\n\n${q.note}` : ''}\n\n${open}`;
}

/** Send it: `card` = { data, cut } for a picture, or null for text only. */
export async function sendQuote(q, card) {
  const link = (await shortLink(q)) || quoteLink(q);
  const text = quoteMessage(q, link, !card || card.cut);
  if (card && native) return Web.shareImage({ data: card.data, name: 'audiohub-quote.jpg', mime: 'image/jpeg', text, title: 'Share quote' });
  if (native) return Web.shareText({ text, title: 'Share quote' });
  if (navigator.share) return navigator.share({ text }).catch(() => {});
  await navigator.clipboard?.writeText(text);
  return 'copied';
}
