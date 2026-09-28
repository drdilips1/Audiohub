// Hardcover — your shelves (Want to Read / Currently Reading / Read) on Home and
// status buttons on book pages. Token: hardcover.app → Settings → API.
//
// Hardcover limits queries to a nesting depth of 3 and rate-limits per minute
// and per day, so shelves are fetched in ONE shallow query and cached, and book
// pages only call the API when the user taps a status button.
import { sendJson } from '../lib/http.js';
import { hardcover, persisted } from '../lib/store.js';
import { matches } from '../lib/match.js';

const API = 'https://api.hardcover.app/v1/graphql';
export const STATUS = { want: 1, reading: 2, read: 3 };
export const connected = () => !!hardcover.get().token;

const token = () => hardcover.get().token.trim().replace(/^Bearer\s+/i, '');
const lastGood = persisted('hardcoverShelves', { at: 0, items: [] });

async function gql(query, variables = {}, tok = token()) {
  let r;
  try {
    r = await sendJson(API, 'POST', { query, variables }, {
      Authorization: `Bearer ${tok}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Inkwell/1.5 (Android audiobook app)',
    });
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new Error('Hardcover rejected the token — copy a fresh one from hardcover.app/account/api (tokens expire after a year)');
    if (e.status === 429) throw new Error('Hardcover rate limit reached — try again in a minute');
    throw e;
  }
  if (r?.errors?.length) throw new Error(r.errors[0].message || 'Hardcover request failed');
  if (!r?.data) throw new Error('Hardcover returned no data');
  return r.data;
}
const me = (d) => (Array.isArray(d.me) ? d.me[0] : d.me) || {};

export async function connect(tok) {
  const t = tok.trim().replace(/^Bearer\s+/i, '');
  const d = await gql('query { me { id username } }', {}, t);
  const u = me(d);
  if (!u.id) throw new Error('Hardcover did not accept that token');
  hardcover.set({ token: t, username: u.username || 'Hardcover', userId: u.id });
  shelvesPromise = null;
  return u.username;
}
/** Forget cached shelves (pull-to-refresh). */
export const resetCache = () => {
  shelvesPromise = null;
};

export const disconnect = () => {
  hardcover.set({ token: '', username: '' });
  lastGood.set({ at: 0, items: [] });
  shelvesPromise = null;
};

// Depth ≤ 3: me → user_books → book, scalar/jsonb fields only.
const BOOK = 'id title description release_year cached_image cached_contributors cached_tags';

// cached_tags looks like { Genre: [{ tag: 'Fantasy' }, …], Mood: […], … }
function tagsOf(t) {
  if (!t || typeof t !== 'object') return [];
  return Object.values(t)
    .flat()
    .map((x) => (typeof x === 'string' ? x : x?.tag))
    .filter(Boolean)
    .slice(0, 20);
}

function toBook(b, status) {
  const img = b.cached_image?.url || (typeof b.cached_image === 'string' ? b.cached_image : '') || b.image?.url || '';
  const contributors = Array.isArray(b.cached_contributors) ? b.cached_contributors : [];
  const authors = contributors
    .filter((c) => !c.contribution || /author/i.test(c.contribution))
    .map((c) => c.author?.name || c.name)
    .filter(Boolean);
  return {
    uid: 'hc:' + b.id,
    source: 'hc',
    kind: 'discover',
    title: b.title,
    author: (authors.length ? authors : b.author_names || []).slice(0, 2).join(', '),
    cover: img,
    year: b.release_year || '',
    description: b.description || '',
    genres: tagsOf(b.cached_tags),
    hcStatus: status,
  };
}

let shelvesPromise = null;
let shelvesAt = 0;

/** All three shelves in one request, cached for 5 minutes. */
export function allShelves({ fresh = false } = {}) {
  if (!connected()) return Promise.resolve([]);
  if (!fresh && shelvesPromise && Date.now() - shelvesAt < 5 * 60e3) return shelvesPromise;
  shelvesAt = Date.now();
  shelvesPromise = gql(`query { me { user_books(where: { status_id: { _in: [1, 2, 3] } }, limit: 200) { status_id book { ${BOOK} } } } }`)
    .then((d) => {
      const items = (me(d).user_books || []).filter((ub) => ub.book?.title).map((ub) => toBook(ub.book, ub.status_id));
      lastGood.set({ at: Date.now(), items });
      return items;
    })
    .catch((e) => {
      shelvesPromise = null;
      // Keep showing the last shelves that loaded, if any.
      const cached = lastGood.get();
      if (cached.items.length) return cached.items;
      throw e;
    });
  return shelvesPromise;
}

export async function shelf(status) {
  return (await allShelves()).filter((b) => b.hcStatus === status);
}

export async function details(book) {
  const d = await gql(`query B($id: Int!) { books(where: { id: { _eq: $id } }, limit: 1) { ${BOOK} } }`, { id: +book.uid.slice(3) });
  const b = d.books?.[0];
  return b ? { ...book, ...toBook(b, book.hcStatus), cover: book.cover || toBook(b).cover, link: `https://hardcover.app/books/${book.uid.slice(3)}` } : book;
}

/** Counts per shelf, used by Settings → Test. */
export async function counts() {
  const all = await allShelves({ fresh: true });
  const c = { want: 0, reading: 0, read: 0 };
  for (const b of all) {
    const k = Object.keys(STATUS).find((x) => STATUS[x] === b.hcStatus);
    if (k) c[k]++;
  }
  return c;
}

/** Status of a book from the cached shelves — no extra API calls. */
export async function knownStatus(book) {
  if (!connected()) return null;
  const all = await allShelves().catch(() => lastGood.get().items);
  const hit = book.uid.startsWith('hc:')
    ? all.find((b) => b.uid === book.uid)
    : all.find((b) => matches(b.title, book.title) && (!b.author || !book.author || matches(b.author.split(',')[0], book.author)));
  return hit ? hit.hcStatus : 0;
}

/** Books matching a search, with Hardcover's own reader ratings (for the ratings fallback). */
export async function searchRated(q) {
  const d = await gql('query S($q: String!) { search(query: $q, query_type: "Book", per_page: 5, page: 1) { results } }', { q });
  return (d.search?.results?.hits || []).map((h) => h.document).filter(Boolean);
}

async function findBookId(book) {
  if (book.uid.startsWith('hc:')) return +book.uid.slice(3);
  const d = await gql('query S($q: String!) { search(query: $q, query_type: "Book", per_page: 1, page: 1) { results } }', {
    q: `${book.title} ${(book.author || '').split(',')[0]}`.trim(),
  });
  const hit = d.search?.results?.hits?.[0]?.document;
  if (!hit?.id) throw new Error('Could not find this book on Hardcover');
  return +hit.id;
}

export async function setStatus(book, status) {
  const bookId = await findBookId(book);
  const d = await gql('query U($id: Int!) { me { user_books(where: { book_id: { _eq: $id } }) { id } } }', { id: bookId });
  const ub = me(d).user_books?.[0];
  if (ub?.id) {
    await gql('mutation M($id: Int!, $s: Int!) { update_user_book(id: $id, object: { status_id: $s }) { id error } }', { id: ub.id, s: status });
  } else {
    const r = await gql('mutation M($b: Int!, $s: Int!) { insert_user_book(object: { book_id: $b, status_id: $s }) { id error } }', { b: bookId, s: status });
    if (r.insert_user_book?.error) throw new Error(r.insert_user_book.error);
  }
  shelvesPromise = null; // refresh shelves next time
  return status;
}
