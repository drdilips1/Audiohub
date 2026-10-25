// Where to look for your copy of a book, and in what order — one order for audiobooks
// ("Play a scene") and one for ebooks (the transcript's ebook). Changed in Settings.
import { settings } from './store.js';

export const PLACES = {
  debrid: 'TorBox / Real-Debrid',
  local: 'This phone',
  sources: 'Sources',
  abs: 'Audiobookshelf',
  played: 'Books you’ve played',
};
export const DEFAULT_ORDER = {
  audio: ['debrid', 'local', 'abs', 'played'],
  ebook: ['local', 'sources', 'debrid', 'abs'],
};

/** The order for 'audio' or 'ebook': your own, with any new places added at the end. */
export function findOrder(kind) {
  const def = DEFAULT_ORDER[kind];
  const mine = (settings.get().findOrder || {})[kind];
  if (!Array.isArray(mine)) return def;
  const known = mine.filter((k) => def.includes(k));
  return [...known, ...def.filter((k) => !known.includes(k))];
}
export const setFindOrder = (kind, list) => settings.patch({ findOrder: { ...(settings.get().findOrder || {}), [kind]: list } });

/** Which place a book (audiobook copy) is in. */
export function placeOf(b, local = false) {
  if (local) return 'local';
  const k = String(b?.source || b?.uid || '').split(':')[0];
  return k === 'tb' || k === 'rd' ? 'debrid' : k === 'loc' ? 'local' : k === 'abs' ? 'abs' : 'played';
}

/** Ebook auto-attach for the transcript (on unless switched off). */
export const autoEbook = () => settings.get().autoEbook !== false;
