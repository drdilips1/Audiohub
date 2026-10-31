// Metadata lookups for items that arrive without covers or proper titles —
// debrid files, addon results, Goodreads imports. Providers are tried in the
// order configured in Settings until one returns a confident match:
//   Audible catalog → Apple Books → Google Books → Open Library
// Results (including misses) are cached on the device.
import { useEffect, useState } from 'preact/hooks';
import { getJson, qs } from './http.js';
import { persisted, settings } from './store.js';
import { words, mainTitle } from './match.js';
import { stripHtml } from './format.js';
import { audibleRating, audible as audibleCat, googleBooks } from '../sources/catalogs.js';

export const PROVIDERS = {
  audible: { name: 'Audible', blurb: 'Audiobook covers, narrators, series & runtime' },
  apple: { name: 'iTunes Store / Apple Books', blurb: 'Audiobook covers & descriptions' },
  google: { name: 'Google Books', blurb: 'Covers & descriptions for most books' },
  openlibrary: { name: 'Open Library', blurb: 'Open catalogue, good for older titles' },
  applebooks: { name: 'Apple Books (ebooks)', blurb: 'Print-edition covers for books with no audiobook' },
  goodreads: { name: 'Goodreads covers', blurb: 'The cover Goodreads shows, for almost any book' },
};

const cache = persisted('metaCache', {}, { delay: 3000 });
// Details you picked yourself ("Find cover & details" on a book page): uid -> meta.
export const metaFixes = persisted('metaFixes', {});
export const fixFor = (uid) => (uid && metaFixes.get()[uid]) || null;
export function setFix(uid, meta) {
  metaFixes.set((all) => {
    const next = { ...all };
    if (meta) next[uid] = { ...meta, fixed: true };
    else delete next[uid];
    return next;
  });
}
const MISS_TTL = 3 * 24 * 3600e3;

/** Turn a release name into a search string: drop brackets, formats, uploader noise. */
export function queryFor(book) {
  const raw = book.rawName || [book.title, book.author].filter(Boolean).join(' ');
  return String(raw)
    .replace(/\.(m4b|mp3|m4a|flac|zip|rar|epub|pdf)$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/[\[({][^\])}]*[\])}]/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\b(a novel|a memoir|unabridged|abridged|audiobook|audio ?book|english|retail|\d{2,3} ?kbps|vbr|cbr|mp3|m4b|aac|flac|read by|narrated by|\d{3,4}p|web|dl)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const keyFor = (q) => words(q).join(' ');

// A hit is trusted when most of its title words appear in what we searched for.
function plausible(query, title) {
  const q = new Set(words(query));
  const t = words(String(title).replace(/[:(].*$/, ''));
  if (!t.length) return false;
  return t.filter((w) => q.has(w)).length / t.length >= 0.6;
}

const hiRes = (u) => (u ? u.replace(/^http:/, 'https:') : '');

const lookups = {
  async audible(q) {
    const d = await getJson(
      'https://api.audible.com/1.0/catalog/products?' +
        qs({
          keywords: q,
          num_results: 5,
          products_sort_by: 'Relevance',
          response_groups: 'contributors,product_desc,product_attrs,media,series,category_ladders,rating',
          image_sizes: '500,1024',
        }),
      { timeout: 12000 }
    );
    const p = (d.products || []).find((x) => plausible(q, x.title));
    if (!p) return null;
    const img = p.product_images || {};
    return {
      title: p.title,
      subtitle: p.subtitle || '',
      author: (p.authors || []).map((a) => a.name).slice(0, 2).join(', '),
      narrator: (p.narrators || []).map((a) => a.name).slice(0, 2).join(', '),
      cover: img['1024'] || img['500'] || '',
      description: stripHtml(p.publisher_summary || p.merchandising_summary || ''),
      series: p.series?.[0] ? `${p.series[0].title}${p.series[0].sequence ? ` #${p.series[0].sequence}` : ''}` : '',
      runtime: p.runtime_length_min ? p.runtime_length_min * 60 : 0,
      year: (p.release_date || '').slice(0, 4),
      genres: [...new Set((p.category_ladders || []).flatMap((l) => (l.ladder || []).map((x) => x.name)).filter(Boolean))],
      asin: p.asin,
      ...audibleRating(p),
      source: 'Audible',
    };
  },
  async apple(q) {
    const d = await getJson('https://itunes.apple.com/search?' + qs({ term: q, media: 'audiobook', limit: 5 }), { timeout: 12000 });
    const r = (d.results || []).find((x) => plausible(q, x.collectionName || x.trackName));
    if (!r) return null;
    return {
      title: (r.collectionName || r.trackName || '').replace(/\s*\((unabridged|abridged)\)\s*$/i, ''),
      author: r.artistName || '',
      cover: hiRes((r.artworkUrl100 || r.artworkUrl60 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.')),
      description: stripHtml(r.description || ''),
      year: (r.releaseDate || '').slice(0, 4),
      source: 'Apple Books',
    };
  },
  async google(q) {
    const d = await getJson('https://www.googleapis.com/books/v1/volumes?' + qs({ q, maxResults: 5, printType: 'books' }), { timeout: 12000 });
    const v = (d.items || []).map((i) => i.volumeInfo || {}).find((x) => plausible(q, x.title));
    if (!v) return null;
    const links = v.imageLinks || {};
    return {
      title: v.title,
      subtitle: v.subtitle || '',
      author: (v.authors || []).slice(0, 2).join(', '),
      cover: hiRes((links.extraLarge || links.large || links.medium || links.thumbnail || '').replace(/&edge=curl/, '').replace(/zoom=1/, 'zoom=2')),
      description: stripHtml(v.description || ''),
      year: (v.publishedDate || '').slice(0, 4),
      genres: v.categories || [],
      source: 'Google Books',
    };
  },
  async applebooks(q) {
    const d = await getJson('https://itunes.apple.com/search?' + qs({ term: q, media: 'ebook', limit: 5 }), { timeout: 12000 });
    const r = (d.results || []).find((x) => plausible(q, x.trackName));
    if (!r) return null;
    return {
      title: r.trackName || '',
      author: r.artistName || '',
      cover: hiRes((r.artworkUrl100 || r.artworkUrl60 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.')),
      description: stripHtml(r.description || ''),
      year: (r.releaseDate || '').slice(0, 4),
      genres: r.genres || [],
      source: 'Apple Books',
    };
  },
  // Goodreads' cover for a title (through bookcover.longitood.com, a small open service).
  async goodreads(q) {
    const t = mainTitle(q.replace(/\s+by\s+.*$/i, ''));
    const d = await getJson('https://bookcover.longitood.com/bookcover?' + qs({ book_title: t }), { timeout: 12000 });
    if (!d?.url) return null;
    return { title: t, author: '', cover: hiRes(d.url), source: 'Goodreads' };
  },
  async openlibrary(q) {
    const d = await getJson('https://openlibrary.org/search.json?' + qs({ q, limit: 5, fields: 'key,title,author_name,cover_i,first_publish_year,subject' }), { timeout: 12000 });
    const w = (d.docs || []).find((x) => plausible(q, x.title));
    if (!w) return null;
    return {
      title: w.title,
      author: (w.author_name || []).slice(0, 2).join(', '),
      cover: w.cover_i ? `https://covers.openlibrary.org/b/id/${w.cover_i}-L.jpg` : '',
      year: w.first_publish_year || '',
      genres: (w.subject || []).slice(0, 15),
      source: 'Open Library',
    };
  },
};

export function enabledProviders() {
  const st = settings.get().metaProviders || {};
  // Providers added since the order was saved come at the end.
  const saved = settings.get().metaOrder || [];
  const order = [...saved, ...Object.keys(PROVIDERS).filter((k) => !saved.includes(k))];
  return order.filter((k) => lookups[k] && st[k] !== false);
}

// Small queue so a page of 30 covers doesn't fire 120 requests at once.
// Covers come first; extra details for books that already have a cover (e.g. the author
// of a phone book) wait until no cover is waiting, one at a time.
let active = 0;
const queue = [];
const later = [];
const pending = new Map();
function schedule(fn, low = false) {
  return new Promise((resolve, reject) => {
    (low ? later : queue).push({ fn, resolve, reject });
    pump();
  });
}
function pump() {
  while ((active < 3 && queue.length) || (active === 0 && later.length)) {
    const { fn, resolve, reject } = queue.length ? queue.shift() : later.shift();
    active++;
    fn()
      .then(resolve, reject)
      .finally(() => {
        active--;
        pump();
      });
  }
}

/** Best metadata for a book (merged across providers); null when nothing matched. */
export function lookup(book, { fresh = false } = {}) {
  const q = queryFor(book);
  const key = keyFor(q);
  if (!key) return Promise.resolve(null);
  const hit = cache.get()[key];
  // Entries saved before genres were collected are refreshed once.
  const stale = hit?.v && (!Array.isArray(hit.v.genres) || (hit.v.source === 'Audible' && !hit.v.asin));
  if (!fresh && !stale && hit && (hit.v || Date.now() - hit.t < MISS_TTL)) return Promise.resolve(hit.v);
  if (pending.has(key)) return pending.get(key);
  const p = schedule(async () => {
    let merged = null;
    for (const name of enabledProviders()) {
      let r = null;
      try {
        r = await lookups[name](q);
      } catch {}
      if (!r) continue;
      const genres = [...new Set([...(merged?.genres || []), ...(r.genres || [])])];
      merged = merged ? { ...r, ...Object.fromEntries(Object.entries(merged).filter(([, v]) => v)) } : r;
      merged.genres = genres;
      if (merged.cover && merged.description) break;
    }
    // Saved copy: description shortened (the book page loads the full one from its source).
    const saved = merged?.description?.length > 900 ? { ...merged, description: merged.description.slice(0, 900) + '…' } : merged;
    cache.set((c) => ({ ...c, [key]: { t: Date.now(), v: saved } }));
    return merged;
  }, !!book.cover).finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

// Sources whose items benefit from lookups.
const ENRICH = new Set(['loc', 'tb', 'rd', 'addon', 'gr']);
// Any book of yours without a cover gets one looked up too (not podcasts).
export const wantsMeta = (book) => !!book && ((ENRICH.has(book.source) && (!book.cover || book.source === 'tb' || book.source === 'rd')) || (!book.cover && book.source !== 'pod' && !!book.title));
/** Metadata already found for a book (no lookup), e.g. to sort phone books by author. */
export const metaNow = (book) => fixFor(book?.uid) || (wantsMeta(book) ? cache.get()[keyFor(queryFor(book))]?.v || null : null);

/** Hook: enriched fields for cards (cover / tidy title / author). */
export function useMeta(book) {
  const [meta, setMeta] = useState(() => fixFor(book?.uid) || (wantsMeta(book) ? cache.get()[keyFor(queryFor(book))]?.v || null : null));
  useEffect(() => {
    const fix = fixFor(book?.uid);
    if (fix) return setMeta(fix);
    if (!wantsMeta(book)) return setMeta(null);
    let alive = true;
    lookup(book).then((m) => alive && setMeta(m));
    return () => (alive = false);
  }, [book?.uid]);
  // A cover picked with "Find cover & details" (book page or press-and-hold) shows at once.
  useEffect(() => metaFixes.subscribe(() => fixFor(book?.uid) && setMeta(fixFor(book?.uid))), [book?.uid]);
  return meta;
}

export function clearMetaCache() {
  cache.set({});
}

// ---- Finding missing covers for a whole list at once (Library) -------------------
const bare = (t) => String(t || '').replace(/^[\s\-–—_.,:;]+/, '').replace(/\.(epub|pdf|m4b|mp3|mobi|azw3?)$/i, '');
/** The cover a book shows now (its own, one found for it, or one you picked), or ''. */
export const coverNow = (book) => (book && (fixFor(book.uid)?.cover || book.cover || (wantsMeta(book) ? cache.get()[keyFor(queryFor(book))]?.v?.cover : ''))) || '';

/** Does a search result look like this book? Most of the title's words, and the author's surname when both are known. */
function sameBook(want, hit) {
  const t = new Set(words(mainTitle(bare(want.title))));
  const h = words(String(hit.title || '').replace(/[:(].*$/, ''));
  if (!t.size || !h.length) return false;
  const shared = h.filter((w) => t.has(w)).length;
  if (shared / Math.max(t.size, h.length) < 0.6) return false;
  const sn = words(String(want.author || '').split(',')[0]).pop();
  return !sn || !hit.author || words(hit.author).includes(sn);
}

/**
 * Look up covers for every book here that has none — the same search as "Find cover & details"
 * on a book page (Audible, then Google Books, with the book's clean title and author), taking
 * the first result that is the same book. Two at a time with a short pause, so the services
 * don't turn requests away; nothing is remembered as "not found", so trying again really tries
 * again. Found covers are kept for good (like picking one by hand).
 * onProgress(done, total, found); onFound(book, cover). Resolves { found, total }.
 */
export async function findMissingCovers(books, onProgress = () => {}, onFound = () => {}) {
  const todo = books.filter((b) => b && b.source !== 'pod' && !coverNow(b));
  let done = 0;
  let found = 0;
  const one = async (b) => {
    const title = mainTitle(bare(b.title));
    const author = String(b.author || '').split(',')[0].trim();
    for (const term of [`${title} ${author}`.trim(), title]) {
      if (!title) break;
      const [a, g] = await Promise.all([audibleCat.search(term).catch(() => []), googleBooks.search(term).catch(() => [])]);
      const hit = [...a, ...g].find((m) => m?.cover && sameBook({ title, author }, m));
      if (hit) {
        setFix(b.uid, { ...(fixFor(b.uid) || {}), cover: hiRes(hit.cover) });
        onFound(b, hiRes(hit.cover));
        found++;
        break;
      }
      if (!author) break; // the title alone was already tried
    }
    onProgress(++done, todo.length, found);
    await new Promise((r) => setTimeout(r, 400));
  };
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (queue.length) await one(queue.shift());
    })
  );
  return { found, total: todo.length };
}

// ---- Square audiobook covers ---------------------------------------------------
// A book whose cover is a tall (print) cover gets the square audiobook cover from Apple
// Books (then Audible) when one exists: it fills a square tile without being cut.
const squares = persisted('squareCovers', {}, { delay: 3000 }); // key -> { t, u }
const squarePending = new Map();
const SQUARE_MISS = 7 * 24 * 3600e3;
const squareKey = (book) => keyFor(`${mainTitle(book?.title || '')} ${String(book?.author || '').split(',')[0]}`);
/** The square audiobook cover already found for this book ('' none / not looked up). */
export const squareNow = (book) => squares.get()[squareKey(book)]?.u || '';
export function squareCover(book) {
  const key = squareKey(book);
  if (!key || !book?.title) return Promise.resolve('');
  const hit = squares.get()[key];
  if (hit && (hit.u || Date.now() - hit.t < SQUARE_MISS)) return Promise.resolve(hit.u || '');
  if (squarePending.has(key)) return squarePending.get(key);
  const title = mainTitle(book.title);
  const q = [title, String(book.author || '').split(',')[0]].filter(Boolean).join(' ');
  const p = schedule(async () => {
    let u = '';
    try {
      const d = await getJson('https://itunes.apple.com/search?' + qs({ term: q, media: 'audiobook', limit: 8 }), { timeout: 12000 });
      const r = (d.results || []).find((x) => plausible(title, x.collectionName || x.trackName) && plausible(x.collectionName || x.trackName, title));
      if (r?.artworkUrl100) u = r.artworkUrl100.replace(/^http:/, 'https:').replace(/\/\d+x\d+bb\./, '/600x600bb.');
    } catch {}
    if (!u) {
      try {
        const d = await getJson('https://api.audible.com/1.0/catalog/products?' + qs({ keywords: q, num_results: 5, products_sort_by: 'Relevance', response_groups: 'media', image_sizes: '500' }), { timeout: 12000 });
        const r = (d.products || []).find((x) => plausible(title, x.title) && plausible(x.title, title));
        u = r?.product_images?.['500'] || '';
      } catch {}
    }
    squares.set((c) => {
      const next = { ...c, [key]: { t: Date.now(), u } };
      const keys = Object.keys(next);
      if (keys.length > 600) keys.slice(0, keys.length - 500).forEach((k) => delete next[k]);
      return next;
    });
    return u;
  }, true).finally(() => squarePending.delete(key));
  squarePending.set(key, p);
  return p;
}
/** Hook: the square audiobook cover for a book with a tall cover (when `want`), else ''. */
export function useSquareCover(book, want) {
  const [u, setU] = useState(() => (book ? squareNow(book) : ''));
  useEffect(() => {
    if (!book || !want || settings.get().squareCovers === false) return;
    let alive = true;
    squareCover(book).then((x) => alive && x && setU(x));
    return () => (alive = false);
  }, [book?.title, want]);
  return settings.get().squareCovers === false ? '' : u;
}

// ---- "Find cover & details": many places at once -------------------------------
/** Candidates for a book's cover & details from every source: [{ title, author, cover, … from }]. */
export async function searchCovers(term) {
  const t = String(term || '').trim();
  if (!t) return [];
  const safe = (p) => p.catch(() => []);
  const apple = (media, from) =>
    safe(
      getJson('https://itunes.apple.com/search?' + qs({ term: t, media, limit: 6 }), { timeout: 12000 }).then((d) =>
        (d.results || []).map((r) => ({
          title: String(r.collectionName || r.trackName || '').replace(/\s*\((unabridged|abridged)\)\s*$/i, ''),
          author: r.artistName || '',
          cover: hiRes((r.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.')),
          description: stripHtml(r.description || ''),
          year: (r.releaseDate || '').slice(0, 4),
          from,
        }))
      )
    );
  const [au, ap, ab, gb, ol, gr] = await Promise.all([
    safe(audibleCat.search(t)).then((l) => l.slice(0, 6).map((b) => ({ ...b, from: 'Audible' }))),
    apple('audiobook', 'Apple audiobook'),
    apple('ebook', 'Apple Books'),
    safe(googleBooks.search(t)).then((l) => l.slice(0, 5).map((b) => ({ ...b, from: 'Google Books' }))),
    safe(
      getJson('https://openlibrary.org/search.json?' + qs({ q: t, limit: 5, fields: 'title,author_name,cover_i,first_publish_year' }), { timeout: 12000 }).then((d) =>
        (d.docs || []).filter((w) => w.cover_i).map((w) => ({ title: w.title, author: (w.author_name || []).slice(0, 2).join(', '), cover: `https://covers.openlibrary.org/b/id/${w.cover_i}-L.jpg`, year: w.first_publish_year || '', from: 'Open Library' }))
      )
    ),
    lookups.goodreads(t).then((r) => (r ? [{ ...r, from: 'Goodreads' }] : []), () => []),
  ]);
  // Interleaved, so the first screen shows a few from each place.
  const lists = [au, ap, gr, ab, gb, ol];
  const out = [];
  for (let i = 0; i < 8; i++) for (const l of lists) if (l[i]?.cover && l[i]?.title) out.push(l[i]);
  return out.slice(0, 30);
}
