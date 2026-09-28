// Live transcript: the audiobook's words scroll along as it plays. Speech is
// recognised on the phone (sherpa-onnx; models downloaded once in the app),
// a little ahead of the playback position.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { persisted } from './store.js';
import { installedIds, download as downloadPackage, remove as removePackage, builtinAvailable } from './voices.js';
import * as player from './player.js';
import { isHindi } from '../screens/hindi.js';

const T = registerPlugin('InkwellTranscribe');
export const transcriptAvailable = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellTranscribe') && builtinAvailable;

const ASR = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/';

/** Speech-recognition models you can download in the app. */
export const MODELS = [
  {
    id: 'asr-moonshine-tiny-en',
    name: 'English',
    what: 'Moonshine · fast and accurate for English audiobooks',
    size: '≈ 100 MB',
    type: 'moonshine',
    url: ASR + 'sherpa-onnx-moonshine-tiny-en-int8.tar.bz2',
    languages: ['en'],
  },
  {
    id: 'asr-whisper-base',
    name: 'Hindi + 90 languages',
    what: 'Whisper base · हिंदी and other languages · slower',
    size: '≈ 200–300 MB',
    type: 'whisper',
    url: ASR + 'sherpa-onnx-whisper-base.tar.bz2',
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
      for (const k of order) parts[k] = k === key ? segments.slice(-2500) : c.parts[k];
      return { order, parts };
    });
  }, 3000);
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
  try {
    await T.start({
      job,
      url: t.url,
      headers: t.headers || {},
      model: m.id,
      type: m.type,
      language: m.type === 'whisper' ? lang : 'en',
      start: at,
      ahead: 90,
    });
  } catch (e) {
    set({ status: 'error', error: e.message });
  }
}

/**
 * Keep the transcript in step with the player. Called on every player update
 * while the transcript is on screen.
 */
export function follow(ps) {
  if (!transcriptAvailable || !ps.book) return;
  const key = `${ps.book.uid}#${ps.index}`;
  const from = () => {
    const c = coveredUntil(ps.time);
    return c != null ? Math.max(0, c - 1) : Math.max(0, ps.time - 2);
  };
  if (key !== state.key) {
    stopTranscript();
    set({ key, segments: (saved.get().parts[key] || []).slice(), status: 'idle', error: '' });
    return startJob(ps, from());
  }
  if (state.status === 'no-model' || state.status === 'loading' || state.status === 'error') return;
  if (state.status === 'waiting' || state.status === 'idle') return startJob(ps, from());
  const segs = state.segments;
  const frontier = segs.reduce((m, x) => (x.start >= jobStart - 1 ? Math.max(m, x.end) : m), jobStart);
  const covered = coveredUntil(ps.time);
  // Jumped somewhere this job won't reach soon (and that isn't transcribed yet): start from there.
  const behind = ps.time < jobStart - 1 && (covered == null || covered < jobStart - 1);
  const ahead = ps.time > frontier + 45 && state.status !== 'done';
  if (behind || ahead) return startJob(ps, from());
  T.position({ pos: ps.time }).catch(() => {});
}

export function stopTranscript() {
  if (!transcriptAvailable) return;
  job = '';
  T.stop().catch(() => {});
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
if (transcriptAvailable) {
  let last = 0;
  player.subscribe((ps) => {
    if (!transcriptCfg.get().open || !ps.book) return;
    const now = Date.now();
    if (now - last < 1000 && ps.index === player.getState().index && `${ps.book.uid}#${ps.index}` === state.key) return;
    last = now;
    follow(ps);
  });
}

/**
 * What you've heard of this book so far (from the live transcript, if it ran):
 * earlier parts in full, the current part up to `time`. Keeps the last maxChars.
 */
export function heardText(bookUid, index, time, maxChars = 14000) {
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
