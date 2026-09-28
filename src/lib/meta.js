// Metadata lookups for items that arrive without covers or proper titles —
// debrid files, addon results, Goodreads imports. Providers are tried in the
// order configured in Settings until one returns a confident match:
//   Audible catalog → Apple Books → Google Books → Open Library
// Results (including misses) are cached on the device.
import { useEffect, useState } from 'preact/hooks';
import { getJson, qs } from './http.js';
import { persisted, settings } from './store.js';
import { words } from './match.js';
import { stripHtml } from './format.js';
import { audibleRating } from '../sources/catalogs.js';

export const PROVIDERS = {
  audible: { name: 'Audible', blurb: 'Audiobook covers, narrators, series & runtime' },
  apple: { name: 'iTunes Store / Apple Books', blurb: 'Audiobook covers & descriptions' },
  google: { name: 'Google Books', blurb: 'Covers & descriptions for most books' },
  openlibrary: { name: 'Open Library', blurb: 'Open catalogue, good for older titles' },
};

const cache = persisted('metaCache', {});
const MISS_TTL = 3 * 24 * 3600e3;

/** Turn a release name into a search string: drop brackets, formats, uploader noise. */
export function queryFor(book) {
  const raw = book.rawName || [book.title, book.author].filter(Boolean).join(' ');
  return String(raw)
    .replace(/\.(m4b|mp3|m4a|flac|zip|rar|epub|pdf)$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/[\[({][^\])}]*[\])}]/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\b(unabridged|abridged|audiobook|audio ?book|english|retail|\d{2,3} ?kbps|vbr|cbr|mp3|m4b|aac|flac|read by|narrated by|\d{3,4}p|web|dl)\b/gi, ' ')
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
  return (settings.get().metaOrder || Object.keys(PROVIDERS)).filter((k) => lookups[k] && st[k] !== false);
}

// Small queue so a page of 30 covers doesn't fire 120 requests at once.
let active = 0;
const queue = [];
const pending = new Map();
function schedule(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}
function pump() {
  while (active < 3 && queue.length) {
    const { fn, resolve, reject } = queue.shift();
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
    cache.set((c) => ({ ...c, [key]: { t: Date.now(), v: merged } }));
    return merged;
  }).finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

// Sources whose items benefit from lookups.
const ENRICH = new Set(['tb', 'rd', 'addon', 'gr']);
export const wantsMeta = (book) => !!book && ENRICH.has(book.source) && (!book.cover || book.source === 'tb' || book.source === 'rd');

/** Hook: enriched fields for cards (cover / tidy title / author). */
export function useMeta(book) {
  const [meta, setMeta] = useState(() => (wantsMeta(book) ? cache.get()[keyFor(queryFor(book))]?.v || null : null));
  useEffect(() => {
    if (!wantsMeta(book)) return setMeta(null);
    let alive = true;
    lookup(book).then((m) => alive && setMeta(m));
    return () => (alive = false);
  }, [book?.uid]);
  return meta;
}

export function clearMetaCache() {
  cache.set({});
}
