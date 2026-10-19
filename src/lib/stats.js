// Listening log for the Stats screen: time listened per day, per hour of the day and
// per book. Counted while audio is actually playing (wall-clock time), plus how much
// of the book that covered at your speed. Kept on the device; starts when first used.
import { persisted, progress } from './store.js';

// days: { 'YYYY-MM-DD': { s: seconds listened, c: book-seconds covered, h: [24 × seconds], b: { uid: seconds } } }
// books: { uid: { title, author, cover, source } } — enough to show the top books
export const listenLog = persisted('listenLog', { since: 0, days: {}, books: {} });

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let last = 0; // time of the previous tick while playing
let lastPos = 0; // book position (s) at that tick
let lastUid = '';
let buf = null; // listening not yet written: { day, hour, uid, s, c, book }
let flushTimer = null;

/**
 * Called on every position update. Counts how far playback moved since the last update,
 * at your speed — so time with the screen off (when updates pause) still counts, while
 * a jump (seek, chapter tap) doesn't.
 */
export function tick(playing, rate = 1, book = null, pos = 0) {
  const now = Date.now();
  if (!playing || !book?.uid) {
    last = 0;
    return flush();
  }
  const wall = last && lastUid === book.uid ? (now - last) / 1000 : 0;
  const moved = pos - lastPos;
  last = now;
  lastPos = pos;
  lastUid = book.uid;
  if (wall <= 0) return;
  const r = rate || 1;
  let dt = 0;
  if (moved > 0 && moved <= wall * r * 1.2 + 3) dt = moved / r; // played through
  else if (wall <= 5) dt = wall; // short gap where the position didn't move as expected (e.g. track change)
  if (dt <= 0) return;
  const d = new Date(now);
  const day = dayKey(d);
  const hour = d.getHours();
  if (buf && (buf.day !== day || buf.hour !== hour || buf.uid !== book.uid)) flush();
  if (!buf) buf = { day, hour, uid: book.uid, s: 0, c: 0, book };
  buf.s += dt;
  buf.c += dt * r;
  if (!flushTimer) flushTimer = setTimeout(flush, 15000);
}

export function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  const b = buf;
  buf = null;
  if (!b || b.s < 0.5) return;
  listenLog.set((log) => {
    const days = { ...log.days };
    const cur = days[b.day] || { s: 0, c: 0, h: Array(24).fill(0), b: {} };
    const h = [...(cur.h || Array(24).fill(0))];
    h[b.hour] += b.s;
    days[b.day] = { s: cur.s + b.s, c: (cur.c || 0) + b.c, h, b: { ...cur.b, [b.uid]: (cur.b?.[b.uid] || 0) + b.s } };
    const { title, author, cover, source } = b.book;
    return { since: log.since || Date.now(), days, books: { ...log.books, [b.uid]: { title, author, cover, source } } };
  });
}
document.addEventListener('visibilitychange', () => document.hidden && flush());

const DAY = 864e5;
const keysBack = (n) => Array.from({ length: n }, (_, i) => dayKey(new Date(Date.now() - (n - 1 - i) * DAY)));

/** Everything the Stats screen shows, worked out from the log and your progress. */
export function summary() {
  const { days, books, since } = listenLog.get();
  const sum = (keys) => keys.reduce((a, k) => a + (days[k]?.s || 0), 0);
  const today = dayKey();
  const week = keysBack(7);
  const month = keysBack(30);
  const all = Object.keys(days).sort();
  const total = sum(all);
  const covered = all.reduce((a, k) => a + (days[k].c || days[k].s), 0);

  // Streaks: days with at least 5 minutes.
  const active = new Set(all.filter((k) => days[k].s >= 300));
  let streak = 0;
  for (let i = active.has(today) ? 0 : 1; active.has(dayKey(new Date(Date.now() - i * DAY))); i++) streak++;
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of [...active].sort()) {
    const t = Date.parse(k + 'T12:00:00');
    run = prev != null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }

  const hours = Array(24).fill(0);
  const weekdays = Array(7).fill(0); // Monday first
  const perBook = {};
  for (const k of all) {
    const d = days[k];
    (d.h || []).forEach((s, i) => (hours[i] += s));
    weekdays[(new Date(k + 'T12:00:00').getDay() + 6) % 7] += d.s;
    for (const [uid, s] of Object.entries(d.b || {})) perBook[uid] = (perBook[uid] || 0) + s;
  }
  const topBooks = Object.entries(perBook)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([uid, s]) => ({ book: { uid, ...books[uid] }, s }));
  const perAuthor = {};
  for (const [uid, s] of Object.entries(perBook)) {
    const a = String(books[uid]?.author || '').split(',')[0].trim();
    if (a) perAuthor[a] = (perAuthor[a] || 0) + s;
  }
  const topAuthors = Object.entries(perAuthor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Finished books come from your progress (it has them from before the log began too).
  const prog = Object.values(progress.get() || {}).filter((p) => p?.book);
  const finished = prog.filter((p) => p.finished).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const year = new Date().getFullYear();

  return {
    since,
    today: days[today]?.s || 0,
    week: sum(week),
    month: sum(month),
    total,
    saved: Math.max(0, covered - total), // time saved by listening faster than 1×
    avgSpeed: total ? covered / total : 1,
    streak,
    best: Math.max(best, streak),
    activeDays: active.size,
    last30: month.map((k) => ({ day: k, s: days[k]?.s || 0 })),
    hours,
    weekdays,
    topBooks,
    topAuthors,
    finished: finished.slice(0, 12).map((p) => ({ book: p.book, at: p.updatedAt })),
    finishedThisYear: finished.filter((p) => new Date(p.updatedAt || 0).getFullYear() === year).length,
    finishedAll: finished.length,
    started: prog.length,
    coveredAll: prog.reduce((a, p) => a + (p.global || 0), 0), // from progress, all time
  };
}
