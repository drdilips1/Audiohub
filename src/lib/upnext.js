// Up next: books (and saved passages) to listen to after this one, across all your sources.
// Each book keeps its own place; a passage plays from its moment. When a book ends, the
// next one starts by itself (Settings → Playback can turn that off).
import { persisted, settings, summarize } from './store.js';
import * as player from './player.js';
import { toast } from '../components/common.jsx';

// [{ id, book (summary), at?: seconds into the book (a passage), label?, addedAt }]
export const upNext = persisted('upNext', []);
let planSlice = 0; // seconds each passage of a plan plays
let sliceTimer = null;

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
    // A plan of passages: each gets its share of the time, then the next one.
    clearTimeout(sliceTimer);
    if (item.at != null && planSlice > 0 && upNext.get().some((x) => x.at != null)) {
      const uid = item.book.uid;
      sliceTimer = setTimeout(() => {
        if (player.getState().book?.uid === uid && player.getState().playing) playUpNext(upNext.get().find((x) => x.at != null));
      }, planSlice * 1000);
    }
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

// ---- Listening plans: 10 / 30 / 60 minutes, made from what you have ----------------------
// 10 min: a few of your saved passages (bookmarks, highlighted lines) from different books.
// 30 min: the book you were last listening to. 60 min: that book, then your next unfinished one.
// A sleep timer ends it on time. No streaks, no reminders.
export async function startPlan(minutes) {
  const { progress, bookmarks, library } = await import('./store.js');
  const prog = progress.get();
  const unfinished = Object.entries(prog)
    .filter(([uid, p]) => p?.book && !p.finished && !p.hidden && p.kind !== 'text' && p.book.kind !== 'text' && p.book.source !== 'pod' && !/^(lbl?|sum):/.test(uid))
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .map(([, p]) => p.book);
  const items = [];
  if (minutes <= 10) {
    const marks = Object.entries(bookmarks.get())
      .flatMap(([uid, list]) => (list || []).map((bm) => ({ uid, bm })))
      .filter((x) => x.bm.label && x.bm.label.length > 12)
      .sort(() => Math.random() - 0.5);
    const used = new Set();
    for (const { uid, bm } of marks) {
      if (items.length >= 3 || used.has(uid)) continue;
      const book = prog[uid]?.book || library.get()[uid];
      if (!book) continue;
      used.add(uid);
      items.push({ book, at: bm.global ?? bm.time, label: bm.label });
    }
  }
  if (!items.length) {
    if (unfinished[0]) items.push({ book: unfinished[0] });
    if (minutes >= 60 && unfinished[1]) items.push({ book: unfinished[1] });
  }
  if (!items.length) {
    toast('Nothing to plan from yet — start a book or save a few bookmarks first');
    return false;
  }
  // The plan goes first in Up next (anything already there waits after it).
  upNext.set((l) => {
    const ids = new Set();
    const planned = items
      .map((x) => ({ id: idOf(x.book, x.at ?? null), book: summarize(x.book), ...(x.at != null ? { at: x.at, label: x.label } : {}), addedAt: Date.now() }))
      .filter((x) => !ids.has(x.id) && ids.add(x.id));
    return [...planned, ...l.filter((x) => !ids.has(x.id))];
  });
  planSlice = items.some((x) => x.at != null) ? Math.floor((minutes * 60) / items.length) : 0;
  const ok = await playUpNext();
  if (ok) {
    player.setSleep(minutes);
    toast(`${minutes}-minute plan: ${items.length > 1 ? `${items.length} pieces` : items[0].book.title} · stops by itself`);
  }
  return ok;
}
