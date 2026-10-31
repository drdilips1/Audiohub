// Live transcript: the audiobook's words scroll along as it plays. Speech is
// recognised on the phone (sherpa-onnx; models downloaded once in the app),
// a little ahead of the playback position.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { persisted } from './store.js';
import { getText } from './http.js';
import { installedIds, download as downloadPackage, remove as removePackage, builtinAvailable } from './voices.js';
import * as player from './player.js';
import { isHindi } from '../screens/hindi.js';

const T = registerPlugin('InkwellTranscribe');
// iPhone: the same plugin name, built on Apple's own speech recognition (no download).
const IOS = Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('InkwellTranscribe');
export const transcriptAvailable = IOS || (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellTranscribe') && builtinAvailable);
const APPLE = { id: 'apple-speech', name: 'Apple speech recognition', type: 'apple', languages: ['*'] };

// Repacked from sherpa-onnx's releases (.github/workflows/asr-models.yml): only the files the
// app uses, as .tar.gz, which unpacks far faster on the phone than the original .tar.bz2.
const ASR = 'https://github.com/drdilips1/bytewatch-stremio-addon/releases/download/asr-models/';

/** Speech-recognition models you can download in the app. */
export const MODELS = [
  {
    id: 'asr-moonshine-tiny-en',
    name: 'English',
    what: 'Moonshine · fast and accurate for English audiobooks',
    size: '≈ 100 MB',
    type: 'moonshine',
    url: ASR + 'asr-moonshine-tiny-en-int8.tar.gz',
    languages: ['en'],
  },
  {
    id: 'asr-whisper-base',
    name: 'Hindi + 90 languages',
    what: 'Whisper base · हिंदी and other languages · slower',
    size: '≈ 95 MB',
    type: 'whisper',
    url: ASR + 'asr-whisper-base-int8.tar.gz',
    languages: ['*'],
  },
];

export const transcriptCfg = persisted('transcript', { open: false });

const state = { key: '', segments: [], status: 'idle', error: '', model: null };
const subs = new Set();
const emit = () => subs.forEach((f) => f({ ...state, segments: state.segments }));
export const subscribeTranscript = (f) => (subs.add(f), f({ ...state }), () => subs.delete(f));
const set = (p) => (Object.assign(state, p), emit());

let job = '';
let jobStart = 0;
let installed = null;

// Transcribed lines are kept per book part (last few parts, across restarts),
// so leaving the screen or the app doesn't lose them.
const saved = persisted('transcriptCache', { order: [], parts: {} });
let saveTimer = null;
function remember() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { key, segments } = state;
    if (!key || !segments.length) return;
    saved.set((c) => {
      const order = [key, ...c.order.filter((k) => k !== key)].slice(0, 4);
      const parts = {};
      // Only what was heard: the ebook's words are matched again each time (the ebook may change).
      for (const k of order) parts[k] = k === key ? segments.slice(-2500).map(({ start, end, text }) => ({ start, end, text })) : c.parts[k];
      return { order, parts };
    });
  }, 3000);
}

// The book's own words (when its ebook is on hand): recognised lines are matched to it.
let bt = null;
let btUid = '';
let btRun = 0; // the latest ebook load: an older, slower one must not win
// bookText: { state: 'loading' | 'on' | 'none' | 'error', title, error }
function bookTextFor(book, again = false) {
  if (!book || (book.uid === btUid && !again)) return;
  btUid = book.uid;
  bt = null;
  const run = ++btRun;
  for (const s of state.segments) delete s.at, delete s.book, delete s.fill;
  set({ segments: state.segments.slice(), bookText: { state: 'loading' } });
  // Looking everywhere (phone, sources, TorBox…) can take long: give up after a minute.
  const limit = new Promise((ok) => setTimeout(() => ok('timeout'), 60000));
  import('./booktext.js')
    .then((m) => Promise.race([m.loadBookText(book), limit]))
    .then((x) => {
      if (run !== btRun) return;
      if (x === 'timeout') return set({ bookText: { state: 'none', why: 'timeout' } });
      if (!x) return set({ bookText: { state: 'none' } });
      bt = x;
      set({ bookText: { state: 'on', title: x.title || '' } });
      align();
    })
    .catch((e) => run === btRun && set({ bookText: { state: 'error', error: e?.message || String(e) } }));
}

/** Search your sources for this audiobook's ebook: [{ r, file, source, book }]. */
export async function findEbook(query = '') {
  const ps = player.getState();
  if (!ps.book) return [];
  const { findEbookInSources } = await import('./booktext.js');
  return findEbookInSources(ps.book, query);
}

/** Ebooks already on the phone to choose from (this book's first). */
export async function ebooksOnPhone(query = '', all = false) {
  const ps = player.getState();
  if (!ps.book) return [];
  const { ebooksOnHand } = await import('./booktext.js');
  return ebooksOnHand(ps.book, query, { all });
}

/** Use an ebook already on the phone for this audiobook's transcript. */
export async function takeOnPhone(eb) {
  const ps = player.getState();
  if (!ps.book) return;
  const { linkEbook } = await import('./booktext.js');
  linkEbook(ps.book.uid, eb);
  bookTextFor(ps.book, true);
}

// An ebook saved after the transcript looked (e.g. from the main search): look again.
import('./epub.js').then(({ savedEbooks }) =>
  savedEbooks.subscribe(() => {
    const ps = player.getState();
    if (ps.book && ['none', 'error'].includes(state.bookText?.state)) bookTextFor(ps.book, true);
  })
);

/** Download one of those, keep it, and show its words in the transcript. */
export async function takeEbook(hit) {
  const ps = player.getState();
  if (!ps.book) return;
  const { keepFoundEbook } = await import('./booktext.js');
  await keepFoundEbook(ps.book.uid, hit, ps.book);
  bookTextFor(ps.book, true);
}
let locate = null;
import('./booktext.js').then((m) => (locate = m.locate)).catch(() => {});
/** Give each recognised line the ebook's words for it (`book`), gaps between lines filled. */
function align() {
  // Only this book's ebook, only on this book's lines.
  if (!bt || !locate || state.published || !state.key.startsWith(btUid + '#')) return;
  const segs = state.segments;
  // 1. Find each line in the book, searching near where the previous one ended.
  let near = null;
  for (const s of segs) {
    if (s.fill) delete s.at, delete s.fill; // filled in last time: work it out again
    if (!s.at) {
      const r = locate(bt, s.text, near);
      if (r) s.at = [r.from, r.to];
    }
    if (s.at) near = s.at[1];
  }
  // 1b. Lines run forwards through the book: a line placed far before the ones around it (or
  //     far after) was matched to a repeated phrase elsewhere — drop it (it's filled in below).
  //     Keeps the longest run of lines in book order.
  {
    const found = segs.map((s, i) => (s.at ? i : -1)).filter((i) => i >= 0);
    const best = [];
    const prev = [];
    const ends = []; // ends[k]: index (into found) of the smallest tail of a run of length k+1
    for (let j = 0; j < found.length; j++) {
      const v = segs[found[j]].at[0];
      let lo = 0;
      let hi = ends.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (segs[found[ends[mid]]].at[0] <= v + 3) lo = mid + 1;
        else hi = mid;
      }
      prev[j] = lo > 0 ? ends[lo - 1] : -1;
      ends[lo] = j;
    }
    for (let j = ends.length ? ends[ends.length - 1] : -1; j >= 0; j = prev[j]) best.push(found[j]);
    const keep = new Set(best);
    // Only when most lines agree (a short, jumpy stretch is left as it is).
    if (found.length >= 4 && keep.size >= found.length * 0.6) for (const i of found) if (!keep.has(i)) delete segs[i].at;
  }
  // 2. Between two lines that were found: the book's words in between go to the lines that
  //    weren't (too short to find, or misheard), shared by how many words each had; with no
  //    line in between, the earlier one simply ends where the next begins.
  let prevI = -1;
  for (let i = 0; i < segs.length; i++) {
    if (!segs[i].at) continue;
    const prev = prevI >= 0 ? segs[prevI] : null;
    if (prev) {
      const mid = segs.slice(prevI + 1, i);
      const gap = segs[i].at[0] - prev.at[1];
      if (mid.length && gap > 0 && gap <= 25 * mid.length + 20) {
        const weights = mid.map((m) => Math.max(1, m.text.split(/\s+/).length));
        const total = weights.reduce((x, y) => x + y, 0);
        let at = prev.at[1];
        mid.forEach((m, k) => {
          const n = k === mid.length - 1 ? segs[i].at[0] - at : Math.max(1, Math.round((gap * weights[k]) / total));
          m.at = [at, Math.min(segs[i].at[0], at + n)];
          m.fill = true;
          at = m.at[1];
        });
      } else if (!mid.length && ((gap > 0 && gap <= 12) || (gap < 0 && segs[i].at[0] > prev.at[0]))) prev.at = [prev.at[0], segs[i].at[0]];
    }
    prevI = i;
  }
  // 3. A short misheard line just before (or after) a found one ("Be he" for "Behave"): the
  //    book's few words there, when they sound alike (letters in common).
  const near1 = (s, from, to) => to > from && from >= 0 && to <= bt.tokens.length && similar(s.text, bt.tokens.slice(from, to).join(' '));
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.at || s.text.split(/\s+/).length > 4) continue;
    const next = segs[i + 1];
    const prev = segs[i - 1];
    for (let k = 1; k <= 3 && !s.at; k++) {
      if (next?.at && near1(s, next.at[0] - k, next.at[0])) s.at = [next.at[0] - k, next.at[0]];
      else if (prev?.at && near1(s, prev.at[1], prev.at[1] + k)) s.at = [prev.at[1], prev.at[1] + k];
    }
    if (s.at) s.fill = true;
  }
  for (const s of segs) s.book = s.at && s.at[1] > s.at[0] ? bt.tokens.slice(s.at[0], s.at[1]).join(' ') : undefined;
  set({ segments: segs.slice() });
}

/** Do two short bits of text sound alike? Shared letter pairs (Dice), spaces and case ignored. */
function similar(a, b) {
  const pairs = (s) => {
    const t = String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const out = [];
    for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
    return out;
  };
  const x = pairs(a);
  const y = pairs(b);
  if (!x.length || !y.length) return false;
  const pool = [...y];
  let hit = 0;
  for (const p of x) {
    const j = pool.indexOf(p);
    if (j >= 0) hit++, pool.splice(j, 1);
  }
  return (2 * hit) / (x.length + y.length) >= 0.5;
}

/** End of the run of transcribed lines (gaps under 20s) that covers time t, or null. */
function coveredUntil(t) {
  const segs = state.segments;
  let i = segs.findIndex((x) => x.end >= t - 1);
  if (i < 0 || segs[i].start > t + 5) return null;
  let end = segs[i].end;
  while (i + 1 < segs.length && segs[i + 1].start - end < 20) end = Math.max(end, segs[++i].end);
  return end;
}

export async function installedModels() {
  if (!transcriptAvailable) return [];
  if (IOS) return (installed = [APPLE]);
  const ids = await installedIds();
  installed = MODELS.filter((m) => ids.includes(m.id));
  return installed;
}

export function downloadModel(m, onProgress) {
  return downloadPackage(m, onProgress).then(() => (installed = null));
}
export const removeModel = (m) => removePackage(m.id).then(() => (installed = null));

function languageOf(book) {
  return book && isHindi(book) ? 'hi' : 'en';
}

function pickModel(list, lang) {
  return list.find((m) => m.languages.includes(lang)) || list.find((m) => m.languages.includes('*')) || null;
}

if (transcriptAvailable) {
  T.addListener('segment', (e) => {
    if (e.job !== job) return;
    const segs = state.segments;
    // Keep segments sorted by start time.
    let i = segs.length;
    while (i > 0 && segs[i - 1].start > e.start) i--;
    segs.splice(i, 0, { start: e.start, end: e.end, text: e.text });
    set({ segments: segs.slice(), status: 'running' });
    align();
    remember();
  });
  T.addListener('status', (e) => {
    if (e.job !== job) return;
    set({ status: e.state === 'error' ? 'error' : e.state, error: e.message || '' });
  });
}

async function startJob(ps, at) {
  const t = ps.tracks[ps.index];
  const list = installed || (await installedModels());
  const lang = languageOf(ps.book);
  const m = pickModel(list, lang);
  if (!m) return set({ status: 'no-model', model: null });
  if (!t?.url) return set({ status: 'waiting' });
  job = `${state.key}@${Math.round(at)}-${Date.now()}`;
  jobStart = at;
  // Drop what the new job will produce again.
  set({ segments: state.segments.filter((s) => s.end <= at + 0.5), status: 'loading', error: '', model: m });
  // A start the phone never answered (not even "loading the model"): offer Try again instead of
  // waiting forever. Slow but reporting starts are left to the native side's own limits.
  const mine = job;
  setTimeout(() => {
    if (job === mine && state.status === 'loading' && !state.error) set({ status: 'error', error: 'Speech recognition didn’t start.' });
  }, 75000);
  try {
    await T.start({
      job,
      url: t.url,
      headers: t.headers || {},
      model: m.id,
      type: m.type,
      language: m.type === 'whisper' || m.type === 'apple' ? lang : 'en',
      start: at,
      ahead: 90,
      duration: t.duration || ps.duration || 0,
    });
  } catch (e) {
    set({ status: 'error', error: e.message });
  }
}

// ---- the publisher's own transcript (podcast episodes that ship one) ----------
// Timed lines straight from the feed: no speech recognition needed.
const clock = (t) => String(t).trim().replace(',', '.').split(':').reduce((a, x) => a * 60 + Number(x || 0), 0);
// Some publishers time every word: join them into readable lines.
function joinShort(segs) {
  const out = [];
  for (const g of segs) {
    const last = out[out.length - 1];
    if (last && last.text.length < 140 && !/[.!?]["')\]]?$/.test(last.text) && g.start - last.end < 2 && last.speaker === g.speaker) {
      last.text += ' ' + g.text;
      last.end = g.end;
    } else out.push({ ...g });
  }
  return out;
}
export function parsePublished(text, type = '') {
  const t = String(text || '').replace(/\r/g, '');
  if (/json/.test(type) || /^\s*[{[]/.test(t)) {
    try {
      const j = JSON.parse(t);
      const segs = (j.segments || j || [])
        .map((g) => ({ start: Number(g.startTime) || 0, end: Number(g.endTime) || Number(g.startTime) || 0, text: String(g.body || '').trim(), speaker: g.speaker || '' }))
        .filter((g) => g.text);
      if (segs.length) return joinShort(segs);
    } catch {}
  }
  if (/-->/.test(t)) {
    const segs = [];
    for (const block of t.split(/\n{2,}/)) {
      const lines = block.split('\n');
      const k = lines.findIndex((l) => l.includes('-->'));
      if (k < 0) continue;
      const [a, b] = lines[k].split('-->');
      const words = lines
        .slice(k + 1)
        .join(' ')
        .replace(/<v\s+([^>]+)>/g, '$1: ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (words) segs.push({ start: clock(a), end: clock(b.split(/\s/).filter(Boolean)[0]), text: words, speaker: '' });
    }
    if (segs.length) return joinShort(segs);
  }
  // Plain text or a web page: untimed paragraphs.
  const plainText = /<[a-z][\s\S]*>/i.test(t) ? new DOMParser().parseFromString(t, 'text/html').body.innerText || '' : t;
  return plainText
    .split(/\n\s*\n|\n(?=[A-Z][\w ]{0,30}:)/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text) => ({ start: null, end: null, text }));
}

const failedTranscripts = new Set();
function followPublished(ps) {
  const key = `${ps.book.uid}#pub`;
  if (key === state.key || failedTranscripts.has(ps.book.transcript.url)) return;
  stopTranscript();
  const { url, type } = ps.book.transcript;
  set({ key, segments: [], status: 'loading', error: '', published: true });
  getText(url, { timeout: 20000 })
    .then((txt) => {
      if (state.key !== key) return;
      const segments = parsePublished(txt, type);
      if (!segments.length) throw new Error('The transcript was empty');
      set({ segments, status: 'done' });
    })
    .catch((e) => {
      failedTranscripts.add(url);
      if (state.key !== key) return;
      // Couldn't get it: recognise the speech on the phone instead, where possible.
      if (transcriptAvailable && transcriptCfg.get().open) {
        set({ key: '', published: false });
        follow({ ...ps, book: { ...ps.book, transcript: null } });
      } else set({ status: 'error', error: `Couldn't load the transcript (${e.message})` });
    });
}

/**
 * Keep the transcript in step with the player. Called on every player update
 * while the transcript is on screen.
 */
export function follow(ps) {
  if (!ps.book) return;
  if (ps.book.transcript?.url && !failedTranscripts.has(ps.book.transcript.url)) return followPublished(ps);
  if (!transcriptAvailable) return;
  if (state.published) set({ published: false });
  const key = `${ps.book.uid}#${ps.index}`;
  bookTextFor(ps.book);
  const from = () => {
    const c = coveredUntil(ps.time);
    return c != null ? Math.max(0, c - 1) : Math.max(0, ps.time - 2);
  };
  if (key !== state.key) {
    stopTranscript();
    set({ key, segments: (saved.get().parts[key] || []).map(({ start, end, text }) => ({ start, end, text })), status: 'idle', error: '' });
    align();
    return startJob(ps, from());
  }
  if (state.status === 'no-model' || state.status === 'loading' || state.status === 'error') return;
  if (state.status === 'waiting' || state.status === 'idle') return startJob(ps, from());
  const segs = state.segments;
  const frontier = segs.reduce((m, x) => (x.start >= jobStart - 1 ? Math.max(m, x.end) : m), jobStart);
  const covered = coveredUntil(ps.time);
  // Jumped somewhere this job won't reach soon (and that isn't transcribed yet): start from there.
  const behind = ps.time < jobStart - 1 && (covered == null || covered < jobStart - 1);
  // (On iPhone the transcriber catches up with the listener by itself.)
  const ahead = !IOS && ps.time > frontier + 45 && state.status !== 'done';
  if (behind || ahead) return startJob(ps, from());
  T.position({ pos: ps.time }).catch(() => {});
}

// The ebook reader following the audiobook: recognise the speech while it's open too.
let readerFollow = false;
export function followInReader(on) {
  readerFollow = !!on;
  const ps = player.getState();
  if (on && ps.book && transcriptAvailable) follow(ps);
  else if (!on && !transcriptCfg.get().open) stopTranscript();
}

/** What's being said right now (the line at the player's position and the one before), or ''. */
export function heardNow() {
  const ps = player.getState();
  if (!ps.book || state.key !== `${ps.book.uid}#${ps.index}`) return '';
  const segs = state.segments;
  let i = segs.findIndex((x) => x.start <= ps.time + 0.5 && x.end >= ps.time - 0.5);
  if (i < 0) {
    // Between lines: the last one heard, if it was just now.
    for (let k = segs.length - 1; k >= 0; k--) if (segs[k].end <= ps.time && ps.time - segs[k].end < 6) (i = k), (k = -1);
  }
  if (i < 0) return '';
  return [segs[i - 1]?.text, segs[i].text].filter(Boolean).join(' ');
}

export function stopTranscript() {
  if (!transcriptAvailable) return;
  job = '';
  T.stop().catch(() => {});
  // Nothing runs any more: say so, or turning Text back on would wait for this job forever.
  if (state.status === 'loading' || state.status === 'running') set({ status: 'idle', error: '' });
}

/** Forget the current model choice (after downloading or removing one). */
export function restartTranscript() {
  installed = null;
  stopTranscript();
  set({ key: '', segments: [], status: 'idle' });
  const ps = player.getState();
  if (ps.book) follow(ps);
}

// Keep transcribing while the Text view is switched on, even with the player
// screen closed (e.g. moving on to the next part).
{
  let last = 0;
  player.subscribe((ps) => {
    if (!ps.book) return;
    // The publisher's transcript is one small download: fetch it for every such
    // episode (Ask AI uses it too). Speech recognition only runs with Text open.
    if (ps.book.transcript?.url && !failedTranscripts.has(ps.book.transcript.url)) return followPublished(ps);
    if (!(transcriptCfg.get().open || readerFollow) || !transcriptAvailable) return;
    const now = Date.now();
    if (now - last < 1000 && ps.index === player.getState().index && `${ps.book.uid}#${ps.index}` === state.key) return;
    last = now;
    follow(ps);
  });
}

// An audiobook that has played for a little while: find its ebook in the background
// (Settings → Finding books), so the transcript shows the book's words straight away.
{
  let uid = '';
  let timer = null;
  player.subscribe((ps) => {
    const b = ps.book;
    if (!b || !ps.playing || b.uid === uid || b.source === 'pod' || b.transcript?.url) return;
    if (!transcriptAvailable && !IOS) return;
    uid = b.uid;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const [{ autoFindEbook }, { autoEbook }] = await Promise.all([import('./booktext.js'), import('./findorder.js')]);
      if (!autoEbook() || player.getState().book?.uid !== b.uid) return;
      const eb = await autoFindEbook(player.getState().book);
      // The transcript looked before this was found: show the book's words now.
      if (eb && btUid === b.uid && ['none', 'error'].includes(state.bookText?.state)) bookTextFor(player.getState().book, true);
    }, 8000);
  });
}

/**
 * What you've heard of this book so far (from the live transcript, if it ran):
 * earlier parts in full, the current part up to `time`. Keeps the last maxChars.
 */
export function heardText(bookUid, index, time, maxChars = 14000) {
  // The publisher's transcript: what was said up to now (untimed: all of it).
  if (state.key === `${bookUid}#pub` && state.segments.length) {
    const all = state.segments.filter((s) => s.start == null || s.start <= time).map((s) => s.text).join(' ');
    return all.length > maxChars ? '…' + all.slice(-maxChars) : all;
  }
  const parts = saved.get().parts || {};
  const chunks = [];
  for (let i = 0; i <= index; i++) {
    const key = `${bookUid}#${i}`;
    const segs = key === state.key && state.segments.length ? state.segments : parts[key] || [];
    const upto = i < index ? segs : segs.filter((s) => s.start <= time);
    if (upto.length) chunks.push(upto.map((s) => s.text).join(' '));
  }
  const all = chunks.join('\n\n');
  return all.length > maxChars ? '…' + all.slice(-maxChars) : all;
}

/** Every line heard of this book so far, with its part: [{ track, start, text }] (X-Ray, voice command). */
export function heardLines(bookUid) {
  const parts = saved.get().parts || {};
  const out = [];
  const keys = new Set(Object.keys(parts).filter((k) => k.startsWith(bookUid + '#')));
  if (state.key.startsWith(bookUid + '#')) keys.add(state.key);
  for (const key of keys) {
    const track = +key.slice(bookUid.length + 1);
    if (!Number.isInteger(track)) continue;
    const segs = key === state.key && state.segments.length ? state.segments : parts[key] || [];
    for (const s of segs) if (s.start != null) out.push({ track, start: s.start, text: s.book || s.text });
  }
  return out.sort((a, b) => a.track - b.track || a.start - b.start);
}

// ---- names the recogniser mishears ("snake" for Snape) ------------------------------
// A heard word one letter off a character's name (two for long names), with the same
// first letter, is shown as the name. With the ebook on hand, only when the book uses the
// name far more often than the word (so a real snake stays a snake).
const lev = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};
let counts = null;
let countsOf = null;
const bookCount = (w) => {
  if (!bt) return null;
  if (countsOf !== bt) {
    counts = new Map();
    for (const t of bt.tokens) {
      const k = t.toLowerCase().replace(/[^\p{L}']/gu, '');
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    countsOf = bt;
  }
  return counts.get(w) || 0;
};
// Names that are everyday words too: changed only when the ebook shows it's the name.
const COMMON = new Set('will hope grace rose mark bill faith dawn june april summer rich frank jack page brown white black green young king wood stone hill field ford hunter baker cook miller smith carter mason fisher bishop cole lane long hall bell gray grey north west east south lord lady sage river storm star wolf fox bear hawk crow swift may sunny holly ivy lily daisy violet ruby pearl amber jade autumn winter'.split(' '));
const fixCache = new Map();
/** `text` with misheard character names put right. `names`: the book's people and places. */
export function fixHeard(text, names) {
  if (!text || !names?.length) return text;
  const single = [...new Set(names.flatMap((n) => n.split(/\s+/)).filter((n) => n.length >= 4 && /^\p{Lu}/u.test(n)))];
  const key = single.join('|');
  if (fixCache.get('k') !== key) fixCache.clear(), fixCache.set('k', key);
  return text.replace(/\p{L}[\p{L}']{3,}/gu, (w) => {
    const lw = w.toLowerCase();
    if (fixCache.has(lw)) return fixCache.get(lw) || w;
    let best = null;
    for (const n of single) {
      const ln = n.toLowerCase();
      if (ln === lw) {
        best = w === n ? null : { n, d: 0 }; // "harry" → "Harry"
        break;
      }
      if (ln[0] !== lw[0]) continue;
      const d = lev(lw, ln);
      if (d <= (ln.length >= 7 ? 2 : 1) && (!best || d < best.d)) best = { n, d };
    }
    let out = '';
    if (best) {
      const asWord = bookCount(lw);
      if (COMMON.has(lw) && (asWord == null || bookCount(best.n.toLowerCase()) <= asWord * 3)) best = null;
    }
    if (best) {
      const asWord = bookCount(lw);
      const asName = bookCount(best.n.toLowerCase());
      if (best.d === 0 || asWord == null || asName > Math.max(3, asWord * 3)) out = best.n;
    }
    fixCache.set(lw, out);
    return out || w;
  });
}

/** Stop looking for this book's ebook (the lines stay as heard; Get the ebook to choose one). */
export function stopLooking() {
  btRun++;
  set({ bookText: { state: 'none' } });
}
