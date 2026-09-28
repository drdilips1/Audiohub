// Your own verdicts on books, and a taste profile built from them (plus what you've
// finished, are listening to and saved). Used to rank recommendations, explain each
// pick ("why this pick"), give it a match %, and hold back poorly rated or poorly
// narrated titles.
import { persisted, library, progress } from './store.js';
import { words, mainTitle } from './match.js';

// key -> { verdict, story, narration, reasons[], title, author, narrator, genres[], updatedAt }
// A cleared rating stays as { verdict: '', updatedAt } so the clearing syncs too.
export const myRatings = persisted('myRatings', {});

export const VERDICTS = [
  ['love', '❤️', 'Loved it'],
  ['like', '👍', 'Liked it'],
  ['ok', '😐', "It's OK"],
  ['dislike', '👎', 'Not for me'],
  ['dnf', '🚫', "Didn't finish"],
];
export const PARTS = [
  ['great', 'Great'],
  ['ok', 'OK'],
  ['weak', 'Weak'],
];
export const REASONS = ['Narration', 'Too slow', 'Too long', 'Story', 'Writing', 'Characters', 'Too dark', 'Not my genre'];

const lastName = (a) => words(String(a || '').split(/,|&|\band\b/)[0]).slice(-1)[0] || '';
const names = (s) =>
  String(s || '')
    .split(/,|&|\band\b/)
    .map((a) => words(a).join(' '))
    .filter(Boolean);
export const rateKey = (b) => `${words(mainTitle(b?.title)).join(' ')}|${lastName(b?.author)}`;

export const ratingOf = (b) => {
  const r = myRatings.get()[rateKey(b)];
  return r?.verdict ? r : null;
};

export function rateBook(book, patch) {
  const k = rateKey(book);
  if (!k.split('|')[0]) return;
  myRatings.set((all) => {
    const prev = all[k]?.verdict ? all[k] : {};
    const next = {
      ...prev,
      ...patch,
      title: mainTitle(book.title),
      author: String(book.author || ''),
      narrator: String(book.narrator || prev.narrator || ''),
      genres: (book.genres?.length ? book.genres : book.subjects || prev.genres || []).slice(0, 8),
      updatedAt: Date.now(),
    };
    if (patch.verdict && !['dislike', 'dnf'].includes(patch.verdict)) next.reasons = [];
    return { ...all, [k]: next };
  });
}
export const clearRating = (book) => myRatings.set((all) => ({ ...all, [rateKey(book)]: { verdict: '', updatedAt: Date.now() } }));

// ---- taste profile ------------------------------------------------------------
const VERDICT_W = { love: 2, like: 1, ok: 0, dislike: -1.5, dnf: -2 };
const PART_W = { great: 1.5, ok: 0, weak: -2 };
// Broad shelves that say nothing about taste.
const BROAD = /^(audible|audiobooks?|fiction|nonfiction|non-fiction|literature & fiction|books?|general|kindle|unabridged)$/i;

let cached = null;
let cachedAt = 0;
export function profile() {
  if (cached && Date.now() - cachedAt < 5000) return cached;
  const authors = new Map(); // last name -> { w, titles: [] , loved }
  const narrators = new Map(); // full name -> { w, verdict }
  const genres = new Map(); // genre -> w
  const bump = (map, k, w, extra) => {
    if (!k) return;
    const cur = map.get(k) || { w: 0, titles: [] };
    cur.w += w;
    if (extra) Object.assign(cur, extra(cur));
    map.set(k, cur);
  };
  const seen = new Set();
  const feed = (b, w, { story = w, narration = 0, verdict } = {}) => {
    const k = rateKey(b);
    if (!b?.title || seen.has(k)) return;
    seen.add(k);
    const a = lastName(b.author);
    bump(authors, a, story, (c) => ({ titles: [...c.titles, { title: mainTitle(b.title), verdict }] }));
    if (narration) for (const n of names(b.narrator)) bump(narrators, n, narration, () => ({ name: n }));
    for (const g of b.genres || b.subjects || []) if (g && !BROAD.test(g)) bump(genres, String(g).toLowerCase(), w * 0.6);
  };
  // Your own ratings count most.
  for (const r of Object.values(myRatings.get())) {
    if (!r?.verdict) continue;
    const w = VERDICT_W[r.verdict] ?? 0;
    const story = r.story ? PART_W[r.story] + w * 0.5 : w;
    const narration = r.narration ? PART_W[r.narration] : r.reasons?.includes('Narration') ? -2 : r.verdict === 'love' ? 0.8 : 0;
    feed(r, w, { story, narration, verdict: r.verdict });
  }
  // Then what you've finished, are listening to, and saved.
  for (const p of Object.values(progress.get())) if (p?.book) feed(p.book, p.finished ? 0.8 : 0.3, { verdict: p.finished ? 'finished' : 'listening' });
  for (const b of Object.values(library.get())) if (b) feed(b, 0.2, { verdict: 'saved' });
  cached = { authors, narrators, genres, size: seen.size };
  cachedAt = Date.now();
  return cached;
}
myRatings.subscribe(() => (cached = null));

/** Titles you own, are listening to, finished or rated: never recommended back to you. */
export function knownTitles() {
  const t = new Set();
  const add = (b) => b?.title && t.add(words(mainTitle(b.title)).join(' '));
  Object.values(library.get()).forEach(add);
  Object.values(progress.get()).forEach((p) => add(p?.book));
  Object.values(myRatings.get()).forEach((r) => r?.verdict && add(r));
  return t;
}
export const isKnown = (b, known = knownTitles()) => known.has(words(mainTitle(b?.title)).join(' '));

// ---- scoring ------------------------------------------------------------------
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));
const VERB = { love: 'loved', like: 'liked', finished: 'finished', listening: 'are listening to', saved: 'saved' };

/**
 * How well a book fits your taste: { match (0–99), why, pass, reasons[] }.
 * `pass` is the quality gate: well rated (story and narration), and not by a
 * narrator or author you've marked down.
 */
export function scoreBook(b, p = profile()) {
  const why = [];
  let a = 0;
  // Author
  const au = p.authors.get(lastName(b.author));
  if (au) {
    a += clamp(au.w * 8, -30, 24);
    const t = au.titles.find((x) => x.verdict === 'love') || au.titles.find((x) => x.verdict === 'like') || au.titles.find((x) => x.verdict === 'finished') || au.titles[0];
    if (au.w > 0 && t && VERB[t.verdict]) why.push({ w: au.w * 8, text: `You ${VERB[t.verdict]} ${t.title}, by the same author` });
  }
  // Narrator
  let narratorDown = false;
  for (const n of names(b.narrator)) {
    const nr = p.narrators.get(n);
    if (!nr) continue;
    a += clamp(nr.w * 7, -35, 18);
    if (nr.w <= -1.5) narratorDown = true;
    if (nr.w > 0.5) why.push({ w: nr.w * 7, text: `Narrated by ${titleCase(n)}, a narrator you rate highly` });
  }
  // Genres: the best two that match your taste
  const gs = [...new Set((b.genres || []).map((g) => String(g).toLowerCase()))]
    .map((g) => [g, p.genres.get(g)?.w || 0])
    .sort((x, y) => y[1] - x[1]);
  const gTop = gs.slice(0, 2).reduce((s, [, w]) => s + w, 0);
  a += clamp(gTop * 4, -15, 20);
  if (gs[0]?.[1] > 0.5) why.push({ w: gs[0][1] * 4, text: `Fits your taste in ${titleCase(gs[0][0])}` });
  // Quality
  const r = b.rating || 0;
  const n = b.ratings || 0;
  let q = r ? clamp((r - 4) * 30, -20, 28) + clamp(Math.log10(n + 1) * 3, 0, 12) : 6;
  if (b.narration) q += clamp((b.narration - 4.3) * 12, -12, 6);
  if (r >= 4.5 && n >= 500) why.push({ w: 6, text: b.narration && b.story ? `★ ${b.story.toFixed(1)} story · ${b.narration.toFixed(1)} narration` : `★ ${r.toFixed(1)} from ${fmtK(n)} listeners` });
  const pass = !narratorDown && (!au || au.w > -1.5) && (!r || (r >= 4.2 && n >= 25)) && (!b.narration || b.narration >= 4.0);
  const match = Math.round(clamp(38 + q + a, 20, 99));
  why.sort((x, y) => y.w - x.w);
  return { match, pass, why: why[0]?.text || '', reasons: why.map((x) => x.text) };
}

/** Rank a list for you: drops what you know and what fails the quality gate, adds match % and why. */
export function rankForYou(list, { hours } = {}) {
  const p = profile();
  const known = knownTitles();
  const seen = new Set();
  return (list || [])
    .filter((b) => {
      const k = words(mainTitle(b?.title)).join(' ');
      if (!k || known.has(k) || seen.has(k)) return false;
      seen.add(k);
      return fitsHours(b, hours);
    })
    .map((b) => {
      const s = scoreBook(b, p);
      return { ...b, match: s.match, why: b.why || s.why, _pass: s.pass };
    })
    .filter((b) => b._pass)
    .sort((x, y) => y.match - x.match)
    .map(({ _pass, ...b }) => b);
}

// ---- "I have N hours" ---------------------------------------------------------
export const HOURS = [
  ['', 'Any length'],
  ['0-5', 'Under 5 h'],
  ['5-10', '5–10 h'],
  ['10-20', '10–20 h'],
  ['20-', '20 h +'],
];
export const hoursPick = persisted('hoursPick', '');
export function fitsHours(b, range) {
  if (!range) return true;
  const d = (b?.duration || (b?.aiHours ? b.aiHours * 3600 : 0)) / 3600;
  if (!d) return false;
  const [lo, hi] = range.split('-').map((x) => (x === '' ? null : +x));
  return d >= (lo || 0) && (hi == null || d <= hi * 1.05);
}

const titleCase = (s) => String(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());
