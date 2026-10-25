// Global audiobook player: multi-track books, chapters, speed, sleep timer,
// bookmarks, progress persistence and system media controls. Audio output is
// delegated to an engine (native Media3 on Android, <audio> on the web).
import * as stats from './stats.js';
import { createEngine } from './engine.js';
import { progress, bookmarks, settings, summarize, persisted } from './store.js';
import { syncProgress, switchTracks } from '../sources/audiobookshelf.js';
import { fetchStatus } from '../sources/debrid.js';
import { applyLocal, isDownloaded, downloads } from './downloads.js';
import { otherCopyProgress } from './works.js';

// ---- safety net: a part that won't play --------------------------------------
// First a fresh link and one more try; then another copy of the same book you
// have (downloaded, on the phone, Audiobookshelf, TorBox / Real-Debrid), at the
// same point in the book.
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let rescue = { key: '', step: 0 };
const rescueTried = new Set(); // copies already tried for this listen
async function otherCopy(b) {
  const { localSrc, findOwned } = await import('../sources/index.js');
  const { matches, mainTitle } = await import('./match.js');
  const t = mainTitle(b.title || '');
  if (!t) return null;
  const same = (x) => x && x.uid !== b.uid && !rescueTried.has(x.uid) && x.kind !== 'text' && matches(t, `${x.title || ''} ${x.rawName || ''}`);
  const o = await findOwned(b).catch(() => null);
  // Real-Debrid failing: your TorBox copy is the closest match (same files), so it goes first.
  const tb = b.source === 'rd' ? o?.cloud?.find((x) => x.source === 'tb' && same(x)) : null;
  if (tb) return { book: tb, label: 'your TorBox' };
  const dl = Object.values(downloads.get()).find((d) => d?.status === 'done' && same(d.book));
  if (dl) return { book: dl.book, label: 'your downloaded copy' };
  const ph = (localSrc.localCfg.get().books || []).find(same);
  if (ph) return { book: ph, label: 'the copy on this phone' };
  const s = o?.server?.find(same);
  if (s) return { book: s, label: 'your Audiobookshelf' };
  const c = o?.cloud?.find(same);
  if (c) return { book: c, label: c.source === 'rd' ? 'your Real-Debrid' : 'your TorBox' };
  return null;
}
/** Returns true when it took over (retrying or switching copies). */
async function recover(msg = '') {
  const b = state.book;
  if (!b || b.source === 'pod') return false;
  const key = `${b.uid}#${state.index}`;
  if (rescue.key !== key) rescue = { key, step: 0 };
  const t = state.tracks[state.index];
  const at = state.time || loadingAt?.at || 0;
  // Real-Debrid saying its file server is down (503 hoster_unavailable…): another try won't
  // help, go straight to TorBox.
  const rdDown = b.source === 'rd' && /\b5\d\d\b|hoster|unavailable|not available|infringing|too many/i.test(String(msg));
  if (rescue.step === 0 && t?.resolve && !b.offline && !rdDown) {
    rescue.step = 1;
    set({ loading: true, error: null, phase: 'Reconnecting…' });
    await delay(1500);
    t.url = null;
    loadTrack(state.index, at);
    return true;
  }
  if (rescue.step <= 1) {
    rescue.step = 2;
    rescueTried.add(b.uid);
    const g = globalTime();
    // A Real-Debrid book: your Audiobookshelf copy first (checked like "Already on your
    // Audiobookshelf"), then the same torrent from TorBox (instant when TorBox has it).
    if (b.source === 'rd') {
      try {
        const { absSrc, getDetails } = await import('../sources/index.js');
        const qb = await import('../sources/qbit.js');
        const hit = absSrc.connected() ? await qb.onServer({ title: b.title, author: b.author || '' }) : null;
        if (hit && !rescueTried.has(hit.uid)) {
          set({ loading: true, error: null, phase: 'Real-Debrid can’t serve this right now — playing it from your Audiobookshelf…' });
          const d = await getDetails(hit);
          rescuing = true;
          await playBook(d, { globalStart: g });
          return true;
        }
      } catch {
        rescuing = false;
      }
    }
    if (b.source === 'rd' && b.hash) {
      try {
        const { cloud, getDetails } = await import('../sources/index.js');
        if (cloud.tbConnected()) {
          set({ loading: true, error: null, phase: 'Real-Debrid can’t serve this right now — playing it from TorBox…' });
          const stub = await cloud.prepareMagnet('torbox', { hash: b.hash, title: b.title });
          const d = await getDetails({ ...stub, title: b.title, author: b.author, cover: b.cover });
          rescuing = true;
          await playBook(d, { globalStart: g });
          return true;
        }
      } catch {
        rescuing = false;
      }
    }
    const alt = await otherCopy(b).catch(() => null);
    if (alt) {
      set({ loading: true, error: null, phase: `This copy won't play — switching to ${alt.label}…` });
      try {
        const { getDetails } = await import('../sources/index.js');
        const d = await getDetails(alt.book);
        rescuing = true;
        await playBook(d, { globalStart: g });
        return true;
      } catch {
        rescuing = false;
      }
    }
  }
  return false;
}
let rescuing = false;

const state = {
  book: null,
  tracks: [],
  index: 0,
  playing: false,
  loading: false,
  time: 0,
  duration: 0,
  rate: settings.get().speed || 1,
  error: null,
  phase: '', // what's happening while loading: shown in the player
  interrupted: false, // paused by a phone call / another app using audio
  preparing: null, // { provider, progress (0..1), state } while TorBox / Real-Debrid is still downloading
  sleepUntil: null, // timestamp
  sleepEndOfTrack: false,
};

const subs = new Set();
let emitQueued = false;
function emit() {
  if (emitQueued) return;
  emitQueued = true;
  requestAnimationFrame(() => {
    emitQueued = false;
    const snap = { ...state };
    subs.forEach((f) => f(snap));
  });
}
// Called when a book (or podcast episode) plays to the very end.
const finishedSubs = new Set();
export const onFinished = (f) => (finishedSubs.add(f), () => finishedSubs.delete(f));
export const subscribe = (f) => (subs.add(f), f({ ...state }), () => subs.delete(f));
export const getState = () => ({ ...state });

function set(p) {
  Object.assign(state, p);
  emit();
}

// --- engine -----------------------------------------------------------------
const handlers = {
  time(pos, dur) {
    // A new link reports 0 until it has jumped to the resume point: don't lose the spot.
    if (loadingAt && loadingAt.at > 1 && pos < 0.5) return;
    const t = state.tracks[state.index];
    if (t && dur > 0) t.duration = dur;
    set({ time: pos, duration: dur || state.duration });
    saveProgress();
    stats.tick(state.playing, state.rate, state.book, globalTime());
    // The show's outro: treat it as the end of the episode.
    const o = showPrefsFor(state.book)?.outro || 0;
    if (o > 0 && dur > o * 2 && pos >= dur - o && !outroAt) {
      outroAt = pos;
      engine.pause();
      handlers.ended();
    }
    if (state.sleepUntil && Date.now() >= state.sleepUntil) fadeOutAndPause();
    // "End of chapter" inside one long file (an M4B with chapter marks): stop at the mark.
    if (state.sleepChapterEnd && globalTime() >= state.sleepChapterEnd - 0.3) {
      set({ sleepChapterEnd: null, sleepEndOfTrack: false });
      fadeOutAndPause();
    }
  },
  playing(on) {
    if (on) loadingAt = null;
    set({ playing: on, ...(on ? { loading: false, error: null, phase: '', interrupted: false } : {}) });
    if (on) clearTimeout(resumeTimer), clearTimeout(stallTimer), (stallTimer = null);
    if (!on) saveProgress(true), stats.tick(false);
  },
  waiting() {
    if (!state.loading) set({ loading: true, phase: 'Buffering…' });
    // Stuck buffering on your server (e.g. you left home Wi‑Fi): try its other address.
    // (Android reports buffering many times a second: start the clock once.)
    if (isAbs(state.book) && !stallTimer)
      stallTimer = setTimeout(() => {
        stallTimer = null;
        if (state.loading && !state.error) trySwitch();
      }, 12000);
  },
  ready() {
    clearTimeout(stallTimer);
    stallTimer = null;
    if (state.loading) set({ loading: false, phase: '' });
  },
  interrupted(on) {
    if (on) set({ playing: false, loading: false, phase: '', interrupted: true });
    else set({ interrupted: false });
  },
  // The phone's player moved on to a queued part by itself.
  advanced(item) {
    const i = queueBase + item;
    if (!state.tracks[i] || i === state.index) return;
    loadingAt = null;
    set({ index: i, time: 0, duration: state.tracks[i].duration || 0 });
    saveProgress(true);
    queueAhead(loadToken);
  },
  ended() {
    if (state.sleepEndOfTrack) {
      set({ sleepEndOfTrack: false, playing: false });
      saveProgress(true);
      return;
    }
    if (state.index < state.tracks.length - 1) loadTrack(state.index + 1, 0);
    else {
      set({ playing: false });
      saveProgress(true);
      finishedSubs.forEach((f) => f(state.book));
    }
  },
  error: async (msg) => {
    clearTimeout(stallTimer);
    stallTimer = null;
    const token = loadToken;
    if (isAbs(state.book) && (await trySwitch())) return;
    if (token !== loadToken) return; // something else started loading meanwhile
    if (await recover(msg)) return;
    if (token !== loadToken) return;
    set({ loading: false, playing: false, phase: '', error: msg });
    checkCloud(state.index, state.time, msg);
  },
  remote(action) {
    const s = settings.get();
    if (action === 'next') skip(s.skipForward || 30);
    else if (action === 'previous') skip(-(s.skipBack || 15));
  },
};
const engine = createEngine(handlers);

// Skip silence and volume boost (Settings, per listener; Android only).
// Each audiobook remembers its own speed and volume boost (uid -> { speed, boost });
// a new book starts with the last ones you used.
export const bookPrefs = persisted('bookPrefs', {});
const prefOf = (b) => (b?.uid && b.source !== 'pod' ? bookPrefs.get()[b.uid] : null) || {};
function savePref(patch) {
  const uid = state.book?.uid;
  if (!uid || state.book.source === 'pod') return;
  bookPrefs.set((all) => {
    const keys = Object.keys(all);
    const next = keys.length > 400 ? Object.fromEntries(keys.slice(-300).map((k) => [k, all[k]])) : { ...all };
    next[uid] = { ...(all[uid] || {}), ...patch };
    return next;
  });
}

export function applyAudio() {
  const s = settings.get();
  const boost = prefOf(state.book).boost;
  engine.setSkipSilence?.(!!s.skipSilence)?.catch?.(() => {});
  engine.setBoost?.(boost ?? s.boost ?? 0)?.catch?.(() => {});
}
applyAudio();
export function setAudio(patch) {
  settings.patch(patch);
  if ('boost' in patch) savePref({ boost: patch.boost });
  applyAudio();
}

// Per-show podcast settings: own speed, skip the intro / the outro.
let showPrefsFor = () => null;
let showPrefsSave = null;
export const setShowPrefsSource = (get, save) => ((showPrefsFor = get), (showPrefsSave = save));
let outroAt = 0; // seconds into the episode where its outro starts (0 = none)

// --- Audiobookshelf: carry on from the same second on the server's other address ---
const isAbs = (b) => (b?.uid || '').startsWith('abs:');
let stallTimer = null;
let lastSwitch = 0;
let switching = null;
let loadingAt = null; // { index, at } from starting a part until it plays
function trySwitch() {
  if (switching) return switching; // the error and the failed start both ask: switch once
  if (Date.now() - lastSwitch < 20000) return Promise.resolve(false); // don't bounce between addresses
  lastSwitch = Date.now();
  const book = state.book;
  const i = loadingAt?.index ?? state.index;
  const at = loadingAt?.at ?? state.time;
  switching = switchTracks(state.tracks)
    .catch(() => '')
    .then((moved) => {
      if (!moved || state.book !== book) return false;
      set({ error: null, phase: 'Switching to ' + moved.replace(/^https?:\/\//, '') + '…' });
      loadTrack(i, at, true);
      return true;
    })
    .finally(() => (switching = null));
  return switching;
}

// --- time helpers (global position across tracks) ---------------------------
// A part's length is only known once it has played. Until then it's estimated:
// from its file size at the rate of the parts already played, else as their
// average — so "% of book" and "time left" cover the whole book, not one file.
function estDuration(i) {
  const t = state.tracks[i];
  if (!t) return 0;
  if (t.duration > 0) return t.duration;
  const known = state.tracks.filter((x) => x.duration > 0);
  if (!known.length) return 0;
  const sized = known.filter((x) => x.size > 0);
  if (t.size > 0 && sized.length) return (t.size * sized.reduce((a, x) => a + x.duration, 0)) / sized.reduce((a, x) => a + x.size, 0);
  return known.reduce((a, x) => a + x.duration, 0) / known.length;
}
export function trackOffset(i) {
  const t = state.tracks[i];
  if (t && typeof t.offset === 'number') return t.offset;
  let o = 0;
  for (let k = 0; k < i; k++) o += estDuration(k);
  return o;
}
export function totalDuration() {
  return state.tracks.reduce((a, _, i) => a + estDuration(i), 0) || state.duration;
}
export function globalTime() {
  return trackOffset(state.index) + state.time;
}
export function chapters() {
  if (state.book?.chaptersMeta?.length) return state.book.chaptersMeta;
  return state.tracks.map((t, i) => ({ title: t.title, start: trackOffset(i), end: trackOffset(i) + estDuration(i), track: i, estimated: !(t.duration > 0) }));
}

// --- loading ----------------------------------------------------------------
let loadToken = 0;
async function loadTrack(i, startAt = 0, autoplay = true) {
  const token = ++loadToken;
  // Downloaded (maybe after this book was opened): play the files on the phone.
  if (state.book && !state.book.offline && isDownloaded(state.book.uid)) {
    const local = applyLocal(state.book);
    if (local.tracks?.length === state.tracks.length) set({ book: local, tracks: local.tracks });
  }
  const t = state.tracks[i];
  if (!t) return;
  if (state.preparing) stopWaiting();
  loadingAt = { index: i, at: startAt };
  outroAt = 0;
  set({ index: i, loading: true, error: null, time: startAt, duration: t.duration || 0, phase: !t.url && t.resolve ? 'Getting the audio link…' : 'Connecting…' });
  try {
    let url = t.url;
    // A link fetched ahead of time that's getting old: fetch a new one.
    if (url && t.resolve && t.urlAt && Date.now() - t.urlAt > LINK_FRESH) url = null;
    if (!url && t.resolve) {
      url = await t.resolve();
      t.urlAt = Date.now();
      t.early = false;
      if (token === loadToken) set({ phase: 'Buffering… large files can take a few seconds' });
      t.url = url;
    }
    if (token !== loadToken) return;
    if (!url) throw new Error('No playable stream for this part');
    const b = state.book;
    await engine.load(url, {
      start: startAt,
      autoplay,
      rate: state.rate,
      headers: t.headers,
      meta: { title: t.title || b.title, artist: b.author || '', album: b.title, artwork: b.cover || '' },
    });
    if (!autoplay) set({ loading: false, phase: '' });
    // One long file with chapter marks inside (M4B): read them, for the chapter list,
    // "end of chapter" and "next chapter".
    if (state.tracks.length === 1 && !b.chaptersMeta?.length) {
      const uid = b.uid;
      import('./m4bchapters.js')
        .then((m) => m.m4bChapters(uid, url, t.headers, t.duration || state.duration))
        .then((list) => list.length && state.book?.uid === uid && patchBook(uid, { chaptersMeta: list }))
        .catch(() => {});
    }
    queueBase = i;
    queueAhead(token);
  } catch (e) {
    if (token !== loadToken || e?.name === 'AbortError') return;
    if (e.pending) return waitForCloud(i, startAt, e.pending);
    // A link fetched ahead of time may have expired: get a fresh one, once.
    if (t.early && t.resolve) {
      t.early = false;
      t.url = null;
      return loadTrack(i, startAt, autoplay);
    }
    if (isAbs(state.book) && (await trySwitch())) return;
    if (token !== loadToken) return;
    if (await recover(e.message)) return;
    if (token !== loadToken) return;
    set({ loading: false, playing: false, phase: '', error: e.message || 'Playback failed' });
  }
}

// --- the next parts, queued in the phone's player -----------------------------
// Android plays them one after another by itself, even with the screen off and
// the app asleep (the app's own code may not run then to start the next part).
let queueBase = 0; // the track the phone's player list starts with
const AHEAD = 3;
async function queueAhead(token) {
  if (!engine.queue || state.sleepEndOfTrack) return;
  const b = state.book;
  const items = [];
  for (let k = state.index + 1; k < Math.min(state.tracks.length, state.index + 1 + AHEAD); k++) {
    const t = state.tracks[k];
    try {
      if (!t.url && t.resolve) t.url = await t.resolve();
    } catch {
      break; // e.g. still downloading on TorBox: the app starts it itself later
    }
    if (token !== loadToken || !t.url) break;
    items.push({ url: t.url, title: t.title || b.title, artist: b.author || '', album: b.title, artwork: b.cover || '' });
  }
  if (token === loadToken) engine.queue(items).catch?.(() => {});
}

// --- still downloading on TorBox / Real-Debrid --------------------------------
// Instead of failing on a half-downloaded file, show the download progress and
// start playing by itself once the service has the whole file.
let prepTimer = null;
const isCloud = (b) => /^(tb|rd):/.test(b?.uid || '');

function stopWaiting() {
  clearTimeout(prepTimer);
  prepTimer = null;
  if (state.preparing) set({ preparing: null });
}

function waitForCloud(i, startAt, status) {
  const book = state.book;
  set({ loading: false, playing: false, error: null, preparing: status });
  clearTimeout(prepTimer);
  prepTimer = setTimeout(async function poll() {
    if (state.book !== book) return;
    let st;
    try {
      st = await fetchStatus(book);
    } catch {
      prepTimer = setTimeout(poll, 15000);
      return;
    }
    if (state.book !== book) return;
    if (st.ready) {
      set({ preparing: null });
      state.tracks.forEach((t) => t.resolve && (t.url = null)); // links made mid-download are partial
      loadTrack(i, startAt);
    } else {
      set({ preparing: st });
      prepTimer = setTimeout(poll, 8000);
    }
  }, 8000);
}

/** After a playback error on a cloud book, check whether the service is still downloading it. */
async function checkCloud(i, startAt, msg) {
  const book = state.book;
  if (!isCloud(book)) return;
  let st = null;
  try {
    st = await fetchStatus(book);
  } catch {}
  if (state.book !== book || state.index !== i) return;
  if (st && !st.ready) return waitForCloud(i, startAt, st);
  if (/PARSING|MALFORMED|format can.t be played|UNSUPPORTED|no supported source|cannot play/i.test(msg || '')) {
    const more = i < state.tracks.length - 1;
    set({ error: `This part isn't a playable audio file — it may be damaged or packed in an archive.${more ? ' Tap ⏭ to skip to the next part.' : ''}` });
  }
}

/**
 * Start a book. `details` comes from sources.getDetails(); tracks may need a
 * playback session (Audiobookshelf, addon streams) which is resolved here.
 */
/**
 * Show the player straight away while a book's details are still being
 * fetched, so a tap on Play always gives visible feedback.
 */
// ---- getting ready before you press play ------------------------------------
// The book page and Home's "Continue" fetch the book's parts and the audio link of the
// part you'll resume in the background, so pressing play starts at once.
const LINK_FRESH = 20 * 60e3; // cloud links expire; older ones are fetched again
const ready = new Map(); // uid -> { t, details }

/** Fetch the audio link for the part this book would resume at (no-op if not needed). */
export async function prepare(details) {
  try {
    if (!details?.tracks?.length || details.offline || isDownloaded(details.uid)) return details;
    const saved = progress.get()[details.uid];
    const i = saved && !saved.finished ? Math.min(saved.track || 0, details.tracks.length - 1) : 0;
    const t = details.tracks[i];
    if (t && t.resolve && (!t.url || Date.now() - (t.urlAt || 0) > LINK_FRESH)) {
      t.url = await t.resolve();
      t.urlAt = Date.now();
      t.early = true;
    }
  } catch {} // e.g. still downloading: playing will show that
  return details;
}

/** Get a book ready to play (details + link), kept for 15 minutes. */
export function prefetch(book, getDetails) {
  if (!book?.uid || ready.has(book.uid) || state.book?.uid === book.uid) return;
  const entry = { t: Date.now(), details: null };
  ready.set(book.uid, entry);
  getDetails(book, { fast: true })
    .then((d) => prepare(d))
    .then((d) => (entry.details = d))
    .catch(() => ready.delete(book.uid));
}

// A different book: drop the previous one's parts at once, so nothing (the transcript,
// the progress bar) takes the old audio for the new book while it opens.
const freshBook = (book) => (state.book?.uid === book?.uid ? {} : { tracks: [], index: 0, time: 0, duration: 0 });

export async function openAndPlay(book, getDetails, opts) {
  stopWaiting();
  set({ ...freshBook(book), book, loading: true, error: null, playing: false, phase: 'Opening the book…' });
  try {
    const early = ready.get(book.uid);
    ready.delete(book.uid);
    const details = early?.details && Date.now() - early.t < 15 * 60e3 ? early.details : await getDetails(book, { fast: true });
    return playBook(details, opts);
  } catch (e) {
    set({ loading: false, phase: '', error: e.message || String(e) });
  }
}

export async function playBook(details, { index, time, globalStart, autoplay = true } = {}) {
  stopWaiting();
  // A book you chose (not a switch by the safety net): start its list of tried copies afresh.
  if (!rescuing) rescueTried.clear();
  rescuing = false;
  if (details && !details.offline && isDownloaded(details.uid)) details = applyLocal(details);
  set({ ...freshBook(details), loading: true, error: null, book: details, phase: 'Opening the book…' });
  try {
    let tracks = details.tracks;
    let serverStart = 0;
    if (!tracks?.length && details.resolveTracks) {
      set({ phase: 'Starting a session on your server…' });
      const r = await details.resolveTracks();
      tracks = r.tracks;
      serverStart = r.startTime || 0;
    }
    if (!tracks?.length) throw new Error('No audio tracks found for this title');
    set({ book: details, tracks, playing: false });
    let saved = progress.get()[details.uid];
    // One place per book, whatever the copy: if you listened further on in another copy
    // (another source, a download, your server) more recently, carry on from there.
    const other = index == null && time == null && globalStart == null ? otherCopyProgress(details) : null;
    const useOther = other && (!saved || saved.finished || other.updatedAt > (saved.updatedAt || 0) + 60e3);
    if (useOther) saved = null;
    const resume = saved && !saved.finished;
    let i = index ?? (resume ? saved.track : 0) ?? 0;
    let t = time ?? (resume ? saved.time : 0);
    const g = globalStart ?? (useOther ? other.global : null) ?? (index == null && time == null && !resume && serverStart ? serverStart : null);
    if (g != null) ({ i, t } = locate(g));
    // Gentle rewind when resuming after a break.
    if (resume && index == null && time == null && Date.now() - saved.updatedAt > 5 * 60e3) t = Math.max(0, t - 10);
    // Back after two weeks or more: the player offers a recap (fiction: characters too).
    const away = resume && saved.updatedAt ? Math.floor((Date.now() - saved.updatedAt) / 86400e3) : 0;
    set({ awayDays: away >= 14 ? away : 0 });
    // The show's own speed, and skip its intro when starting from the top.
    const pref = showPrefsFor(details) || {};
    const rate = pref.speed || prefOf(details).speed || settings.get().speed || 1;
    if (rate !== state.rate) set({ rate });
    // This book's own volume boost.
    applyAudio();
    if (pref.intro && !t && (i || 0) === 0) t = pref.intro;
    // autoplay false: ready but quiet (e.g. a scene is looked up first, then it plays from there).
    await loadTrack(Math.min(i, tracks.length - 1), t, autoplay);
  } catch (e) {
    set({ loading: false, phase: '', error: e.message || String(e) });
  }
}

function locate(g) {
  for (let i = state.tracks.length - 1; i >= 0; i--) {
    const o = trackOffset(i);
    if (g >= o) return { i, t: g - o };
  }
  return { i: 0, t: 0 };
}

// --- controls ---------------------------------------------------------------
let resumeTimer = null;

export function toggle() {
  if (state.preparing) return; // starts by itself when the download finishes
  if (state.error) return loadTrack(state.index, state.time); // retry after a failure
  if (state.playing) return engine.pause();
  // Resuming: show it, and if nothing plays within 12s (dead connection or an
  // expired link after a long pause or a call), reload this part at the same spot.
  set({ loading: true, phase: state.interrupted ? 'Taking the audio back from the call…' : 'Resuming…', interrupted: false });
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    if (state.playing || !state.book || engine.paused) return; // user paused again meanwhile
    state.tracks.forEach((t) => t.resolve && (t.url = null));
    set({ phase: 'Reconnecting…' });
    if (isAbs(state.book)) return trySwitch().then((ok) => ok || loadTrack(state.index, state.time));
    loadTrack(state.index, state.time);
  }, 12000);
  Promise.resolve(engine.play()).catch((e) => set({ loading: false, phase: '', error: e.message }));
}

export const pause = () => engine.pause();
export function seek(t) {
  if (!isFinite(t)) return;
  const d = state.duration || engine.duration;
  const clamped = Math.max(0, d ? Math.min(t, d - 0.25) : t);
  loadingAt = null;
  engine.seek(clamped);
  set({ time: clamped });
}
export function seekGlobal(g) {
  const { i, t } = locate(g);
  if (i === state.index) seek(t);
  else loadTrack(i, t, state.playing);
}
export function skip(delta) {
  const t = state.time + delta;
  if (t < 0 && state.index > 0) {
    const prevTrack = state.tracks[state.index - 1];
    return loadTrack(state.index - 1, Math.max(0, (prevTrack.duration || 0) + t), state.playing);
  }
  const d = state.duration || engine.duration;
  if (d && t > d && state.index < state.tracks.length - 1) return loadTrack(state.index + 1, 0, state.playing);
  seek(t);
}
export function next() {
  if (state.index < state.tracks.length - 1) loadTrack(state.index + 1, 0);
}
export function prev() {
  if (state.time > 5 || state.index === 0) seek(0);
  else loadTrack(state.index - 1, 0);
}
export function jumpTo(i, t = 0) {
  loadTrack(i, t);
}
export function setRate(r) {
  engine.setRate(r);
  set({ rate: r });
  // A show with its own speed keeps the change for that show.
  if (showPrefsFor(state.book)?.speed && showPrefsSave) showPrefsSave(state.book, { speed: r });
  else settings.patch({ speed: r }), savePref({ speed: r });
}
export function setSleep(mode) {
  const wasTrack = state.sleepEndOfTrack;
  if (mode === 'track') engine.queue?.([]);
  else if (wasTrack && state.book) setTimeout(() => queueAhead(loadToken));
  // A book with chapter marks inside its file(s): the end of the chapter you're in.
  let chapterEnd = null;
  if (mode === 'track' && state.book?.chaptersMeta?.length) {
    const g = globalTime();
    const c = state.book.chaptersMeta.find((x) => g >= x.start && g < (x.end || Infinity));
    if (c?.end) chapterEnd = c.end;
  }
  if (mode === 'track') set({ sleepUntil: null, sleepEndOfTrack: true, sleepChapterEnd: chapterEnd });
  else if (!mode) set({ sleepUntil: null, sleepEndOfTrack: false, sleepChapterEnd: null });
  else set({ sleepUntil: Date.now() + mode * 60e3, sleepEndOfTrack: false, sleepChapterEnd: null });
}

/** Add details to the book that's playing (e.g. chapters fetched afterwards). */
export function patchBook(uid, patch) {
  if (state.book?.uid === uid) set({ book: { ...state.book, ...patch } });
}

/** Stop playback and dismiss the player completely. */
export function stop() {
  saveProgress(true);
  loadToken++;
  Promise.resolve(engine.stop()).catch(() => {});
  stopWaiting();
  set({ book: null, tracks: [], playing: false, loading: false, error: null, time: 0, duration: 0, sleepUntil: null, sleepEndOfTrack: false });
}

/** Give a bookmark a better name (it's found by the moment it was made). */
export function renameBookmark(uid, createdAt, label) {
  if (!label) return;
  bookmarks.set((all) => ({ ...all, [uid]: (all[uid] || []).map((b) => (b.createdAt === createdAt ? { ...b, label } : b)) }));
}

/** Play from a moment in the book (seconds from its start), whether playing or paused. */
export function playAt(g) {
  const at = locate(Math.max(0, g));
  if (at.i === state.index && state.playing) seek(at.t);
  else loadTrack(at.i, at.t, true);
}

/** Bookmarks play from a little before the marked moment, to catch the start of it. */
export const BOOKMARK_LEAD = 15;
export function playBookmark(bm) {
  const t = bm.time - BOOKMARK_LEAD;
  // Near the start of a part: the end of the part before it.
  const at = t >= 0 || !bm.track ? { i: bm.track, t: Math.max(0, t) } : locate(trackOffset(bm.track) + t);
  if (at.i === state.index && state.playing) seek(at.t);
  else loadTrack(at.i, at.t, true);
}

export function addBookmark(label) {
  if (!state.book) return;
  const uid = state.book.uid;
  const bm = { track: state.index, time: state.time, global: globalTime(), label: label || `${state.tracks[state.index]?.title || 'Bookmark'}`, createdAt: Date.now() };
  bookmarks.set((all) => ({ ...all, [uid]: [...(all[uid] || []), bm].sort((a, b) => a.global - b.global) }));
  return bm;
}

// --- progress ---------------------------------------------------------------
let lastSave = 0;
function saveProgress(force = false) {
  if (!state.book || !state.tracks.length) return;
  const now = Date.now();
  if (!force && now - lastSave < 4000) return;
  lastSave = now;
  const total = totalDuration();
  const g = globalTime();
  const d = state.duration;
  const finished = state.index === state.tracks.length - 1 && ((d > 0 && state.time >= d - 2) || outroAt > 0);
  const uid = state.book.uid;
  progress.set((p) => ({
    ...p,
    [uid]: {
      kind: 'audio',
      track: state.index,
      time: state.time || 0,
      global: g,
      total,
      percent: total ? Math.min(1, g / total) : 0,
      finished: !!finished,
      updatedAt: now,
      book: summarize(state.book),
    },
  }));
  if (uid.startsWith('abs:')) syncProgress(uid, g, total, !!finished);
}

function fadeOutAndPause() {
  set({ sleepUntil: null });
  let step = 0;
  const iv = setInterval(() => {
    step++;
    engine.setVolume(Math.max(0, 1 - step / 20));
    if (step >= 20) {
      clearInterval(iv);
      engine.pause();
      engine.setVolume(1);
    }
  }, 150);
}

document.addEventListener('visibilitychange', () => saveProgress(true));
