// The book's own words for the live transcript. Speech recognition gets names and
// unusual words wrong; when the same book's ebook is on the phone (kept, in a phone
// folder, or in the audiobook's own folder), each recognised line is found in the
// ebook and its real words are shown instead — recognition only supplies the timing.
import { savedEbooks, loadCloudEbook, cloudReaderBook, directEbookFile, directReaderBook, probeEbook, isBadEbook } from './epub.js';
import { localCfg } from '../sources/local.js';
import { mainTitle, matches, words } from './match.js';
import { persisted, progress, library } from './store.js';
import { sameWork } from './works.js';
import { findOrder, autoEbook } from './findorder.js';

/** Ebooks you chose for an audiobook's transcript: audiobook uid -> ebook (book summary). */
export const ebookLinks = persisted('ebookLinks', {});
export const linkEbook = (audioUid, ebook) => ebookLinks.set((all) => ({ ...all, [audioUid]: ebook }));
import { paragraphs } from './tts.js';

const surname = (a) => String(a || '').split(',')[0].trim().split(/\s+/).pop()?.toLowerCase() || '';
const norm = (w) => w.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}']/gu, '');

/** The ebook of this audiobook, if one is on hand. */
export function ebookFor(book) {
  const links = ebookLinks.get();
  const linked = links[book.uid];
  if (linked) return linked;
  // Linked to another copy of this audiobook (the same book from another source or a
  // download): the same ebook.
  const prog = progress.get();
  const lib = library.get();
  for (const [uid, eb] of Object.entries(links)) {
    const other = prog[uid]?.book || lib[uid];
    if (eb && other && other.kind !== 'text' && sameWork(other, book)) return eb;
  }
  const own = (book.ebooks || []).find((f) => f.format === 'EPUB');
  if (own) return cloudReaderBook(book, own);
  const t = mainTitle(book.title || '');
  if (!t) return null;
  const sn = surname(book.author);
  const same = (b) => b && matches(t, `${b.title || ''} ${b.ebookName || ''}`) && (!sn || !b.author || String(b.author).toLowerCase().includes(sn));
  const list = [...Object.values(links), ...Object.values(savedEbooks.get()).map((x) => x?.book), ...(localCfg.get().books || []).filter((b) => b.kind === 'text')].filter((b) => same(b) && !isBadEbook(b));
  // EPUB first: a PDF's text is often broken up by page headers.
  return list.find((b) => (b.ebookFormat || b.format) !== 'PDF') || list[0] || null;
}

/** Load the ebook's words and an index of word triples → positions. */
export async function loadBookText(book) {
  const eb = ebookFor(book) || (autoEbook() ? await autoFindEbook(book) : null);
  if (!eb) return null;
  return textOfEbook(eb);
}

/** An ebook of yours (linked, kept, on the phone) with this title — one book of a series, say. */
export function ebookByTitle(title, author = '') {
  const t = mainTitle(title || '');
  if (!t) return null;
  const sn = surname(author);
  const same = (b) => b && matches(t, `${b.title || ''} ${b.ebookName || ''}`) && (!sn || !b.author || String(b.author).toLowerCase().includes(sn));
  const list = [...Object.values(ebookLinks.get()), ...Object.values(savedEbooks.get()).map((x) => x?.book), ...(localCfg.get().books || []).filter((b) => b.kind === 'text')].filter(same);
  return list.find((b) => (b.ebookFormat || b.format) !== 'PDF') || list[0] || null;
}

/** The words of one ebook, with the index used to find lines in it. */
export async function textOfEbook(eb) {
  const doc = await loadCloudEbook(eb);
  // Everything, title page and contents included: the narrator reads those too.
  const w = wordIndex(paragraphs(doc.html).map((p) => p.text));
  if (w.tokens.length < 50) throw new Error('No readable text in that ebook');
  return { ...w, title: eb.title };
}

/**
 * The words of a list of paragraphs, with the triple index `locate` searches, and where each
 * paragraph starts (word number) — used to find a heard line in the reader's own text too.
 */
export function wordIndex(texts) {
  const tokens = [];
  const starts = [];
  for (const t of texts) {
    starts.push(tokens.length);
    for (const w of String(t || '').split(/\s+/)) if (w) tokens.push(w);
  }
  const keys = tokens.map(norm);
  const index = new Map();
  for (let i = 0; i + 2 < keys.length; i++) {
    if (!keys[i] || !keys[i + 1] || !keys[i + 2]) continue;
    const k = `${keys[i]} ${keys[i + 1]} ${keys[i + 2]}`;
    const at = index.get(k);
    if (!at) index.set(k, [i]);
    else if (at.length < 40) at.push(i); // very common phrases tell us little
  }
  return { tokens, keys, index, starts };
}

/** Which paragraph word number `pos` is in (for `wordIndex` results). */
export function paraOf(w, pos) {
  let lo = 0;
  let hi = w.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (w.starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Where a recognised line is in the book: { from, to } word positions, or null.
 * `near`: where the previous line ended — searched first, the whole book after.
 */
export function locate(bt, text, near = null) {
  const seg = String(text || '').split(/\s+/).map(norm).filter(Boolean);
  if (seg.length < 3) return null;
  const vote = (lo, hi) => {
    const votes = new Map();
    const hits = [];
    for (let j = 0; j + 2 < seg.length; j++) {
      for (const p of bt.index.get(`${seg[j]} ${seg[j + 1]} ${seg[j + 2]}`) || []) {
        if (p < lo || p > hi) continue;
        hits.push([p, j]);
        votes.set(p - j, (votes.get(p - j) || 0) + 1);
      }
    }
    let best = null;
    let n = 0;
    for (const [off, c] of votes) if (c > n) (best = off), (n = c);
    // A phrase the book repeats matches in several places about equally: take the one that
    // carries on from the line before (just after it), not an earlier repeat.
    if (near != null && best != null) {
      const cost = (off) => (off < near - 40 ? (near - off) * 4 : Math.abs(off - near));
      for (const [off, c] of votes) if (c >= n - 1 && c >= 2 && cost(off) < cost(best)) best = off;
      n = votes.get(best);
    }
    // The line's ends, measured from the matches nearest each end (the book and the
    // recognised words rarely have the same number of words in between).
    const ok = hits.filter(([p, j]) => Math.abs(p - j - best) <= 8).sort((x, y) => x[1] - y[1]);
    const first = ok[0];
    const last = ok[ok.length - 1];
    return { best, n, from: first ? first[0] - first[1] : best, to: last ? last[0] + seg.length - last[1] : best + seg.length };
  };
  let r = near != null ? vote(near - 400, near + 4000) : { n: 0 };
  let wide = false;
  if (r.n < 2) (r = vote(0, Infinity)), (wide = true);
  // Need a few matching triples, else it's a guess. A jump far from where the last line was
  // needs more: two common phrases anywhere in the book (a self-help book repeats its key
  // phrases all through) used to send the text to the wrong page.
  const need = !wide ? 2 : near != null ? Math.min(5, Math.max(3, Math.ceil((seg.length - 2) * 0.4))) : Math.min(3, seg.length - 2);
  if (r.n < need || r.best == null) return null;
  const from = Math.max(0, r.from);
  return { from, to: Math.max(from + 1, Math.min(bt.tokens.length, r.to)) };
}

/**
 * This book's ebook in your source results: direct EPUB links first (then PDF),
 * as [{ r, file, book }] ready to download and keep.
 */
export async function findEbookInSources(book, query = '') {
  const { searchSources } = await import('../sources/sourceaddons.js');
  query = query.trim();
  // Your own words ("harry potter chamber of secrets"): every one of them in the result.
  const t = query || mainTitle(book.title || '');
  const sn = surname(book.author);
  const found = [];
  const take = (name, results) => {
    for (const r of results || []) {
      // A direct link from an ebook source with no file type given (Ink & Echo does that):
      // a candidate too — it's checked when picked.
      const unknown = !(r.magnet || r.hash) && r.contentType === 'ebook' && /^https?:/i.test(r.link || '') && !directEbookFile(r);
      const file = unknown ? { name: String(r.title || 'Book').slice(0, 90), format: '?', size: r.size || 0, resolve: async () => r.link } : !(r.magnet || r.hash) && directEbookFile(r);
      if (!file || (file.format !== 'EPUB' && file.format !== 'PDF' && file.format !== '?')) continue;
      if (t && !matches(t, `${r.title || ''} ${file.name}`)) continue;
      // A short title ("Civilization") is part of many other books' names: the author too.
      if (!query && sn && words(t).length < 3 && !words(`${r.title || ''} ${r.author || ''} ${file.name}`).includes(sn)) continue;
      if (found.some((x) => x.r.link === r.link)) continue;
      found.push({ r, file, source: name, book: directReaderBook(r, file, book) });
    }
  };
  // Two searches, like the main search box: the clean title (no "Unabridged" etc.) with
  // the author, and the plain words "title surname" — between them far more ebook links.
  await Promise.all(
    query
      ? [searchSources({ title: '', author: '', query }, take), searchSources({ title: query, author: '', query: '' }, take)]
      : [searchSources({ title: t, author: book.author || '', query: '' }, take), searchSources({ title: '', author: '', query: `${t} ${sn}`.trim() }, take)]
  );
  const rank = { EPUB: 0, PDF: 1, '?': 2 };
  return found.sort((a, b) => rank[a.file.format] - rank[b.file.format]);
}

/** A found ebook ready to open: one of unknown type is fetched and checked first (EPUB / PDF only). */
export async function readyHit(hit, book) {
  if (hit.file.format !== '?') return hit.book;
  const f = await probeEbook(hit.r);
  if (!f || (f.format !== 'EPUB' && f.format !== 'PDF')) throw new Error(f ? `That one is a ${f.format} file — the transcript needs an EPUB or PDF` : "That file isn't an ebook the app can read");
  return directReaderBook(hit.r, f, book);
}

/** Ebooks already on the phone (saved, phone folders, added files): this book's first. */
export function ebooksOnHand(book, query = '', { all: everything = false } = {}) {
  const t = query.trim() || mainTitle(book.title || '');
  const seen = new Set();
  const all = [...Object.values(savedEbooks.get()).map((x) => x?.book), ...(localCfg.get().books || []).filter((b) => b.kind === 'text')].filter(
    (b) => b && !seen.has(b.uid) && seen.add(b.uid)
  );
  const hit = (b) => (t && matches(t, `${b.title || ''} ${b.ebookName || ''}`) ? 0 : 1);
  // Only this book's (or your words'): every ebook on the phone only when you ask for it.
  if (everything) return all.sort((a, b) => hit(a) - hit(b));
  return all.filter((b) => !hit(b));
}

/** Download a found ebook, keep it on the phone and use it for this audiobook's transcript. */
export async function keepFoundEbook(audioUid, hit, book = null) {
  const eb = await readyHit(hit, book || hit.book);
  await loadCloudEbook(eb);
  linkEbook(audioUid, eb);
}

// ---- Finding the ebook by itself -------------------------------------------------
// When an audiobook plays, its ebook is looked for in the order set in Settings (phone,
// sources, TorBox / Real-Debrid, Audiobookshelf by default), kept on the phone and
// attached to the transcript. Only what's ready: nothing new is added to a debrid service.
const tried = persisted('ebookTried', {}); // audiobook uid -> when nothing was found (looked again after a day)
// Sources added or changed: books that found nothing are looked at again.
import('./store.js').then(({ addons }) => addons.subscribe(() => tried.set({})));
const finding = new Map();

/** Find, keep and attach this audiobook's ebook; resolves the ebook (book summary) or null. */
export function autoFindEbook(book) {
  if (!book?.uid || book.source === 'pod' || book.kind === 'text') return Promise.resolve(null);
  const have = ebookFor(book);
  if (have) return Promise.resolve(have);
  if (Date.now() - (tried.get()[book.uid] || 0) < 86400e3) return Promise.resolve(null);
  if (!finding.has(book.uid))
    finding.set(
      book.uid,
      lookEverywhere(book)
        .then((eb) => {
          if (eb) linkEbook(book.uid, eb);
          else tried.set((all) => ({ ...Object.fromEntries(Object.entries(all).slice(-200)), [book.uid]: Date.now() }));
          return eb;
        })
        .catch(() => null)
        .finally(() => finding.delete(book.uid))
    );
  return finding.get(book.uid);
}

async function lookEverywhere(book) {
  const t = mainTitle(book.title || '');
  if (!t) return null;
  const sn = surname(book.author);
  const same = (b) => b && matches(t, `${b.title || ''} ${b.rawName || ''} ${b.ebookName || ''}`) && (!sn || !b.author || String(b.author).toLowerCase().includes(sn));
  const { getDetails, findOwned } = await import('../sources/index.js');
  let owned = null;
  const mine = async () => (owned ||= await findOwned({ title: book.title, author: book.author || '' }).catch(() => ({ server: [], cloud: [] })));
  // An EPUB (else a PDF) in a book of yours: kept on the phone for next time.
  const fromCopy = async (b) => {
    const d = await getDetails(b).catch(() => null);
    const files = d?.ebooks || [];
    const file = files.find((f) => f.format === 'EPUB') || files.find((f) => f.format === 'PDF');
    if (!file) return null;
    const rb = cloudReaderBook(d, file);
    await loadCloudEbook(rb);
    return rb;
  };
  for (const place of findOrder('ebook')) {
    try {
      if (place === 'local') {
        const eb = ebookFor(book);
        if (eb) return eb;
      } else if (place === 'sources') {
        // The first that really is an EPUB / PDF (files of unknown type are checked, a few at most).
        let tries = 0;
        for (const hit of await findEbookInSources(book)) {
          if (hit.file.format === '?' && ++tries > 3) break;
          try {
            const eb = await readyHit(hit, book);
            await loadCloudEbook(eb);
            return eb;
          } catch {}
        }
      } else if (place === 'debrid' || place === 'abs') {
        const o = await mine();
        for (const b of (place === 'abs' ? o.server : o.cloud).filter(same)) {
          const eb = await fromCopy(b);
          if (eb) return eb;
        }
      }
    } catch {}
  }
  return null;
}
