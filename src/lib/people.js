// Authors and narrators: a short bio and photo (Wikipedia, else Open Library), the books of
// theirs you have, more of their books (Audible's catalogue), who they often read with, and
// following them — new books from people you follow show on Home.
import { getJson, qs } from './http.js';
import { persisted, library, progress } from './store.js';
import { downloads } from './downloads.js';
import { localCfg } from '../sources/local.js';
import { oneEach } from './works.js';
import { mainTitle } from './match.js';

export const following = persisted('following', {}); // key -> { name, role, at }
const bios = persisted('peopleBios', {}, { delay: 2000 }); // key -> { t, bio, photo, url, facts }
const fresh = persisted('followNew', { t: 0, items: [] });
const DAY = 864e5;

export const personKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
/** "A, B & C" → ['A', 'B', 'C'] (first ones only; "full cast" and the like left out). */
export const namesIn = (s) =>
  String(s || '')
    .split(/\s*(?:,|&|\band\b|;)\s*/i)
    .map((x) => x.trim())
    .filter((x) => x.length > 2 && !/^(full cast|various|uncredited|unknown|anonymous|others?)$/i.test(x));

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** This person's name is among a book's authors / narrators ("J.K. Rowling" ~ "J K Rowling"). */
export function hasPerson(field, name) {
  const want = norm(name).replace(/\b[a-z]\b/g, '').trim();
  return namesIn(field).some((n) => {
    const got = norm(n).replace(/\b[a-z]\b/g, '').trim();
    return got && want && (got === want || (got.split(' ').pop() === want.split(' ').pop() && (got.includes(want) || want.includes(got))));
  });
}

const PERSONISH = /(author|writer|novelist|journalist|historian|actor|actress|narrator|voice|poet|essayist|biographer|comedian|broadcaster|economist|psycholog|physician|scientist|professor|philosopher|neurosci|entrepreneur|activist|speaker|monk|teacher|podcaster|presenter|singer|lawyer|politician)/i;

/** A short bio and photo: { bio, photo, url, facts } ('' when nothing reliable was found). */
export async function bioOf(name) {
  const k = personKey(name);
  const hit = bios.get()[k];
  if (hit && Date.now() - hit.t < 30 * DAY) return hit;
  let out = { bio: '', photo: '', url: '', facts: '' };
  try {
    const w = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(name).trim().replace(/\s+/g, '_'))}`, { timeout: 10000 });
    if (w?.type === 'standard' && w.extract && PERSONISH.test(`${w.description || ''} ${w.extract.slice(0, 300)}`))
      out = { bio: w.extract, photo: w.thumbnail?.source || '', url: w.content_urls?.mobile?.page || w.content_urls?.desktop?.page || '', facts: w.description || '' };
  } catch {}
  if (!out.bio) {
    try {
      const s = await getJson('https://openlibrary.org/search/authors.json?' + qs({ q: name, limit: 1 }), { timeout: 10000 });
      const a = s?.docs?.[0];
      if (a?.key && hasPerson(a.name, name)) {
        const d = await getJson(`https://openlibrary.org/authors/${a.key}.json`, { timeout: 10000 });
        const bio = typeof d?.bio === 'string' ? d.bio : d?.bio?.value || '';
        out = {
          bio: bio.replace(/\s*\(\[Source\].*$/s, '').trim(),
          photo: d?.photos?.[0] > 0 ? `https://covers.openlibrary.org/a/id/${d.photos[0]}-M.jpg` : '',
          url: `https://openlibrary.org/authors/${a.key}`,
          facts: [a.birth_date && `Born ${a.birth_date}`, a.work_count && `${a.work_count} works`].filter(Boolean).join(' · '),
        };
      }
    } catch {}
  }
  bios.set((all) => ({ ...all, [k]: { ...out, t: Date.now() } }));
  return out;
}

/** Their books you have (library, played, phone, downloads), one copy each, newest played first. */
export function yourBooks(name, role) {
  const field = role === 'narrator' ? 'narrator' : 'author';
  const prog = progress.get();
  const pool = [...Object.values(prog).map((p) => p?.book), ...Object.values(library.get()), ...(localCfg.get().books || []), ...Object.values(downloads.get()).map((d) => d?.book)].filter((b) => b?.uid && b.source !== 'pod' && hasPerson(b[field], name));
  return oneEach(pool)
    .map((b) => ({ book: b, p: prog[b.uid] || null }))
    .sort((a, b) => (b.p?.updatedAt || 0) - (a.p?.updatedAt || 0));
}

/** More of their books from Audible's catalogue (newest first), without the ones you have. */
export async function moreBy(name, role, have = []) {
  const { audible } = await import('../sources/catalogs.js');
  const list = await (role === 'narrator' ? audible.byNarrator(name) : audible.byAuthor(name)).catch(() => []);
  const field = role === 'narrator' ? 'narrator' : 'author';
  const mine = new Set(have.map((x) => mainTitle(x.book?.title || x.title || '').toLowerCase()));
  const seen = new Set();
  return list
    .filter((b) => hasPerson(b[field], name))
    .filter((b) => {
      const t = mainTitle(b.title).toLowerCase();
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .map((b) => ({ ...b, mine: mine.has(mainTitle(b.title).toLowerCase()) }))
    .sort((a, b) => (b.released || 0) - (a.released || 0));
}

/** Narrators who share books with this one (full casts, duets), most often first. */
export function oftenWith(name, books) {
  const n = {};
  for (const b of books) for (const x of namesIn(b.narrator)) if (!hasPerson(x, name)) n[x] = (n[x] || 0) + 1;
  return Object.entries(n)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([x]) => x);
}

export const isFollowing = (name) => !!following.get()[personKey(name)];
export function toggleFollow(name, role) {
  const k = personKey(name);
  following.set((all) => {
    const next = { ...all };
    if (next[k]) delete next[k];
    else next[k] = { name: String(name).trim(), role, at: Date.now() };
    return next;
  });
  fresh.set({ t: 0, items: [] }); // look again with the new list
  return !!following.get()[k];
}

/**
 * New books (out in the last 120 days, or coming) from people you follow, that you don't have:
 * [{ book, who }]. Looked up at most once a day.
 */
export async function newFromFollowed() {
  const f = Object.values(following.get());
  if (!f.length) return [];
  const c = fresh.get();
  if (c.t && Date.now() - c.t < DAY) return c.items;
  const since = Date.now() - 120 * DAY;
  const items = [];
  for (const p of f.slice(0, 20)) {
    const have = yourBooks(p.name, p.role);
    const list = await moreBy(p.name, p.role, have).catch(() => []);
    for (const b of list.filter((x) => !x.mine && (x.released || 0) > since).slice(0, 3)) items.push({ book: b, who: p.name, role: p.role });
  }
  items.sort((a, b) => (b.book.released || 0) - (a.book.released || 0));
  const slim = items.slice(0, 15).map(({ book: b, who, role }) => ({ who, role, book: { uid: b.uid, source: b.source, kind: b.kind, title: b.title, author: b.author, narrator: b.narrator, cover: b.cover, year: b.year, released: b.released, duration: b.duration, link: b.link, description: (b.description || '').slice(0, 600), genres: b.genres, rating: b.rating, ratings: b.ratings } }));
  fresh.set({ t: Date.now(), items: slim });
  return slim;
}
export const followNew = fresh;

// ---- Photos -------------------------------------------------------------------------
// A photo you picked (from the choices found, or your own picture) wins over the bio's.
export const personPhotos = persisted('personPhotos', {}, { delay: 1000 }); // key -> url or small data URL
/** The photo to show for a person (yours, else the bio's), or ''. */
export const photoOf = (name) => personPhotos.get()[personKey(name)] || bios.get()[personKey(name)]?.photo || '';
export function setPhoto(name, url) {
  personPhotos.set((all) => {
    const next = { ...all };
    if (url) next[personKey(name)] = url;
    else delete next[personKey(name)];
    return next;
  });
}

/**
 * Photos that could be this person, best first: [{ url, from }]. Wikipedia (their page, and
 * "Name (author)"-style pages), Open Library's author photos and Wikimedia Commons.
 */
export async function photoChoices(name, role = 'author') {
  const out = [];
  const add = (url, from) => url && !out.some((x) => x.url === url) && out.push({ url, from });
  const nm = String(name).trim();
  const words = role === 'narrator' ? 'narrator OR actor OR actress OR voice' : 'author OR writer OR novelist';
  const wiki = getJson(
    'https://en.wikipedia.org/w/api.php?' +
      qs({ action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: `${nm} ${words}`, gsrlimit: 8, prop: 'pageimages', piprop: 'thumbnail', pithumbsize: 400 }),
    { timeout: 10000 }
  )
    .then((d) =>
      Object.values(d?.query?.pages || {})
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .filter((p) => p.thumbnail?.source && hasPerson(String(p.title).replace(/\s*\(.*\)\s*$/, ''), nm))
        .map((p) => ({ url: p.thumbnail.source, from: 'Wikipedia' }))
    )
    .catch(() => []);
  const ol = getJson('https://openlibrary.org/search/authors.json?' + qs({ q: nm, limit: 3 }), { timeout: 10000 })
    .then(async (s) => {
      const list = [];
      for (const a of (s?.docs || []).filter((a) => a?.key && hasPerson(a.name, nm))) {
        const d = await getJson(`https://openlibrary.org/authors/${a.key}.json`, { timeout: 8000 }).catch(() => null);
        for (const id of (d?.photos || []).filter((x) => x > 0).slice(0, 2)) list.push({ url: `https://covers.openlibrary.org/a/id/${id}-M.jpg`, from: 'Open Library' });
      }
      return list;
    })
    .catch(() => []);
  const commons = getJson(
    'https://commons.wikimedia.org/w/api.php?' +
      qs({ action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: 6, gsrsearch: `"${nm}"`, gsrlimit: 8, prop: 'imageinfo', iiprop: 'url', iiurlwidth: 400 }),
    { timeout: 10000 }
  )
    .then((d) =>
      Object.values(d?.query?.pages || {})
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .filter((p) => /\.(jpe?g|png|webp)$/i.test(p.title || '') && !/(signature|logo|cover|book|map|grave)/i.test(p.title || ''))
        .map((p) => ({ url: p.imageinfo?.[0]?.thumburl || p.imageinfo?.[0]?.url, from: 'Wikimedia' }))
    )
    .catch(() => []);
  const bio = bios.get()[personKey(nm)]?.photo;
  if (bio) add(bio, 'Wikipedia');
  for (const list of await Promise.all([wiki, ol, commons])) for (const x of list) add(x.url, x.from);
  return out.slice(0, 12);
}

/** No photo yet: the first sure one (their Wikipedia page or Open Library), kept. */
export async function findPhoto(name, role) {
  if (photoOf(name)) return photoOf(name);
  const list = await photoChoices(name, role).catch(() => []);
  const sure = list.find((x) => x.from !== 'Wikimedia');
  if (sure) setPhoto(name, sure.url);
  return sure?.url || '';
}
