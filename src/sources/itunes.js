// Apple's free iTunes catalogue (no key): audiobook listings with narrators' publishers,
// descriptions and proper square covers. AudioYam Lite's store-safe catalogue — the books
// are listings ("discover"); the Play / Read buttons find a copy from your own sources.
import { getJson, qs } from '../lib/http.js';
import { cleanAuthor } from '../lib/match.js';

const big = (u) => String(u || '').replace(/^http:/, 'https:').replace(/\/\d+x\d+(bb)?\./, '/1000x1000bb.');
const clean = (t) => String(t || '').replace(/\s*\((unabridged|abridged)\)\s*$/i, '').trim();
const strip = (h) => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

const toBook = (r) => ({
  uid: `it:${r.collectionId || r.trackId}`,
  source: 'it',
  kind: 'discover',
  title: clean(r.collectionName || r.trackName),
  author: cleanAuthor(r.artistName),
  cover: big(r.artworkUrl100 || r.artworkUrl60),
  description: strip(r.description),
  year: (r.releaseDate || '').slice(0, 4),
  genres: r.primaryGenreName ? [r.primaryGenreName] : [],
});

export async function search(term) {
  if (!term.trim()) return [];
  const d = await getJson('https://itunes.apple.com/search?' + qs({ term, media: 'audiobook', entity: 'audiobook', limit: 24 }), { timeout: 12000 });
  return (d.results || []).filter((r) => r.collectionName || r.trackName).map(toBook);
}

/** Apple's top audiobooks chart (newer chart address first; the old one, then a search, if not). */
export async function top(cc = 'us') {
  const tries = [
    async () => (await getJson(`https://rss.applemarketingtools.com/api/v2/${cc}/audio-books/top/30/audio-books.json`, { timeout: 15000 }))?.feed?.results?.map((r) => r.id),
    async () => (await getJson(`https://rss.applemarketingtools.com/api/v2/${cc}/audio-books/top-audio-books/30/audio-books.json`, { timeout: 15000 }))?.feed?.results?.map((r) => r.id),
    async () => (await getJson(`https://itunes.apple.com/${cc}/rss/topaudiobooks/limit=30/json`, { timeout: 15000 }))?.feed?.entry?.map((e) => e?.id?.attributes?.['im:id']),
  ];
  let ids = [];
  for (const t of tries) {
    ids = ((await t().catch(() => null)) || []).filter(Boolean);
    if (ids.length) break;
  }
  if (!ids.length) {
    // No chart answered: a broad search still gives a shelf of audiobooks with covers.
    const d = await getJson('https://itunes.apple.com/search?' + qs({ term: 'bestseller', media: 'audiobook', entity: 'audiobook', limit: 30, country: cc }), { timeout: 12000 });
    return (d.results || []).filter((r) => r.collectionName || r.trackName).map(toBook);
  }
  // The chart has small pictures and no descriptions: look the books up for the full listing.
  const l = await getJson('https://itunes.apple.com/lookup?' + qs({ id: ids.join(','), country: cc }), { timeout: 15000 });
  const byId = new Map((l.results || []).map((r) => [String(r.collectionId || r.trackId), r]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean).map(toBook);
}

export async function details(book) {
  if (book.description) return book;
  const l = await getJson('https://itunes.apple.com/lookup?' + qs({ id: book.uid.slice(3) }), { timeout: 12000 }).catch(() => null);
  const r = l?.results?.[0];
  return r ? { ...book, ...toBook(r) } : book;
}

// ---- Rows for Discover: new, for you, and genres ----------------------------------
const searchRaw = (term, limit = 100) =>
  getJson('https://itunes.apple.com/search?' + qs({ term, media: 'audiobook', entity: 'audiobook', limit }), { timeout: 12000 })
    .then((d) => (d.results || []).filter((r) => r.collectionName || r.trackName))
    .catch(() => []);
const uniq = (list) => {
  const seen = new Set();
  return list.filter((r) => {
    const k = String(r.collectionId || r.trackId);
    return !seen.has(k) && seen.add(k);
  });
};

/** Genres, by the catalogue's own genre names (a few search words fill each one). */
export const GENRES = [
  { key: 'mystery', name: 'Mystery & thrillers', icon: 'flame', words: ['thriller', 'mystery', 'detective', 'crime'], match: /myster|thriller|crime/i },
  { key: 'scifi', name: 'Sci-fi & fantasy', icon: 'sparkle', words: ['fantasy', 'science fiction', 'dragon', 'space'], match: /sci-fi|fantasy|science fiction/i },
  { key: 'self', name: 'Self-development', icon: 'bulb', words: ['habits', 'mindset', 'self help', 'success'], match: /self|personal|psycholog|health|business/i },
  { key: 'history', name: 'History', icon: 'book', words: ['history', 'war', 'empire', 'ancient'], match: /histor/i },
  { key: 'bio', name: 'Biographies & memoirs', icon: 'headphones', words: ['memoir', 'biography', 'life story', 'autobiography'], match: /biograph|memoir/i },
  { key: 'romance', name: 'Romance', icon: 'heart', words: ['romance', 'love story', 'love'], match: /romance/i },
  { key: 'fiction', name: 'Fiction', icon: 'book', words: ['novel', 'family', 'secrets', 'summer'], match: /^fiction|literary|general fiction/i },
  { key: 'kids', name: 'Kids & young adults', icon: 'sparkle', words: ['kids', 'young adult', 'adventure', 'magic'], match: /kids|young adult|children/i },
];

export async function genre(key) {
  const g = GENRES.find((x) => x.key === key);
  if (!g) return [];
  const lists = await Promise.all(g.words.map((w) => searchRaw(w)));
  // Round-robin across the search words, keeping only books the catalogue files in this genre.
  const out = [];
  for (let i = 0; i < 100; i++) for (const l of lists) if (l[i] && g.match.test(l[i].primaryGenreName || '')) out.push(l[i]);
  return uniq(out).slice(0, 60).map(toBook);
}

/** Newest releases across the big genres, newest first. */
export async function newest() {
  const lists = await Promise.all(['novel', 'thriller', 'fantasy', 'memoir', 'history', 'habits', 'romance'].map((w) => searchRaw(w)));
  const year = Date.now() - 365 * 864e5;
  return uniq(lists.flat())
    .filter((r) => Date.parse(r.releaseDate || '') > year)
    .sort((a, b) => Date.parse(b.releaseDate) - Date.parse(a.releaseDate))
    .slice(0, 60)
    .map(toBook);
}

/** More by the authors you listen to, without the books you already have. */
export async function forYou(books) {
  const have = new Set(books.map((b) => String(b.title || '').toLowerCase().slice(0, 24)));
  const authors = [...new Set(books.map((b) => String(b.author || '').split(',')[0].trim()).filter((a) => a && !/unknown|various/i.test(a)))].slice(0, 6);
  if (!authors.length) return [];
  const lists = await Promise.all(authors.map((a) => searchRaw(a, 25).then((l) => l.filter((r) => String(r.artistName || '').toLowerCase().includes(a.split(' ').pop().toLowerCase())))));
  const out = [];
  for (let i = 0; i < 25; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return uniq(out)
    .map(toBook)
    .filter((b) => !have.has(b.title.toLowerCase().slice(0, 24)))
    .slice(0, 40);
}
