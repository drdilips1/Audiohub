// EPUB → reader HTML: unzip in the app, follow the spine (reading order) and
// turn the chapters into one sanitized document with inline images, in the
// same { html, headings } shape the reader uses for Gutenberg books.
import { unzip, strFromU8 } from 'fflate';
import { details as cloudDetails } from '../sources/debrid.js';
import { getBytes } from './http.js';
import { textBlocks, speakable } from './tts.js';

const IMG_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

// Resolve "../Images/a.jpg" against "OEBPS/Text/ch1.xhtml".
function join(base, rel) {
  const parts = base.split('/').slice(0, -1);
  for (const seg of decodeURIComponent(rel.split('#')[0]).split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');

/** Share of an element's text that is link text (contents pages are nearly all links). */
export function linkDense(el) {
  const all = el.textContent.replace(/\s+/g, '').length;
  if (!all) return false;
  const links = [...el.querySelectorAll('a')];
  const inLinks = links.reduce((a, l) => a + l.textContent.replace(/\s+/g, '').length, 0);
  return (el.tagName === 'A' ? 1 : inLinks / all) >= 0.7;
}

const SKIP_TYPES = { toc: 'contents', index: 'index', 'copyright-page': 'copyright', cover: 'cover', landmarks: 'contents', loi: 'contents', lot: 'contents' };
const SKIP_TITLE = /^\s*(table of contents|contents|index|copyright|list of (illustrations|figures|tables|maps))\s*$/i;

// ---- where the actual book starts ------------------------------------------------
const START_HEADING = /^\s*(chapter|part|book)\s+(1|one|i)\b|^\s*(prologue|chapter\s*1)\b|^\s*(1|i|one)\s*$/i;
const plain = (html) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

/**
 * Index (in reading order) of the first page of the book proper. Uses the book's
 * own marker when it has one (EPUB 3 "bodymatter" landmark, EPUB 2 guide "text"),
 * otherwise the first page headed Chapter 1 / Part One / Prologue, otherwise the
 * first long page of text. 0 when unsure — nothing is skipped then.
 */
function findBodyStart(order, manifest, guide, files, opfPath, text) {
  const indexOf = (href) => order.findIndex((m) => m.href === href.split('#')[0]);
  // Front matter is rarely more than a dozen pages (or 40% of a short book).
  const maxFront = Math.min(order.length - 1, Math.max(12, Math.floor(order.length * 0.4)));
  const sane = (i) => i > 0 && i <= maxFront;
  // EPUB 3 landmarks in the navigation document
  const nav = Object.values(manifest).find((m) => /\bnav\b/.test(m.props));
  if (nav && files[nav.href]) {
    const doc = new DOMParser().parseFromString(text(nav.href), 'application/xhtml+xml');
    for (const a of doc.querySelectorAll('a')) {
      const types = `${a.getAttribute('epub:type') || ''} ${a.closest('li')?.getAttribute('epub:type') || ''}`;
      if (/\bbodymatter\b/.test(types)) {
        const i = indexOf(join(nav.href, a.getAttribute('href') || ''));
        if (sane(i)) return i;
      }
    }
  }
  // EPUB 2 guide
  for (const [href, type] of Object.entries(guide)) {
    if (type === 'text' || type === 'start') {
      const i = indexOf(href);
      if (sane(i)) return i;
    }
  }
  // Heading that says Chapter 1 / Part One / Prologue
  const limit = maxFront + 1;
  for (let i = 0; i < limit; i++) {
    const raw = text(order[i].href);
    const h = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(raw);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
    if ((h && START_HEADING.test(plain(h[1]))) || (title && START_HEADING.test(plain(title[1])))) return sane(i) ? i : 0;
  }
  // First long page of text (title, copyright, dedication pages are short)
  for (let i = 0; i < limit; i++) {
    const t = plain(text(order[i].href));
    if (t.length > 2500 && !/copyright|all rights reserved|isbn/i.test(t.slice(0, 600))) return sane(i) ? i : 0;
  }
  return 0;
}

const BACK_TITLE = /^\s*(also by|by the same author|praise for|about the publisher|other (books|titles) by|more from|newsletter|discover more)\b/i;
/** Publisher pages at the back ("Also by…", "Praise for…"): left out of Listen too. */
function backMatter(body, docTitle) {
  const heading = body.querySelector('h1,h2,h3')?.textContent || docTitle || '';
  return BACK_TITLE.test(heading) ? 'back' : '';
}

/** Is this chapter file front/back matter to leave out of Listen and Read aloud? */
function skipKind(body, m, guideType, docTitle) {
  if (/\bnav\b/.test(m.props)) return 'contents';
  if (guideType && SKIP_TYPES[guideType]) return SKIP_TYPES[guideType];
  const top = [body, ...body.children, ...[...body.children].flatMap((c) => [...c.children])];
  for (const el of top) {
    const t = (el.getAttribute('epub:type') || '').toLowerCase();
    for (const k of t.split(/\s+/)) if (SKIP_TYPES[k]) return SKIP_TYPES[k];
  }
  const heading = body.querySelector('h1,h2,h3')?.textContent || docTitle || '';
  if (SKIP_TITLE.test(heading)) return /index/i.test(heading) ? 'index' : /copyright/i.test(heading) ? 'copyright' : 'contents';
  const links = body.querySelectorAll('a').length;
  if (links >= 5 && linkDense(body)) return 'contents';
  return '';
}

// Presentational attributes that squeeze or shift the text in the reader.
const DROP_ATTRS = /^(on|style$|class$|epub:|xmlns|width$|height$|align$|valign$|border$|cellpadding$|cellspacing$|bgcolor$|color$|face$|size$|dir$|xml:)/;
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/** Unzip without blocking the app (fflate unpacks in a background worker). */
const unzipAsync = (bytes) =>
  new Promise((resolve, reject) =>
    unzip(bytes, (err, files) => (err ? reject(new Error("This file isn't a readable EPUB")) : resolve(files)))
  );

/**
 * Returns { html, headings, title, author, urls }. `bytes` is the EPUB file
 * (Uint8Array). Works in small steps so a big book never freezes the app.
 */
export async function epubToHtml(bytes) {
  const files = await unzipAsync(bytes);
  const text = (path) => (files[path] ? strFromU8(files[path]) : '');
  const container = parseXml(text('META-INF/container.xml'));
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path') || Object.keys(files).find((f) => f.endsWith('.opf'));
  if (!opfPath || !files[opfPath]) throw new Error("This EPUB has no table of contents (OPF) — it can't be read in the app");
  if (files['META-INF/encryption.xml'] && /EncryptedData/.test(text('META-INF/encryption.xml')) && !/font/i.test(text('META-INF/encryption.xml')))
    throw new Error('This EPUB is DRM-protected, so it can only be opened in the store app it came from');
  const opf = parseXml(text(opfPath));
  const manifest = {};
  opf.querySelectorAll('manifest > item').forEach((it) => (manifest[it.getAttribute('id')] = { href: join(opfPath, it.getAttribute('href') || ''), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' }));
  // EPUB 2 "guide": which files are the contents, index, copyright page…
  const guide = {};
  opf.querySelectorAll('guide > reference').forEach((r) => (guide[join(opfPath, (r.getAttribute('href') || '').split('#')[0])] = (r.getAttribute('type') || '').toLowerCase()));
  const order = [...opf.querySelectorAll('spine > itemref')].map((r) => manifest[r.getAttribute('idref')]).filter((m) => m && /html/.test(m.type) && files[m.href]);
  if (!order.length) throw new Error('This EPUB has no readable chapters');
  // Where the book itself starts (Chapter 1 / Prologue…): pages before it are front matter.
  const bodyStart = findBodyStart(order, manifest, guide, files, opfPath, text);

  const urls = new Map(); // image path -> blob URL
  const imageUrl = (path) => {
    if (!files[path]) return '';
    if (!urls.has(path)) urls.set(path, URL.createObjectURL(new Blob([files[path]], { type: IMG_TYPES[path.split('.').pop().toLowerCase()] || 'image/*' })));
    return urls.get(path);
  };

  const out = document.createElement('div');
  const paras = [];
  for (let ci = 0; ci < order.length; ci++) {
    const m = order[ci];
    if (ci % 4 === 3) await nextFrame(); // let the app breathe between chapters
    const raw = text(m.href);
    let doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml');
    if (doc.querySelector('parsererror') || !doc.body) doc = new DOMParser().parseFromString(raw, 'text/html');
    const body = doc.body || doc.documentElement;
    body.querySelectorAll('script,style,link,meta,iframe,object,embed,form').forEach((n) => n.remove());
    const skip = skipKind(body, m, guide[m.href], doc.title) || (ci < bodyStart ? 'front' : '') || backMatter(body, doc.title);
    body.querySelectorAll('*').forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'img' || tag === 'image') {
        const src = el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href') || '';
        const img = document.createElement('img');
        const u = src && !/^[a-z]+:/i.test(src) ? imageUrl(join(m.href, src)) : '';
        if (!u) return el.remove();
        img.src = u;
        img.loading = 'lazy';
        img.alt = el.getAttribute('alt') || '';
        el.replaceWith(img);
        return;
      }
      if (tag === 'font' || tag === 'center' || tag === 'big' || tag === 'small') {
        el.replaceWith(...el.childNodes); // keep the text, drop the old formatting tag
        return;
      }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        if (DROP_ATTRS.test(n)) el.removeAttribute(a.name);
        if ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      }
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        if (/^https?:/i.test(href)) el.setAttribute('target', '_blank');
        else el.removeAttribute('href'); // internal links: the reader scrolls instead
      }
    });
    // svg wrappers left empty after image replacement
    body.querySelectorAll('svg').forEach((s) => !s.querySelector('img') && !s.textContent.trim() && s.remove());
    const section = document.createElement('section');
    section.className = 'chapter';
    section.id = 'iw-c-' + ci;
    if (skip) section.dataset.skip = skip;
    section.innerHTML = body.innerHTML;
    // Paragraphs for Listen, worked out here chapter by chapter (not all at once later).
    for (const el of textBlocks(section)) paras.push({ heading: /^H[1-4]$/.test(el.tagName), text: speakable(el.textContent), skip: !!skip || linkDense(el) });
    out.appendChild(section);
  }
  const headings = [...out.querySelectorAll('h1,h2,h3')]
    .map((h, i) => {
      h.id ||= 'iw-h-' + i;
      return { id: h.id, text: h.textContent.replace(/\s+/g, ' ').trim(), level: +h.tagName[1] };
    })
    .filter((h) => h.text && h.text.length < 120);
  const meta = (sel) => opf.getElementsByTagName(sel)[0]?.textContent?.trim() || '';
  return { html: out.innerHTML, headings, paras, title: meta('dc:title'), author: meta('dc:creator'), urls: [...urls.values()] };
}

// ---- ebooks in your TorBox / Real-Debrid -------------------------------------

/** Reader UIDs for cloud ebooks look like "tb:t:123#ebook" (kept apart from the item's audio progress). */
export const isCloudEbook = (book) => /^(tb|rd|src):/.test(book?.uid || '') && book.uid.endsWith('#ebook');

// ---- direct ebook links from source addons (e.g. Bookracy) -------------------

const EBOOK_FORMATS = /^(epub|pdf|mobi|azw3?|fb2|djvu|cbz|cbr|txt)$/i;
const EBOOK_EXT = /\.(epub|pdf|mobi|azw3?|fb2|djvu|cbz|cbr|txt)(?:$|[?#&])/i;

// Short stable id for a link, so reading progress survives app restarts.
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** The ebook file behind a source result's direct link, or null when it isn't an ebook. */
export function directEbookFile(r) {
  const link = r?.link || '';
  if (!/^https?:/i.test(link)) return null;
  const given = String(r.format || '').trim();
  const fmt = (EBOOK_FORMATS.test(given) ? given : EBOOK_EXT.exec(safeDecode(link))?.[1] || '').toUpperCase();
  if (!fmt) return null;
  const name = `${String(r.title || 'Book').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 90)}.${fmt.toLowerCase()}`;
  return { name, format: fmt, size: r.size || 0, resolve: async () => link };
}

/** The book to open in the reader for a source result's direct EPUB link. */
export const directReaderBook = (r, file, book) => ({
  uid: `src:${hashStr(r.link)}#ebook`,
  source: 'src',
  kind: 'text',
  title: book?.title || r.title,
  author: book?.author || r.author || '',
  cover: book?.cover || '',
  ebookName: file.name,
  ebookFormat: file.format,
  ebookUrl: r.link,
  ebookFile: file,
});

/** The book to open in the reader for one ebook file of a cloud item. */
export const cloudReaderBook = (book, file) => ({
  uid: `${book.uid.replace(/#ebook$/, '')}#ebook`,
  source: book.source,
  kind: 'text',
  title: book.title,
  author: book.author,
  cover: book.cover,
  ebookName: file.name,
  ebookFile: file,
  // A plain link (Audiobookshelf): lets the book reopen from Continue after a restart.
  ...(file.url ? { ebookUrl: file.url, ebookFormat: file.format } : {}),
});

// Parsed books kept in memory: only the last two (big books hold a lot of text and images).
const docs = new Map();
function remember(uid, doc) {
  docs.delete(uid);
  docs.set(uid, doc);
  while (docs.size > 2) {
    const [old, d] = docs.entries().next().value;
    docs.delete(old);
    (d.urls || []).forEach((u) => URL.revokeObjectURL(u));
  }
  return doc;
}

// Downloaded EPUBs are kept on the phone (the app's cache storage), so reopening,
// Listen and Read aloud don't download them again and work offline.
const CACHE = 'kathava-ebooks';
const cacheKey = (uid) => `https://kathava.local/ebook/${encodeURIComponent(uid)}`;
async function cachedBytes(uid) {
  try {
    const hit = await (await caches.open(CACHE)).match(cacheKey(uid));
    return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
async function keepBytes(uid, bytes) {
  try {
    await (await caches.open(CACHE)).put(cacheKey(uid), new Response(bytes, { headers: { 'Content-Type': 'application/epub+zip' } }));
  } catch {}
}
export async function forgetEbook(uid) {
  docs.delete(uid);
  try {
    await (await caches.open(CACHE)).delete(cacheKey(uid));
  } catch {}
}

const loading = new Map(); // uid -> promise, so Read + Listen share one download

export function loadCloudEbook(book) {
  if (docs.has(book.uid)) return Promise.resolve(docs.get(book.uid));
  if (!loading.has(book.uid)) loading.set(book.uid, loadEbook(book).finally(() => loading.delete(book.uid)));
  return loading.get(book.uid);
}

async function loadEbook(book) {
  const saved = await cachedBytes(book.uid);
  if (saved) return remember(book.uid, await epubToHtml(saved));
  let file = book.ebookFile;
  // Direct links (reopened from Continue): the saved link is all we need.
  if (!file && book.ebookUrl) file = { name: book.ebookName || 'book.epub', format: book.ebookFormat || 'EPUB', resolve: async () => book.ebookUrl };
  if (!file) {
    const d = await cloudDetails({ ...book, uid: book.uid.replace(/#ebook$/, ''), kind: 'text' });
    const list = d.ebooks || [];
    file = list.find((e) => e.name === book.ebookName) || list.find((e) => e.format === 'EPUB') || list[0];
  }
  if (!file) throw new Error('This ebook is no longer in your cloud');
  if (file.format !== 'EPUB') throw new Error(`${file.format} files can't be opened in the reader — use Send to Kindle / Open in another app on the book page`);
  const bytes = await getBytes(await file.resolve());
  const doc = await epubToHtml(bytes); // throws before caching if it isn't a readable EPUB
  keepBytes(book.uid, bytes);
  return remember(book.uid, doc);
}
