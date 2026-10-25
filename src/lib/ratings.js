// Ratings and awards for a book page: Audible (stars and count), Goodreads (average
// rating), and awards named in the description (Audie Awards, AudioFile Earphones).
import { useEffect, useState } from 'preact/hooks';
import { getJson, getText, qs } from './http.js';
import { stripHtml } from './format.js';
import { persisted } from './store.js';
import { words, mainTitle } from './match.js';
import * as hcSrc from '../sources/hardcover.js';

const cache = persisted('ratingsCache', {}, { delay: 2000 }); // key -> { t, v }

// Server and torrent names carry extras: "Kelly Rimmer - The Things We Cannot Say",
// authors as "Rolf Dobelli/Eric Conger/…" (author/narrator). Look ratings up by the plain
// title and the first author.
const AUTHOR_SPLIT = /\s*(?:,|&|;|\/|\||\band\b)\s*/;
const firstAuthor = (a) => String(a || '').split(AUTHOR_SPLIT).map((x) => x.trim()).filter(Boolean)[0] || '';
function plainTitle(b) {
  let t = mainTitle(b?.title).replace(/\b(unabridged|abridged|audiobook|audio ?book)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const au = new Set(words(firstAuthor(b?.author)));
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(t);
  if (m && au.size) {
    if (words(m[1]).length && words(m[1]).every((w) => au.has(w))) t = m[2]; // "Author - Title"
    else if (words(m[2]).length && words(m[2]).every((w) => au.has(w))) t = m[1]; // "Title - Author"
  }
  return t || String(b?.title || '');
}
const norm = (b) => ({ ...b, title: plainTitle(b), author: String(b?.author || '').split(AUTHOR_SPLIT).filter(Boolean).join(', ') });
const HIT_TTL = 30 * 864e5;
const MISS_TTL = 6 * 3600e3;
const keyFor = (b) => `${words(plainTitle(b)).join(' ')}|${words(firstAuthor(b.author)).slice(-1)[0] || ''}`;

// Why a lookup came back empty (shown on the book page when there's no rating at all).
const why = new Map(); // `${kind}:${key}` -> text
export const whyNoRating = (kind, book) => why.get(`${kind}:${keyFor(book)}`) || '';

async function cached(kind, book, fn) {
  const key = `${kind}:${keyFor(book)}`;
  const hit = cache.get()[key];
  if (hit && Date.now() - hit.t < (hit.v ? HIT_TTL : MISS_TTL)) {
    if (!hit.v) why.set(key, 'not found');
    return hit.v;
  }
  const v = await fn().catch((e) => {
    why.set(key, e?.status ? `HTTP ${e.status}` : /timed out/i.test(e?.message || '') ? 'timed out' : e?.message || 'failed');
    return undefined;
  });
  if (v === null) why.set(key, 'not found');
  if (v === undefined) return undefined; // network trouble: not remembered, tried again next time
  cache.set((c) => {
    const next = { ...c, [key]: { t: Date.now(), v } };
    const keys = Object.keys(next);
    if (keys.length > 800) keys.sort((a, b) => next[a].t - next[b].t).slice(0, keys.length - 800).forEach((k) => delete next[k]);
    return next;
  });
  return v;
}

// Every word of the book's main title in the candidate's title, and an author name in common.
const sameBook = (book, title, author) => {
  const want = words(mainTitle(book.title));
  const got = new Set(words(title));
  if (!want.length || want.some((w) => !got.has(w))) return false;
  const names = String(book.author || '')
    .split(AUTHOR_SPLIT)
    .flatMap((a) => {
      const w = words(a).filter((x) => x.length >= 3);
      return w.length ? [w[0], w[w.length - 1]] : [];
    });
  const have = words(author || '');
  return !names.length || names.some((n) => have.includes(n));
};

// Companion products that share the title (and have their own, different ratings).
const COMPANION = /\b(summary|summaries|workbook|study guide|analysis|companion|conversation starters|trivia|quiz|key takeaways|cliff ?notes|lesson plans?)\b/i;
// Collections and box sets ("Deep Work … 4 Books Collection Set") carry the set's own, unrelated rating.
const COLLECTION = /\b(collection|box(ed)?[ -]?set|\d+\s*(books?|volumes?|titles?)\b|books?\s*\d+\s*[-–]\s*\d+|bundle|omnibus|complete series|anthology|set of)\b/i;
const notCompanion = (book, title) =>
  (COMPANION.test(book.title || '') || !COMPANION.test(title || '')) && (COLLECTION.test(book.title || '') || !COLLECTION.test(title || ''));
// The candidate whose own main title is exactly the book's comes first; then the most ratings.
const exactTitle = (book, title) => words(mainTitle(title)).join(' ') === words(mainTitle(book.title)).join(' ');

// Few requests at a time: a screen of tiles shouldn't flood Audible or Goodreads.
let running = 0;
const waiting = [];
function limited(fn) {
  return new Promise((resolve, reject) => {
    const go = () => {
      running++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          running--;
          waiting.length && waiting.shift()();
        });
    };
    running < 3 ? go() : waiting.push(go);
  });
}
// Goodreads has its own queue, so nothing else can hold it up.
let grRunning = 0;
const grWaiting = [];
function grLimited(fn) {
  return new Promise((resolve, reject) => {
    const go = () => {
      grRunning++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          grRunning--;
          grWaiting.length && grWaiting.shift()();
        });
    };
    grRunning < 4 ? go() : grWaiting.push(go);
  });
}

// ---- the book's own Goodreads page ---------------------------------------------
// Search suggestions carry one edition's numbers (a minor edition can show "4.24 (144)");
// the book page has the whole work's rating, the full description and the genres.
const grPages = persisted('grPages', {}); // url -> { t, v } (last 80 pages)
const PAGE_TTL = 14 * 864e5;

export function parseGoodreadsPage(html, url = '') {
  const out = {};
  try {
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(html);
    const j = ld && JSON.parse(ld[1]);
    const a = j?.aggregateRating;
    if (a) Object.assign(out, { rating: Number(a.ratingValue) || 0, count: Number(a.ratingCount) || 0, reviews: Number(a.reviewCount) || 0 });
    if (j?.numberOfPages) out.pages = Number(j.numberOfPages) || 0;
  } catch {}
  try {
    const nd = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i.exec(html);
    const st = nd && JSON.parse(nd[1])?.props?.pageProps?.apolloState;
    if (st) {
      const id = (/\/book\/show\/(\d+)/.exec(url) || [])[1];
      const books = Object.values(st).filter((o) => o?.__typename === 'Book');
      const b = books.find((o) => id && String(o.legacyId) === id) || books.find((o) => o.bookGenres?.length) || books[0];
      if (b) {
        const d = b['description({"stripped":true})'] || b.description || '';
        if (d) out.description = stripHtml(d).slice(0, 6000);
        out.genres = (b.bookGenres || [])
          .map((g) => g?.genre)
          .filter((g) => g?.name)
          .map((g) => ({ name: g.name, url: g.webUrl || `https://www.goodreads.com/genres/${encodeURIComponent(g.name.toLowerCase())}` }))
          .slice(0, 10);
        const w = b.work?.__ref ? st[b.work.__ref] : null;
        if (w?.stats?.averageRating) Object.assign(out, { rating: Number(w.stats.averageRating) || out.rating, count: Number(w.stats.ratingsCount) || out.count, reviews: Number(w.stats.textReviewsCount) || out.reviews });
        if (b.details?.numPages) out.pages = b.details.numPages;
      }
    }
  } catch {}
  // Fallbacks from the visible page: genre buttons and the description block.
  if (!out.genres?.length) {
    const seen = new Set();
    out.genres = [...String(html).matchAll(/href="(https:\/\/www\.goodreads\.com\/genres\/[^"]+)"[^>]*>\s*<span class="Button__labelItem">([^<]+)</g)]
      .map((m) => ({ url: m[1], name: stripHtml(m[2]).trim() }))
      .filter((g) => g.name && !seen.has(g.name) && seen.add(g.name))
      .slice(0, 10);
  }
  if (!out.description) {
    const d = /data-testid="description"[\s\S]*?<span class="Formatted">([\s\S]*?)<\/span>/.exec(html);
    if (d) out.description = stripHtml(d[1]).slice(0, 6000);
  }
  if (!out.rating) {
    const r = /"averageRating":([\d.]+),"ratingsCount":(\d+)/.exec(html);
    if (r) Object.assign(out, { rating: Number(r[1]), count: Number(r[2]) });
  }
  return out;
}

/** The Goodreads page for a book URL: { rating, count, reviews, description, genres[], pages } or null. */
export async function goodreadsPage(url) {
  if (!url) return null;
  const hit = grPages.get()[url];
  if (hit && Date.now() - hit.t < PAGE_TTL) return hit.v;
  const html = await getText(url, { timeout: 15000 }).catch(() => null);
  if (!html) return null;
  const v = parseGoodreadsPage(html, url);
  if (!v.rating && !v.description) return null;
  grPages.set((c) => {
    const next = { ...c, [url]: { t: Date.now(), v } };
    const keys = Object.keys(next);
    if (keys.length > 80) keys.sort((x, y) => next[x].t - next[y].t).slice(0, keys.length - 80).forEach((k) => delete next[k]);
    return next;
  });
  return v;
}

/** Goodreads' full search page, as suggestion-like entries. */
async function goodreadsSearch(q) {
  const html = await getText('https://www.goodreads.com/search?' + qs({ q }), { timeout: 15000 });
  const dec = (t) => stripHtml(t || '').trim();
  return String(html)
    .split(/itemtype=["']http:\/\/schema\.org\/Book["']/)
    .slice(1, 12)
    .map((row) => {
      const url = (/href="(\/book\/show\/[^"?]+)/.exec(row) || [])[1];
      const title = dec((/itemprop=['"]name['"][^>]*>([^<]+)</.exec(row) || [])[1]);
      const author = dec((/class="authorName"[^>]*>\s*<span itemprop="name">([^<]+)</.exec(row) || [])[1]);
      const m = /([\d.]+) avg rating\s*(?:&mdash;|—|-)\s*([\d,]+) rating/.exec(row);
      return url && title ? { bookTitleBare: title, author: { name: author }, avgRating: m?.[1] || '0', ratingsCount: m ? Number(m[2].replace(/,/g, '')) : 0, bookUrl: url } : null;
    })
    .filter(Boolean);
}

/** Goodreads average rating via its search suggestions: { rating, count, url } or null. */
export const goodreads = (raw) => {
  const book = norm(raw);
  return cached('gr8', book, () =>
    grLimited(async () => {
      const ask = async (q) => {
        const list = await getJson('https://www.goodreads.com/book/auto_complete?' + qs({ format: 'json', q }), { timeout: 12000 });
        return Array.isArray(list) ? list : [];
      };
      // The main edition: the matching entry with the most ratings.
      const pick = (list) =>
        list
          .filter((x) => sameBook(book, x.bookTitleBare || x.title || '', x.author?.name || '') && notCompanion(book, x.bookTitleBare || x.title))
          .sort((a, b) => Number(exactTitle(book, b.bookTitleBare || b.title)) - Number(exactTitle(book, a.bookTitleBare || a.title)) || (Number(b.ratingsCount) || 0) - (Number(a.ratingsCount) || 0))[0];
      const author = firstAuthor(book.author);
      const last = words(author).slice(-1)[0] || '';
      // Title + author, title + surname, title alone (the author check still applies),
      // then Goodreads' full search page.
      const tries = [...new Set([`${book.title} ${author}`.trim(), `${book.title} ${last}`.trim(), book.title])];
      let hit = null;
      let failed = 0;
      for (const q of tries) {
        const list = await ask(q).catch(() => (failed++, []));
        hit = pick(list);
        if (hit) break;
      }
      if (!hit) hit = pick(await goodreadsSearch(`${book.title} ${author}`.trim()).catch(() => (failed++, [])));
      if (!hit && failed > tries.length) throw new Error('Goodreads not reachable'); // try again later
      if (!hit) return null;
      const url = hit.bookUrl ? `https://www.goodreads.com${hit.bookUrl.split('?')[0]}` : '';
      // The whole work's rating from the book page (the suggestion has one edition's numbers).
      const page = await goodreadsPage(url).catch(() => null);
      const rating = page?.rating || Number(hit.avgRating) || 0;
      const count = page?.rating ? page.count || 0 : Number(hit.ratingsCount) || 0;
      return rating ? { rating, count, reviews: page?.reviews || 0, url, from: 'Goodreads' } : null;
    })
  );
};

/** Ratings come from Audible US (audible.com). */
export const MARKET = 'com';
const STORE_NAME = { in: 'Audible India', 'co.uk': 'Audible UK', 'com.au': 'Audible Australia', ca: 'Audible Canada', de: 'Audible Germany', com: 'Audible' };

async function audibleIn(market, book) {
  const run = (params) =>
    getJson(`https://api.audible.${market}/1.0/catalog/products?` + qs({ ...params, num_results: 10, products_sort_by: 'Relevance', response_groups: 'contributors,rating,product_attrs' }), { timeout: 12000 });
  const pick = (d) =>
    (d?.products || [])
      .map((p) => {
        const r = p.rating?.overall_distribution || {};
        const part = (x) => Number(x?.display_average_rating || x?.average_rating) || 0;
        return { p, rating: Number(r.display_average_rating || r.average_rating) || 0, count: Number(r.num_ratings) || 0, story: part(p.rating?.story_distribution), narration: part(p.rating?.performance_distribution) };
      })
      .filter((x) => x.rating && sameBook(book, x.p.title || '', (x.p.authors || []).map((a) => a.name).join(' ')) && notCompanion(book, x.p.title))
      .sort((a, b) => Number(exactTitle(book, b.p.title)) - Number(exactTitle(book, a.p.title)) || b.count - a.count)[0];
  const author = firstAuthor(book.author);
  // Keyword search first (the same search the rest of the app uses), then title + author.
  let best = pick(await run({ keywords: `${book.title} ${author}`.trim() }));
  if (!best) best = pick(await run({ title: book.title, author: author || undefined }).catch(() => null));
  if (!best && author) best = pick(await run({ keywords: book.title }).catch(() => null));
  return best ? { rating: best.rating, count: best.count, story: best.story, narration: best.narration, url: `https://www.audible.${market}/pd/${best.p.asin}`, from: STORE_NAME[market] } : null;
}

/** Audible (audible.com) stars and rating count for a book: { rating, count, url } or null. */
export const audibleStars = (raw) => {
  const book = norm(raw);
  return cached(`au7-${MARKET}`, book, () => limited(() => audibleIn('com', book)));
};

/** Hardcover's reader rating (needs your Hardcover token): the fallback when Audible and Goodreads have nothing. */
export const hardcoverStars = (raw) => {
  const book = norm(raw);
  if (!hcSrc.connected()) return Promise.resolve(null);
  return cached('hc2', book, () =>
    limited(async () => {
      const docs = await hcSrc.searchRated(`${book.title} ${firstAuthor(book.author)}`.trim());
      const hit = docs
        .filter((d) => Number(d.rating) > 0 && sameBook(book, d.title || '', (d.author_names || []).join(' ')) && notCompanion(book, d.title))
        .sort((a, b) => (Number(b.ratings_count) || 0) - (Number(a.ratings_count) || 0))[0];
      return hit ? { rating: Number(hit.rating), count: Number(hit.ratings_count) || 0, url: hit.slug ? `https://hardcover.app/books/${hit.slug}` : '', from: 'Hardcover' } : null;
    })
  );
};

const TILE = 'tile8-gr';
/** The rating to show on a tile: Goodreads. Only a real "no rating" is remembered. */
export const tileRating = (book) =>
  cached(TILE, book, async () => {
    const g = await goodreads(book);
    if (g === undefined) throw new Error('not reachable'); // ask again next time
    return g;
  });

/** Hook for tiles: { rating, count, url, from } once known. */
export function useTileRating(book) {
  const [r, setR] = useState(() => {
    const hit = book?.title ? cache.get()[`${TILE}:${keyFor(book)}`] : null;
    return hit?.v || null;
  });
  useEffect(() => {
    if (!book?.title || book.source === 'pod' || book.source === 'sum') return;
    let alive = true;
    let timer;
    const load = (tries) =>
      tileRating(book).then((v) => {
        if (!alive) return;
        if (v === undefined && tries > 0) timer = setTimeout(() => load(tries - 1), 15000); // couldn't reach: try again shortly
        else setR(v || null);
      });
    load(2);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [book?.uid, book?.title]);
  return r;
}

/** Awards the description mentions: Audie Awards (winner / finalist, with year) and AudioFile's Earphones Award. */
export function awardsFrom(text) {
  const t = String(text || '');
  const out = [];
  const audie = /(winner|won|finalist|nominee|nominated)[^.]{0,60}?(\b(19|20)\d{2}\b)?[^.]{0,30}?audie/i.exec(t) || /audie[^.]{0,60}?(winner|finalist|nominee)/i.exec(t);
  if (audie || /\baudie award/i.test(t)) {
    const year = (/(19|20)\d{2}(?=[^.]{0,40}audie)|audie[^.]{0,40}?((19|20)\d{2})/i.exec(t) || [])[0]?.match(/(19|20)\d{2}/)?.[0] || '';
    const finalist = /finalist|nominee|nominated/i.test(audie?.[0] || '') && !/winner|won/i.test(audie?.[0] || '');
    out.push({ kind: 'audie', label: `Audie ${finalist ? 'finalist' : 'Award'}${year ? ` ${year}` : ''}` });
  }
  if (/earphones award/i.test(t)) out.push({ kind: 'earphones', label: 'AudioFile Earphones' });
  if (/audiofile (magazine )?best of/i.test(t)) out.push({ kind: 'earphones', label: 'AudioFile Best of' });
  return out;
}

/** Hook: { audible, goodreads, awards } for a book page (each filled in when known). */
export function useRatings(book) {
  const [r, setR] = useState({ audible: null, goodreads: null, hardcover: null });
  useEffect(() => {
    if (!book?.title) return;
    let alive = true;
    setR({ audible: null, goodreads: null, hardcover: null, why: '' });
    const timers = [];
    // A service that couldn't be reached (undefined) is asked again a little later.
    const get = (fn, key, tries = 2) =>
      fn(book).then((v) => {
        if (!alive) return;
        if (v) setR((x) => ({ ...x, [key]: v }));
        else if (v === undefined && tries > 0) timers.push(setTimeout(() => get(fn, key, tries - 1), 8000));
      });
    // Audible's rating too, as a second badge (book page only; tiles use Goodreads).
    audibleStars(book).then((v) => alive && v && setR((x) => ({ ...x, audible: v })));
    // When Goodreads has nothing, say why, so a missing rating can be explained.
    goodreads(book).then(function done(v, tries = 2) {
      if (!alive) return;
      if (v) return setR((x) => ({ ...x, goodreads: v }));
      if (v === undefined && tries > 0) return timers.push(setTimeout(() => goodreads(book).then((w) => done(w, tries - 1)), 8000));
      setR((x) => ({ ...x, why: `Goodreads: ${whyNoRating('gr8', norm(book)) || 'no answer'}` }));
    });
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [book?.uid, book?.title]);
  return { ...r, awards: awardsFrom(book?.description) };
}

/** Hook: the book's Goodreads page (description, genres, work rating, link) once found. */
export function useGoodreads(book) {
  const [page, setPage] = useState(null);
  useEffect(() => {
    setPage(null);
    if (!book?.title || book.source === 'pod' || book.source === 'sum') return;
    let alive = true;
    goodreads(book)
      .then((g) => (g?.url ? goodreadsPage(g.url).then((p) => alive && setPage(p ? { ...p, url: g.url, rating: p.rating || g.rating, count: p.count || g.count } : { url: g.url, rating: g.rating, count: g.count, genres: [] })) : null))
      .catch(() => {});
    return () => (alive = false);
  }, [book?.uid, book?.title]);
  return page;
}
