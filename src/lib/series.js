// Series: which series a book belongs to (from its details or the Audible lookup),
// the whole series in reading order, and where you are in it.
import { persisted, library, progress } from './store.js';
import { metaNow } from './meta.js';
import { mainTitle, matches } from './match.js';
import { audible } from '../sources/catalogs.js';
import { downloads } from './downloads.js';
import { localCfg } from '../sources/local.js';

/** "The Stormlight Archive #2" → { name, n: 2 }. */
export function parseSeries(s) {
  const m = /^(.*?)\s*(?:#|,?\s*(?:book|vol\.?|volume)\s*)([\d.]+)\s*$/i.exec(String(s || '').trim());
  if (m && m[1].trim()) return { name: m[1].trim(), n: parseFloat(m[2]) };
  const name = String(s || '').trim();
  return name ? { name, n: null } : null;
}
export const seriesOf = (book) => parseSeries(book?.series || metaNow(book)?.series || '');

const cache = persisted('seriesCache', {}, { delay: 2000 }); // "name|author" -> { t, books }
const DAY = 864e5;
const inflight = new Map();

/** The series in reading order (cached for two weeks). */
export function seriesBooks(name, author = '') {
  const key = `${name}|${String(author).split(',')[0].trim()}`.toLowerCase();
  const hit = cache.get()[key];
  if (hit && Date.now() - hit.t < 14 * DAY) return Promise.resolve(hit.books);
  if (!inflight.has(key))
    inflight.set(
      key,
      audible
        .series(name, String(author).split(',')[0].trim())
        .then((books) => {
          const slim = books.slice(0, 40).map(({ uid, source, kind, title, author, narrator, cover, year, duration, series, seriesN, link, rating, ratings }) => ({ uid, source, kind, title, author, narrator, cover, year, duration, series, seriesN, link, rating, ratings }));
          cache.set((c) => ({ ...c, [key]: { t: Date.now(), books: slim } }));
          return slim;
        })
        .finally(() => inflight.delete(key))
    );
  return inflight.get(key);
}

/**
 * Where you are with each book of a series: 'finished' | 'reading' (with pct) | 'have'
 * (saved, on the phone or downloaded) | '' (not yet).
 */
export function statusIn(books) {
  const prog = Object.values(progress.get());
  const have = [...Object.values(library.get()), ...Object.values(downloads.get()).map((d) => d?.book), ...(localCfg.get().books || [])].filter(Boolean);
  return books.map((b) => {
    const t = mainTitle(b.title);
    const p = prog.find((x) => x?.book && matches(t, x.book.title));
    if (p?.finished) return { book: b, state: 'finished' };
    if (p) return { book: b, state: 'reading', pct: Math.round((p.percent || 0) * 100) };
    if (have.some((x) => matches(t, x.title || ''))) return { book: b, state: 'have' };
    return { book: b, state: '' };
  });
}

/** The first book of the series you haven't finished, after the last one you did. */
export function nextIn(list) {
  let lastDone = -1;
  list.forEach((x, i) => (x.state === 'finished' ? (lastDone = i) : null));
  return list.slice(lastDone + 1).find((x) => x.state !== 'finished') || null;
}
