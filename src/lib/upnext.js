// Up next: books (and saved passages) to listen to after this one, across all your sources.
// Each book keeps its own place; a passage plays from its moment. When a book ends, the
// next one starts by itself (Settings → Playback can turn that off).
import { persisted, settings, summarize } from './store.js';
import * as player from './player.js';
import { toast } from '../components/common.jsx';

// [{ id, book (summary), at?: seconds into the book (a passage), label?, addedAt }]
export const upNext = persisted('upNext', []);

const idOf = (book, at) => `${book.uid}${at != null ? `@${Math.round(at)}` : ''}`;

export function addUpNext(book, { at = null, label = '' } = {}) {
  if (!book?.uid) return false;
  const id = idOf(book, at);
  if (upNext.get().some((x) => x.id === id)) return false;
  upNext.set((l) => [...l, { id, book: summarize(book), ...(at != null ? { at, label } : {}), addedAt: Date.now() }]);
  return true;
}
export const removeUpNext = (id) => upNext.set((l) => l.filter((x) => x.id !== id));
export function moveUpNext(id, dir) {
  upNext.set((l) => {
    const i = l.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= l.length) return l;
    const next = [...l];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}
export const isUpNext = (book) => !!book?.uid && upNext.get().some((x) => x.book.uid === book.uid);

/** Play an item of the queue (taken off it). A source that's gone moves on to the next one. */
export async function playUpNext(item = upNext.get()[0]) {
  if (!item) return false;
  removeUpNext(item.id);
  const { getDetails } = await import('../sources/index.js');
  const { nav } = await import('./nav.js');
  try {
    nav.openOverlay('player');
    await player.openAndPlay(item.book, getDetails, item.at != null ? { globalStart: Math.max(0, item.at - player.BOOKMARK_LEAD) } : undefined);
    if (player.getState().error) throw new Error(player.getState().error);
    toast(`▶ Up next: ${item.book.title}`);
    return true;
  } catch (e) {
    toast(`Couldn't play ${item.book.title} (${e.message}) — trying the next one`);
    return upNext.get().length ? playUpNext() : false;
  }
}

// A book finished: the next one in the queue starts by itself.
player.onFinished((book) => {
  if (settings.get().upNextAuto === false || !upNext.get().length) return;
  if (book?.source === 'pod') return; // podcasts have their own queue
  setTimeout(() => playUpNext(), 1500);
});
