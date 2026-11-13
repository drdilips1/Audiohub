// Edition check: your copies of one book side by side — narrator, length, format — compared
// with the full audiobook's length (Audible), so an abridged or incomplete copy shows, and the
// copy you choose plays first.
import { persisted } from './store.js';
import { mainTitle, words, surname } from './match.js';

// work key (title + author's surname) -> the copy that plays first ({ uid, source, kind, title, author })
export const preferredCopy = persisted('preferredCopy', {});
export const workKey = (b) => `${words(mainTitle(b?.title || '')).join(' ')}|${surname(b?.author || '') || ''}`;
export const preferredFor = (b) => preferredCopy.get()[workKey(b)] || null;
export function setPreferred(b, copy) {
  const { uid, source, kind, title, author } = copy;
  preferredCopy.set((m) => ({ ...m, [workKey(b)]: { uid, source, kind, title, author } }));
}

/** A copy's length in seconds, when known (its own, or all its parts' lengths). */
export function lengthOf(c) {
  if (Number(c?.duration) > 0) return Number(c.duration);
  const t = c?.tracks || [];
  if (t.length && t.every((x) => Number(x.duration) > 0)) return t.reduce((s, x) => s + Number(x.duration), 0);
  return 0;
}

/**
 * How a copy compares with the full audiobook: { ratio, tag } — tag 'full' | 'abridged' |
 * 'incomplete' | '' (unknown) — plus otherNarrator when its narrator isn't the full one's.
 */
export function judge(copy, full) {
  const len = lengthOf(copy);
  const out = { len, ratio: 0, tag: '', otherNarrator: false };
  if (full?.runtime > 0 && len > 0) {
    out.ratio = len / full.runtime;
    out.tag = out.ratio >= 0.9 ? 'full' : out.ratio <= 0.65 ? 'abridged' : 'incomplete';
  }
  const a = surname(copy?.narrator || '');
  const b = surname(full?.narrator || '');
  out.otherNarrator = !!(a && b && a !== b);
  return out;
}
