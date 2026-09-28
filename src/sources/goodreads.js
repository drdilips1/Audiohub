// Goodreads closed its public API, so shelves come from the library export:
// goodreads.com → My Books → Import and export → Export library (CSV).
import { goodreads } from '../lib/store.js';
import { getJson, getText, qs, clearHttpCache } from '../lib/http.js';

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

const isbn = (v) => String(v || '').replace(/[^0-9Xx]/g, '');

export function importCsv(text) {
  const [head, ...rows] = parseCsv(text);
  const col = (name) => head.findIndex((h) => h.trim().toLowerCase() === name);
  const iTitle = col('title'), iAuthor = col('author'), iShelf = col('exclusive shelf'), iId = col('book id');
  const iIsbn = col('isbn13'), iIsbn10 = col('isbn'), iYear = col('original publication year'), iRating = col('my rating');
  if (iTitle < 0 || iShelf < 0) throw new Error('This does not look like a Goodreads library export (CSV)');
  const books = rows
    .map((r) => {
      const code = isbn(r[iIsbn]) || isbn(r[iIsbn10]);
      return {
        uid: 'gr:' + (r[iId] || r[iTitle]),
        source: 'gr',
        kind: 'discover',
        title: r[iTitle].replace(/\s*\([^)]*#\d+[^)]*\)\s*$/, '').trim(),
        author: r[iAuthor] || '',
        shelf: r[iShelf] || 'read',
        rating: +r[iRating] || 0,
        isbn: code,
        year: r[iYear] || '',
        cover: code ? `https://covers.openlibrary.org/b/isbn/${code}-L.jpg?default=false` : '',
      };
    })
    .filter((b) => b.title);
  goodreads.set({ books, importedAt: Date.now() });
  return books.length;
}

export const shelf = (name) => goodreads.get().books.filter((b) => b.shelf === name);
export const shelves = () => [...new Set(goodreads.get().books.map((b) => b.shelf))];

// Enrich with Open Library's description + cover.
export async function details(book) {
  try {
    const d = await getJson('https://openlibrary.org/search.json?' + qs({ title: book.title, author: book.author, limit: 1, fields: 'key,cover_i' }));
    const doc = d.docs?.[0];
    if (!doc) return book;
    const w = await getJson(`https://openlibrary.org${doc.key}.json`);
    const desc = typeof w.description === 'string' ? w.description : w.description?.value || '';
    return {
      ...book,
      description: book.description || desc,
      cover: book.cover || (doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : ''),
      link: `https://www.goodreads.com/book/show/${book.uid.slice(3)}`,
    };
  } catch {
    return book;
  }
}

// ---- Profile sync (RSS) --------------------------------------------------------
// Goodreads has no API, but every profile publishes its shelves as RSS feeds.
// Paste a profile link (goodreads.com/user/show/12345-name) — or, for a private
// profile, the RSS link from a shelf page (it carries a private key).

const SHELVES = ['currently-reading', 'to-read', 'read'];

export function parseProfile(input) {
  const s = String(input || '').trim();
  const id = (/user\/show\/(\d+)/.exec(s) || /list_rss\/(\d+)/.exec(s) || /review\/list\/(\d+)/.exec(s) || /^(\d+)$/.exec(s) || [])[1];
  const key = (/[?&]key=([^&#]+)/.exec(s) || [])[1] || '';
  return id ? { userId: id, key } : null;
}

const text = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent?.trim() || '';

async function fetchShelf(userId, key, shelf) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const xml = await getText(`https://www.goodreads.com/review/list_rss/${userId}?` + qs({ shelf, key, page, per_page: 100 }));
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Goodreads returned something unexpected — is the profile public?');
    const items = [...doc.getElementsByTagName('item')];
    for (const it of items) {
      const bookId = text(it, 'book_id');
      const cover = text(it, 'book_large_image_url') || text(it, 'book_medium_image_url') || text(it, 'book_image_url');
      out.push({
        uid: 'gr:' + (bookId || text(it, 'title')),
        source: 'gr',
        kind: 'discover',
        title: text(it, 'title').replace(/\s*\([^)]*#\d+[^)]*\)\s*$/, '').trim(),
        author: text(it, 'author_name'),
        shelf,
        rating: +text(it, 'user_rating') || 0,
        isbn: text(it, 'isbn'),
        year: text(it, 'book_published'),
        // Goodreads' placeholder images contain "nophoto"
        cover: cover && !/nophoto/i.test(cover) ? cover.replace(/\._S[XY]\d+_/, '') : '',
        description: text(it, 'book_description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      });
    }
    if (items.length < 100) break;
  }
  return out;
}

export async function connectProfile(input) {
  const p = parseProfile(input);
  if (!p) throw new Error('Paste your Goodreads profile link, e.g. goodreads.com/user/show/12345-yourname');
  goodreads.set({ ...goodreads.get(), userId: p.userId, key: p.key });
  return syncProfile();
}

export async function syncProfile() {
  const { userId, key } = goodreads.get();
  if (!userId) return 0;
  clearHttpCache();
  let books = [];
  try {
    const shelves = await Promise.all(SHELVES.map((sh) => fetchShelf(userId, key, sh)));
    books = shelves.flat();
  } catch (e) {
    if (e.status === 404 || e.status === 403) throw new Error('Goodreads refused — make the profile public (Settings → Privacy) or paste the RSS link from your shelf page');
    throw e;
  }
  goodreads.set({ ...goodreads.get(), books, importedAt: Date.now() });
  return books.length;
}

export const profileConnected = () => !!goodreads.get().userId;
export const disconnectProfile = () => goodreads.set({ books: [], importedAt: 0, userId: '', key: '' });

// Keep shelves fresh: on launch when older than an hour.
if (goodreads.get().userId && Date.now() - (goodreads.get().importedAt || 0) > 3600e3) setTimeout(() => syncProfile().catch(() => {}), 5000);
