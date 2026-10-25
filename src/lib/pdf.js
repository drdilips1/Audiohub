// PDFs in the reader. Loaded only when a PDF is opened (pdf.js is big), so the rest
// of the app stays as fast as before.
//  - pdfToDoc: the PDF's text as reflowed paragraphs, in the reader's { html, headings }
//    shape — so themes, font size, read aloud and Ask AI work like an EPUB.
//  - renderPage: one original page as an image, for the Pages view (layout, pictures,
//    scanned books).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { speakable } from './tts.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/** Open a PDF (bytes are copied: pdf.js takes over the buffer it is given). */
export const openPdf = (bytes) => pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;

/** One page's text as paragraphs: lines grouped by position, split on larger gaps. */
async function pageParagraphs(page) {
  const { items } = await page.getTextContent();
  const lines = [];
  for (const it of items) {
    if (!('str' in it)) continue;
    const y = it.transform[5];
    const size = Math.hypot(it.transform[2], it.transform[3]) || 10;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) < size * 0.5) {
      last.text += (last.text && it.str && !/\s$/.test(last.text) && !/^\s/.test(it.str) && it.str.length > 1 ? ' ' : '') + it.str;
      last.size = Math.max(last.size, size);
    } else if (it.str.trim() || it.hasEOL) lines.push({ y, size, text: it.str });
  }
  // The page's usual line spacing: a clearly bigger gap starts a new paragraph.
  const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).filter((g) => g > 0).sort((a, b) => a - b);
  const usual = gaps.length ? gaps[gaps.length >> 1] : 0;
  const paras = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const text = l.text.replace(/\s+/g, ' ').trim();
    if (!text) {
      cur = null;
      continue;
    }
    const prev = lines[i - 1];
    const gap = prev ? prev.y - l.y : 0;
    const big = l.size > 14 && text.length < 90; // larger type: a heading
    if (!cur || big || cur.big || gap > Math.max(l.size * 1.3, usual * 1.4) || gap < 0) {
      cur = { text, big };
      paras.push(cur);
    } else if (/-$/.test(cur.text) && /^[a-z]/.test(text)) cur.text = cur.text.slice(0, -1) + text; // hyphenated line end
    else cur.text += ' ' + text;
  }
  // Running heads and page numbers: short bits at the very top or bottom.
  return paras.filter((p, i) => !((i === 0 || i === paras.length - 1) && (/^\d{1,4}$/.test(p.text) || (p.text.length < 4 && !p.big))));
}

/**
 * The whole PDF as reader text. Works page by page with pauses, so a long book
 * never freezes the app. `scanned` is true when there is (almost) no text.
 */
export async function pdfToDoc(bytes, onProgress) {
  const pdf = await openPdf(bytes);
  // The PDF's own contents (bookmarks), by page.
  const marks = new Map();
  try {
    const outline = (await pdf.getOutline()) || [];
    const walk = async (list, level) => {
      for (const o of list) {
        try {
          const dest = typeof o.dest === 'string' ? await pdf.getDestination(o.dest) : o.dest;
          if (dest?.[0]) {
            const n = (await pdf.getPageIndex(dest[0])) + 1;
            if (!marks.has(n)) marks.set(n, []);
            marks.get(n).push({ title: o.title, level });
          }
        } catch {}
        if (o.items?.length && level < 3) await walk(o.items, level + 1);
      }
    };
    await walk(outline, 1);
  } catch {}

  const html = [];
  const headings = [];
  const paras = [];
  let chars = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    html.push(`<hr class="pdf-page" data-page="${n}">`);
    for (const m of marks.get(n) || []) {
      const id = `pdf-h${headings.length}`;
      headings.push({ id, text: m.title, level: Math.min(m.level, 3) });
      html.push(`<h${m.level + 1} id="${id}">${esc(m.title)}</h${m.level + 1}>`);
      paras.push({ heading: true, text: speakable(m.title), skip: false });
    }
    const page = await pdf.getPage(n);
    for (const p of await pageParagraphs(page)) {
      chars += p.text.length;
      // Without a PDF contents list, large type becomes the chapter list.
      if (p.big && !marks.size) {
        const id = `pdf-h${headings.length}`;
        headings.push({ id, text: p.text, level: 2 });
        html.push(`<h3 id="${id}">${esc(p.text)}</h3>`);
      } else html.push(p.big ? `<h4>${esc(p.text)}</h4>` : `<p>${esc(p.text)}</p>`);
      paras.push({ heading: p.big, text: speakable(p.text), skip: false });
    }
    page.cleanup();
    onProgress?.(n, pdf.numPages);
    if (n % 5 === 0) await nextFrame();
  }
  const info = await pdf.getMetadata().catch(() => null);
  const pages = pdf.numPages;
  await pdf.destroy();
  return {
    html: html.join('\n'),
    headings,
    paras,
    title: info?.info?.Title || '',
    author: info?.info?.Author || '',
    urls: [],
    pdf: { pages, scanned: chars < pages * 40 },
  };
}

/** Draw one page into a canvas, `width` CSS pixels wide (sharp on high-density screens). */
export async function renderPage(pdf, n, canvas, width) {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const vp = page.getViewport({ scale: (width / base.width) * dpr });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = width + 'px';
  canvas.style.height = Math.floor(vp.height / dpr) + 'px';
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  page.cleanup();
}

/** Page sizes (width / height) without drawing, so the Pages view can lay out every page. */
export async function pageRatios(pdf) {
  const out = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const vp = (await pdf.getPage(n)).getViewport({ scale: 1 });
    out.push(vp.width / vp.height);
    if (n % 20 === 0) await nextFrame();
  }
  return out;
}
