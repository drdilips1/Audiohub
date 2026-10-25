// One book, every copy: the same title from different places (phone, download,
// Audiobookshelf, TorBox / Real-Debrid…) counts as one book — listed once, with one
// place to continue from.
import { progress } from './store.js';
import { words, mainTitle } from './match.js';
import { downloads } from './downloads.js';

const surname = (a) => words(String(a || '').split(/,|&|\band\b/)[0]).slice(-1)[0] || '';
const titleKey = (b) => words(mainTitle(b?.title || '')).join(' ');
/** Same book? Same title, and the same author when both are known. */
export const sameWork = (a, b) => {
  if (!a || !b) return false;
  const t = titleKey(a);
  if (!t || t !== titleKey(b)) return false;
  const x = surname(a.author);
  const y = surname(b.author);
  return !x || !y || x === y;
};

// Which copy to open when there are several: the one you last used, else the most
// reliable (on the phone, downloaded, your server, your cloud, then the rest).
const RANK = { loc: 0, abs: 1, tb: 2, rd: 2 };
const rankOf = (b) => (downloads.get()[b.uid]?.status === 'done' ? 0.5 : RANK[b.source] ?? 3);
export function preferred(copies) {
  const prog = progress.get();
  return [...copies].sort((a, b) => (prog[b.uid]?.updatedAt || 0) - (prog[a.uid]?.updatedAt || 0) || rankOf(a) - rankOf(b))[0];
}

/** A list with each book once (its preferred copy, marked with how many copies you have). */
export function oneEach(list) {
  const groups = new Map();
  for (const b of list) {
    const t = titleKey(b);
    if (!t) {
      groups.set(b.uid, [b]);
      continue;
    }
    // Same title: join the group whose author fits (or start one).
    let key = null;
    for (const [k, g] of groups) if (k.startsWith(t + '|') && sameWork(g[0], b)) key = k;
    if (!key) key = `${t}|${surname(b.author)}|${groups.size}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  return [...groups.values()].map((g) => (g.length > 1 ? { ...preferred(g), copies: g.length } : g[0]));
}

/** Where you stopped in another copy of this book (audio), to continue from there. */
export function otherCopyProgress(book) {
  if (!book || book.kind === 'text') return null;
  let best = null;
  for (const [uid, p] of Object.entries(progress.get())) {
    if (uid === book.uid || !p?.book || p.kind === 'text' || p.finished || !(p.global > 30)) continue;
    if (sameWork(p.book, book) && (!best || p.updatedAt > best.updatedAt)) best = p;
  }
  return best;
}
