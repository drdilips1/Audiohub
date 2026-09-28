// Read along: speaks the reader's paragraphs with the chosen free voice.
// Built-in voices render a few sentences ahead while the current one plays, so
// there are no gaps; a clip that fails is retried once and then skipped
// instead of stopping the reading.
import { speak, stopSpeaking, canPrepare, prepareClip, playClip, splitLong, speakable, blockText, nativeReader, Reader, voiceSpec, ttsCfg } from './tts.js';

// ---- Android: the native engine reads by itself (screen off, app closed) ----------
// The reader only hands over the paragraphs and follows along for highlighting.

/** Follow the native engine: calls onIndex when the paragraph changes. Returns a controller. */
function follow(elements, { onIndex, onDone, onError, onState } = {}) {
  let last = -1;
  let alive = true;
  const handle = Reader.addListener('state', (st) => {
    if (!alive) return;
    onState?.(st);
    if (st.active && st.para !== last && elements[st.para]) {
      last = st.para;
      onIndex?.(st.para, elements[st.para]);
    }
    if (st.finished) onDone?.();
    if (st.error && !st.playing && !st.finished) onError?.(new Error(st.error));
  });
  const ctl = {
    native: true,
    get index() {
      return Math.max(0, last);
    },
    pause: () => Reader.pause().catch(() => {}),
    resume: () => Reader.resume().catch(() => {}),
    seek: (i) => Reader.seek({ para: i }).catch(() => {}),
    setRate: (r) => Reader.setRate({ rate: r }).catch(() => {}),
    /** Stop reading. */
    stop() {
      alive = false;
      handle.then((h) => h.remove());
      return Reader.stop().catch(() => {});
    },
    /** Stop following (leaving the reader) but keep reading. */
    detach() {
      alive = false;
      handle.then((h) => h.remove());
    },
  };
  return ctl;
}

function nativeReadAloud(elements, from, handlers, meta) {
  const paras = elements.map((el) => blockText(el));
  const chapters = [];
  elements.forEach((el, i) => /^H[1-3]$/.test(el.tagName) && chapters.push({ para: i, title: speakable(el.textContent).slice(0, 80) }));
  const ctl = follow(elements, handlers);
  Reader.start({ uid: meta?.uid || '', title: meta?.title || '', paras, from, chapters, rate: ttsCfg.get().rate || 1, voice: voiceSpec() }).catch((e) => handlers.onError?.(e));
  return ctl;
}

/**
 * If the native engine is already reading this book (e.g. the reader was left and
 * reopened, or the app was closed), follow it instead of starting over.
 */
export async function attachAloud(uid, elements, handlers) {
  if (!nativeReader) return null;
  const st = await Reader.status().catch(() => null);
  if (!st?.active || st.uid !== uid) return null;
  const ctl = follow(elements, handlers);
  handlers.onState?.(st);
  if (elements[st.para]) handlers.onIndex?.(st.para, elements[st.para]);
  return ctl;
}

export function readAloud(elements, from, { onIndex, onDone, onError } = {}, meta = {}) {
  if (nativeReader) return nativeReadAloud(elements, from, { onIndex, onDone, onError }, meta);
  let stopped = false;
  let i = from;

  // Pieces of about a sentence or two, each tagged with its paragraph — split
  // as reading goes (a long book has thousands of paragraphs).
  const pieces = [];
  let nextEl = from;
  const fill = (n) => {
    while (pieces.length <= n && nextEl < elements.length) {
      const k = nextEl++;
      const text = speakable(elements[k].textContent);
      if (text) for (const t of splitLong(text, 320)) pieces.push({ k, t });
    }
    return n < pieces.length;
  };

  (async () => {
    if (canPrepare()) {
      const ready = new Map();
      const prep = (n) => {
        if (!fill(n) || ready.has(n)) return;
        const p = prepareClip(pieces[n].t).catch(() => prepareClip(pieces[n].t));
        p.catch(() => {});
        ready.set(n, p);
      };
      let failures = 0;
      for (let n = 0; fill(n) && !stopped; n++) {
        if (pieces[n].k !== i || n === 0) {
          i = pieces[n].k;
          onIndex?.(i, elements[i]);
        }
        for (let a = 0; a <= 3; a++) prep(n + a); // keep three pieces ready ahead
        try {
          const uri = await ready.get(n);
          if (stopped) break;
          await playClip(uri, pieces[n].t.split(' ').length);
          failures = 0;
        } catch (e) {
          if (stopped || e?.message === 'stopped') return;
          // Skip a piece that won't render or play; give up only if nothing works.
          if (++failures >= 4) return onError?.(e);
        }
        ready.delete(n);
      }
      if (!stopped) onDone?.();
      return;
    }
    // Phone TTS engine: it queues and speaks by itself, paragraph by paragraph.
    while (!stopped && i < elements.length) {
      const el = elements[i];
      onIndex?.(i, el);
      const text = speakable(el.textContent);
      if (text) {
        try {
          await speak(text);
        } catch (e) {
          if (stopped || e?.message === 'stopped') return;
          try {
            await speak(text);
          } catch (e2) {
            if (!stopped) onError?.(e2);
            return;
          }
        }
      }
      if (!stopped) i++;
    }
    if (!stopped) onDone?.();
  })();
  return {
    stop() {
      stopped = true;
      stopSpeaking();
    },
    get index() {
      return i;
    },
  };
}
