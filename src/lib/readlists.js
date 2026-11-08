// Read later (a list in the Library) and books you've read elsewhere: a list pasted from your
// notes (or a Goodreads export) becomes ratings — better recommendations, never suggested
// back — and shows under Library → Finished as "Read elsewhere".
import { persisted, summarize, progress } from './store.js';
import { rateBook, markAlreadyRead, myRatings, alreadyRead, rateKey } from './taste.js';
import { mainTitle } from './match.js';

export const readLater = persisted('readLater', {}); // uid -> { book, at }
export const isReadLater = (b, all = readLater.get()) => !!(b?.uid && all[b.uid]);
export function toggleReadLater(b) {
  if (!b?.uid) return false;
  const on = !isReadLater(b);
  readLater.set((all) => {
    const next = { ...all };
    if (on) next[b.uid] = { book: summarize(b), at: Date.now() };
    else delete next[b.uid];
    return next;
  });
  return on;
}
/** Started or finished: off the Read later list (it's no longer "later"). */
progress.subscribe((p) => {
  const later = readLater.get();
  const gone = Object.keys(later).filter((uid) => p[uid]);
  if (gone.length) readLater.set((all) => Object.fromEntries(Object.entries(all).filter(([uid]) => !gone.includes(uid))));
});

/** A rating out of 5 → how you felt (the same scale as rating a book in the app). */
const verdictFor = (r) => (r >= 4.5 ? 'love' : r >= 3.5 ? 'like' : r >= 2.5 ? 'ok' : 'dislike');

/**
 * One line of a list → { title, author, rating (0–5, 0 = none) }, or null.
 * Takes most ways of writing it: "Dune by Frank Herbert ★★★★★", "Dune - Frank Herbert - 4/5",
 * "1. Dune, Frank Herbert (8/10)", "Dune | Herbert | 4 stars", "Dune\tFrank Herbert\t5".
 */
export function parseLine(line) {
  let s = String(line || '').replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim();
  if (s.length < 2 || /^#/.test(s)) return null;
  let rating = 0;
  const stars = s.match(/[★⭐]+(½)?/);
  if (stars) {
    rating = [...stars[0].replace('½', '')].length + (stars[1] ? 0.5 : 0);
    s = s.replace(stars[0], ' ');
  }
  const frac = s.match(/\(?\s*(\d+(?:[.,]\d)?)\s*\/\s*(5|10)\s*\)?/);
  if (!rating && frac) {
    rating = (parseFloat(frac[1].replace(',', '.')) * 5) / +frac[2];
    s = s.replace(frac[0], ' ');
  }
  const word = s.match(/\(?\s*(?:rating|rated|my rating)?\s*:?\s*(\d(?:[.,]5)?)\s*(?:stars?|\*)\s*\)?/i);
  if (!rating && word) {
    rating = parseFloat(word[1].replace(',', '.'));
    s = s.replace(word[0], ' ');
  }
  // A lone number 1–5 at the end, after a separator ("Dune - Herbert - 4", "Dune\t5").
  const tail = s.match(/(?:\s[-–—|,;]\s*|\t\s*|\(\s*)([1-5](?:[.,]5)?)\s*\)?\s*$/);
  if (!rating && tail) {
    rating = parseFloat(tail[1].replace(',', '.'));
    s = s.slice(0, tail.index);
  }
  s = s.replace(/[\s\-–—|,;:()]+$/, '').replace(/\s{2,}/g, ' ').trim();
  let title = s;
  let author = '';
  const by = s.match(/^(.+?)\s+by\s+(.+)$/i);
  const sep = s.split(/\s*\t\s*|\s+[-–—|]\s+|\s*;\s*/).filter(Boolean);
  if (by) [title, author] = [by[1], by[2]];
  else if (sep.length >= 2) [title, author] = [sep[0], sep[1]];
  else if (/,/.test(s)) {
    const i = s.lastIndexOf(',');
    [title, author] = [s.slice(0, i), s.slice(i + 1)];
  }
  title = title.replace(/^["“'‘]+|["”'’]+$/g, '').trim();
  author = author.replace(/[\s\-–—|,;:]+$/, '').trim();
  if (title.length < 2) return null;
  return { title, author, rating: Math.max(0, Math.min(5, rating || 0)) };
}

/** Rated → a rating (shapes recommendations); not rated → "already read". Returns counts. */
function take(items) {
  let rated = 0;
  let read = 0;
  for (const it of items) {
    const mine = myRatings.get()[rateKey(it)];
    if (mine?.verdict && !mine.imported) continue; // rated in the app already: yours wins
    if (it.rating > 0) {
      rateBook({ title: it.title, author: it.author }, { verdict: verdictFor(it.rating), stars: it.rating, imported: true });
      rated++;
    } else {
      markAlreadyRead({ title: it.title, author: it.author });
      read++;
    }
  }
  return { rated, read, total: rated + read };
}

/** A list pasted from your notes, one book a line. */
export function importReadList(text) {
  const items = String(text || '')
    .split(/\r?\n/)
    .map(parseLine)
    .filter(Boolean);
  return take(items);
}

/** Your Goodreads export's Read shelf (with your stars) → the same. */
export function takeGoodreadsReads(books = []) {
  return take(books.filter((b) => b.shelf === 'read').map((b) => ({ title: b.title, author: b.author, rating: +b.rating || 0 })));
}

/** Books you've read or rated outside the app, as cards for Library → Finished (newest first). */
export function readElsewhere() {
  const inApp = new Set(Object.values(progress.get() || {}).map((p) => p?.book && rateKey(p.book)));
  const seen = new Set();
  const out = [];
  const add = (k, r, at) => {
    if (!r?.title || seen.has(k) || inApp.has(k)) return;
    seen.add(k);
    out.push({ uid: 'gr:' + k, source: 'gr', kind: 'discover', title: mainTitle(r.title), author: r.author || '', at: at || 0, readElsewhere: true });
  };
  for (const [k, r] of Object.entries(myRatings.get() || {})) if (r?.verdict && r.verdict !== 'dnf') add(k, r, r.updatedAt);
  for (const [k, r] of Object.entries(alreadyRead.get() || {})) add(k, r, r.at);
  return out.sort((a, b) => b.at - a.at);
}
