// Playback history: every play, pause, skip, seek, chapter jump and sleep-timer stop,
// with the time it happened and where in the book you were — so after falling asleep or
// an accidental skip you can see where you really were and go back in one tap.
// Kept per book (the last 300 events of the last 40 books).
import { persisted } from './store.js';
import * as player from './player.js';

export const playHistory = persisted('playHistory', {}); // uid -> [{ t, type, g, to?, ch }]

const MAX_EVENTS = 300;
const MAX_BOOKS = 40;

function chapterAt(g) {
  const list = player.chapters();
  const c = list.find((x) => g >= x.start && g < (x.end || Infinity)) || list[list.length - 1];
  return c?.title || '';
}

/** Note one event for the book playing. `g`: where in the book (seconds); `to`: where it went. */
export function note(type, g = player.globalTime(), to) {
  const s = player.getState();
  const uid = s.book?.uid;
  if (!uid || !isFinite(g)) return;
  const e = { t: Date.now(), type, g: Math.round(g), ...(to != null && isFinite(to) ? { to: Math.round(to) } : {}), ch: chapterAt(g).slice(0, 80) };
  playHistory.set((all) => {
    const list = all[uid] || [];
    const last = list[list.length - 1];
    // A burst of the same thing (tapping +30 four times): one entry, from the first spot.
    if (last && last.type === type && type !== 'play' && type !== 'pause' && e.t - last.t < 4000) {
      const merged = { ...last, t: e.t, to: e.to ?? last.to, n: (last.n || 1) + 1 };
      return { ...all, [uid]: [...list.slice(0, -1), merged] };
    }
    const next = { ...all, [uid]: [...list, e].slice(-MAX_EVENTS) };
    const books = Object.keys(next);
    if (books.length > MAX_BOOKS) {
      books
        .sort((a, b) => (next[a].at(-1)?.t || 0) - (next[b].at(-1)?.t || 0))
        .slice(0, books.length - MAX_BOOKS)
        .forEach((k) => delete next[k]);
    }
    return next;
  });
}

// Play and pause, however they happen (the screen, headphones, the notification, a call).
let was = { uid: '', playing: false };
let sleptAt = 0;
player.subscribe((s) => {
  const uid = s.book?.uid || '';
  if (uid !== was.uid) {
    was = { uid, playing: !!s.playing };
    return;
  }
  if (s.loading) return; // buffering isn't a pause
  if (!!s.playing !== was.playing) {
    was.playing = !!s.playing;
    if (!s.playing && Date.now() - sleptAt < 6000) return; // already noted as the sleep timer
    note(s.playing ? 'play' : 'pause');
  }
});
player.setHistoryHook((type, g, to) => {
  if (type === 'sleep') sleptAt = Date.now();
  note(type, g, to);
});

export function clearHistory(uid) {
  playHistory.set((all) => {
    const next = { ...all };
    delete next[uid];
    return next;
  });
}
