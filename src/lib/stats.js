// Listening log for the Stats screen: time listened per day, per hour of the day and
// per book. Counted while audio is actually playing (wall-clock time), plus how much
// of the book that covered at your speed. Kept on the device; starts when first used.
import { persisted, progress } from './store.js';

// days: { 'YYYY-MM-DD': { s: seconds listened, c: book-seconds covered, h: [24 × seconds], b: { uid: seconds } } }
// books: { uid: { title, author, cover, source } } — enough to show the top books
export const listenLog = persisted('listenLog', { since: 0, days: {}, books: {} });
// The same for ebooks: time spent reading (the reader open and in use, or reading aloud).
export const readLog = persisted('readLog', { since: 0, days: {}, books: {} });

/** Reading time: `secs` more of reading `book` (called from the reader while you read). */
export function readTick(book, secs) {
  if (!book?.uid || !(secs > 0)) return;
  const d = new Date();
  const day = dayKey(d);
  const hour = d.getHours();
  readLog.set((log) => {
    const days = { ...log.days };
    const cur = days[day] || { s: 0, c: 0, h: Array(24).fill(0), b: {} };
    const h = [...(cur.h || Array(24).fill(0))];
    h[hour] += secs;
    days[day] = { s: cur.s + secs, c: (cur.c || 0) + secs, h, b: { ...cur.b, [book.uid]: (cur.b?.[book.uid] || 0) + secs } };
    const { title, author, cover, source } = book;
    return { since: log.since || Date.now(), days, books: { ...log.books, [book.uid]: { title, author, cover, source } } };
  });
}

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
export function summary(kind = 'listen') {
  const reading = kind === 'read';
  const { days, books, since } = (reading ? readLog : listenLog).get();
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
  // Finished books come from your progress (it has them from before the log began too).
  // Ebooks (kind 'text') for reading stats, everything else for listening.
  const progAll = progress.get() || {};
  const prog = Object.values(progAll).filter((p) => p?.book && (p.kind === 'text' || p.book.kind === 'text') === reading);
  // Listening from before the log began (or on another device / app, synced in) is only in
  // your places in the books: a book counts at least as far as you've got into it — the same
  // as the Library's "hours listened".
  const meta = { ...books };
  if (!reading)
    for (const [uid, p] of Object.entries(progAll)) {
      if (!p?.book || p.kind === 'text' || p.book.kind === 'text' || !(p.global > 0)) continue;
      if (p.global > (perBook[uid] || 0)) perBook[uid] = p.global;
      if (!meta[uid]) meta[uid] = { title: p.book.title, author: p.book.author, cover: p.book.cover, source: p.book.source };
    }
  const allTime = Math.max(total, Object.values(perBook).reduce((a, x) => a + x, 0));
  const topBooks = Object.entries(perBook)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([uid, s]) => ({ book: { uid, ...meta[uid] }, s }));
  const perAuthor = {};
  for (const [uid, s] of Object.entries(perBook)) {
    const a = String(meta[uid]?.author || '').split(',')[0].trim();
    if (a) perAuthor[a] = (perAuthor[a] || 0) + s;
  }
  const topAuthors = Object.entries(perAuthor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const finished = prog.filter((p) => p.finished).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const year = new Date().getFullYear();

  return {
    since,
    today: days[today]?.s || 0,
    week: sum(week),
    month: sum(month),
    total,
    allTime, // logged, or your places in the books where they're further (all time)
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

/** Hours listened, all time: as far as you've got into each book, or what the log counted where more. */
export const hoursListened = () => summary('listen').allTime;

/**
 * When a book was started and, from how you've been listening to it lately, about when
 * you'll finish: { started (ms), days (to go) } — either may be missing.
 */
export function finishGuess(uid) {
  const p = progress.get()[uid];
  if (!p || p.finished || p.kind === 'text') return null;
  const { days } = listenLog.get();
  const keys = Object.keys(days).filter((k) => days[k].b?.[uid] > 0).sort();
  const first = keys.length ? Date.parse(keys[0] + 'T12:00:00') : 0;
  // The log's first day for it only says when you started if the log was already running then.
  const since = listenLog.get().since || 0;
  const started = p.startedAt || (first && first > since + DAY ? first : 0);
  if (!started && !first) return null;
  // Pace: book time covered over the last 3 weeks, spread over the days since then (or
  // since you started it, if later). Needs a little listening to say anything.
  const from = Math.max(started || first, Date.now() - 21 * DAY);
  let covered = 0;
  for (const k of keys) {
    if (Date.parse(k + 'T23:59:59') < from) continue;
    const d = days[k];
    covered += d.b[uid] * (d.s > 0 ? (d.c || d.s) / d.s : 1);
  }
  const span = Math.max(1, (Date.now() - from) / DAY);
  const pace = covered / span; // book-seconds a day
  const left = (p.total || 0) - (p.global || 0);
  const out = started ? { started } : {};
  if (pace >= 300 && left > 0 && covered >= 1800) out.days = Math.max(1, Math.round(left / pace));
  return out;
}

/** "Started 5 days ago · likely to finish in about 8 days" (or part of it). */
export function finishLine(uid) {
  const g = finishGuess(uid);
  if (!g || (!g.started && !g.days)) return '';
  const ago = Math.floor((Date.now() - g.started) / DAY);
  const a = !g.started ? '' : ago <= 0 ? 'Started today' : ago === 1 ? 'Started yesterday' : `Started ${ago} days ago`;
  if (!g.days) return a;
  const f = g.days === 1 ? 'likely to finish tomorrow' : g.days <= 60 ? `likely to finish in about ${g.days} days` : `likely to finish in about ${Math.round(g.days / 30)} months`;
  return a ? `${a} · ${f}` : f[0].toUpperCase() + f.slice(1);
}
