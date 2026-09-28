// Listing-only catalogues for Discover search: Audible (audiobooks) and Google
// Books (ebooks/print). Results are "discover" items — opening one looks for a
// playable or readable copy across the user's own sources.
import { getJson, qs } from '../lib/http.js';
import { stripHtml } from '../lib/format.js';

const AUDIBLE = 'https://api.audible.com/1.0/catalog/products';
// Audible India carries the Hindi catalogue.
const AUDIBLE_IN = 'https://api.audible.in/1.0/catalog/products';
const GROUPS = 'contributors,product_desc,product_attrs,media,series,rating,category_ladders';

function fromAudible(p, market = '') {
  const img = p.product_images || {};
  const s = p.series?.[0];
  return {
    uid: 'au:' + p.asin,
    source: 'au',
    kind: 'discover',
    title: p.title,
    author: (p.authors || []).map((a) => a.name).slice(0, 2).join(', '),
    narrator: (p.narrators || []).map((a) => a.name).slice(0, 2).join(', '),
    cover: img['500'] || img['1024'] || '',
    year: (p.release_date || '').slice(0, 4),
    released: p.release_date ? Date.parse(p.release_date) || 0 : 0,
    duration: p.runtime_length_min ? p.runtime_length_min * 60 : 0,
    series: s ? `${s.title}${s.sequence ? ` #${s.sequence}` : ''}` : '',
    description: stripHtml(p.publisher_summary || p.merchandising_summary || ''),
    link: `https://www.audible.${market === 'in' ? 'in' : 'com'}/pd/${p.asin}`,
    ...(market ? { market } : {}),
    ...(p.language ? { language: p.language } : {}),
    genres: [...new Set((p.category_ladders || []).flatMap((l) => (l.ladder || []).map((x) => x.name)).filter(Boolean))],
    ...audibleRating(p),
  };
}

/** Star rating and number of ratings from Audible's `rating` response group. */
export function audibleRating(p) {
  const r = p.rating?.overall_distribution || {};
  const rating = Number(r.display_average_rating || r.average_rating) || 0;
  if (!rating) return {};
  // Audible also rates the story and the narrator's performance separately.
  const part = (d) => Number(d?.display_average_rating || d?.average_rating) || 0;
  const story = part(p.rating.story_distribution);
  const narration = part(p.rating.performance_distribution);
  return { rating, ratings: Number(r.num_ratings || p.rating?.num_reviews) || 0, ...(story ? { story } : {}), ...(narration ? { narration } : {}) };
}

const pools = new Map();
const products = (d, key = 'products') => (d?.[key] || []).filter((p) => p.title).map(fromAudible);

export const audible = {
  /** Audible bestsellers for a genre (listing only). */
  async genre(name) {
    const run = (sort) => getJson(`${AUDIBLE}?` + qs({ keywords: name, num_results: 40, products_sort_by: sort, response_groups: GROUPS, image_sizes: '500,1024' }));
    let d;
    try {
      d = await run('BestSellers');
    } catch {
      d = await run('Relevance');
    }
    return products(d).map((b, i) => ({ ...b, rank: i + 1 }));
  },
  async search(term) {
    if (!term.trim()) return [];
    const d = await getJson(`${AUDIBLE}?` + qs({ keywords: term, num_results: 24, products_sort_by: 'Relevance', response_groups: GROUPS, image_sizes: '500,1024' }));
    return (d.products || []).filter((p) => p.title).map(fromAudible);
  },
  /** Audible's "listeners also enjoyed" for an ASIN, falling back to same-author titles. */
  async related(asin, { exclude = [] } = {}) {
    const skip = new Set([asin, ...exclude]);
    const sims = async (type) =>
      products(await getJson(`${AUDIBLE}/${asin}/sims?` + qs({ similarity_type: type, num_results: 24, response_groups: GROUPS, image_sizes: '500,1024' })), 'similar_products');
    let out = await sims('RawSimilarities').catch(() => []);
    if (out.length < 4) out = [...out, ...(await sims('ByTheSameAuthor').catch(() => []))];
    const seen = new Set();
    return out.filter((b) => {
      const k = b.uid.slice(3);
      if (skip.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },
  /** An author's best-selling titles. */
  async byAuthor(name) {
    if (!name) return [];
    const run = (sort) => getJson(`${AUDIBLE}?` + qs({ author: name, num_results: 24, products_sort_by: sort, response_groups: GROUPS, image_sizes: '500,1024' }));
    const d = await run('BestSellers').catch(() => run('Relevance'));
    return products(d);
  },
  /** First Audible match for a title/author, used as the seed for related titles. */
  async find(title, author) {
    const d = await getJson(`${AUDIBLE}?` + qs({ title, author: author || undefined, num_results: 3, products_sort_by: 'Relevance', response_groups: GROUPS, image_sizes: '500,1024' }));
    return products(d)[0] || null;
  },
  /**
   * A genre's popular titles: a few pages of Audible best sellers (cached for the session),
   * the pool that Trending, Best of and For you pick from.
   */
  pool(name) {
    const key = String(name).toLowerCase();
    if (!pools.has(key)) {
      const page = (n) =>
        getJson(`${AUDIBLE}?` + qs({ keywords: name, num_results: 50, page: n, products_sort_by: 'BestSellers', response_groups: GROUPS, image_sizes: '500,1024' }))
          .then((d) => products(d))
          .catch(() => []);
      const job = Promise.all([page(1), page(2), page(3)]).then((pages) => {
        const seen = new Set();
        const out = pages.flat().filter((b) => !seen.has(b.uid) && seen.add(b.uid)).map((b, i) => ({ ...b, rank: i + 1 }));
        if (!out.length) pools.delete(key); // try again next time
        return out;
      });
      pools.set(key, job);
    }
    return pools.get(key);
  },
  /** Popular right now: best sellers released in the last 18 months, in best-seller order. */
  async trending(name) {
    const since = Date.now() - 548 * 864e5;
    const all = await this.pool(name);
    const fresh = all.filter((b) => b.released && b.released >= since);
    const out = fresh.length >= 8 ? fresh : [...fresh, ...all.filter((b) => !fresh.includes(b))].slice(0, 40);
    return out.map((b, i) => ({ ...b, rank: i + 1 }));
  },
  /** The best-rated popular titles of a year ('all' = any year): high rating with plenty of ratings. */
  async bestOf(name, year = 'all') {
    const all = await this.pool(name);
    const inYear = year === 'all' ? all : all.filter((b) => b.year === String(year));
    const score = (b) => (b.rating || 0) * Math.log10((b.ratings || 0) + 10);
    return inYear.filter((b) => (b.rating || 0) >= 4 || !b.rating).sort((a, b) => score(b) - score(a)).map(({ rank, ...b }) => b);
  },
  /** Hindi audiobooks from Audible India for a topic, best sellers first. */
  async hindi(term = '') {
    const run = (keywords, sort) => getJson(`${AUDIBLE_IN}?` + qs({ keywords, num_results: 40, products_sort_by: sort, response_groups: GROUPS, image_sizes: '500,1024' }));
    const toBooks = (d) => (d?.products || []).filter((p) => p.title).map((p) => fromAudible(p, 'in'));
    const isHindi = (b) => /hindi/i.test(b.language || '') || /[\u0900-\u097F]/.test(b.title);
    let d = await run(term || 'hindi', 'BestSellers').catch(() => run(term || 'hindi', 'Relevance'));
    let out = toBooks(d).filter(isHindi);
    if (out.length < 6) out = [...out, ...toBooks(d).filter((b) => !b.language && !out.includes(b))];
    if (out.length < 6) {
      d = await run(`hindi ${term}`.trim(), 'Relevance').catch(() => null);
      const seen = new Set(out.map((b) => b.uid));
      // Keyword matches can include English editions; keep only Hindi or untagged ones.
      out = [...out, ...toBooks(d).filter((b) => !seen.has(b.uid) && (!b.language || isHindi(b)))];
    }
    return out.map((b, i) => ({ ...b, rank: i + 1 }));
  },
  async details(book) {
    const base = book.market === 'in' ? AUDIBLE_IN : AUDIBLE;
    const d = await getJson(`${base}/${book.uid.slice(3)}?` + qs({ response_groups: GROUPS, image_sizes: '500,1024' }));
    return d.product ? { ...book, ...fromAudible(d.product, book.market) } : book;
  },
};

function fromGoogle(item) {
  const v = item.volumeInfo || {};
  const img = v.imageLinks || {};
  const cover = (img.extraLarge || img.large || img.medium || img.thumbnail || '').replace(/^http:/, 'https:').replace(/&edge=curl/, '').replace(/zoom=1/, 'zoom=2');
  return {
    uid: 'gbk:' + item.id,
    source: 'gbk',
    kind: 'discover',
    title: v.subtitle && v.title.length < 40 ? `${v.title}: ${v.subtitle}` : v.title,
    author: (v.authors || []).slice(0, 2).join(', '),
    cover,
    year: (v.publishedDate || '').slice(0, 4),
    description: stripHtml(v.description || ''),
    subjects: (v.categories || []).slice(0, 6),
    ...(v.averageRating ? { rating: +v.averageRating, ratings: +v.ratingsCount || 0 } : {}),
    link: v.infoLink || `https://books.google.com/books?id=${item.id}`,
  };
}

export const googleBooks = {
  async search(term) {
    if (!term.trim()) return [];
    const d = await getJson('https://www.googleapis.com/books/v1/volumes?' + qs({ q: term, maxResults: 24, printType: 'books', orderBy: 'relevance' }));
    return (d.items || []).filter((i) => i.volumeInfo?.title).map(fromGoogle);
  },
  async details(book) {
    const d = await getJson(`https://www.googleapis.com/books/v1/volumes/${book.uid.slice(4)}`);
    return d?.volumeInfo ? { ...book, ...fromGoogle(d) } : book;
  },
};
