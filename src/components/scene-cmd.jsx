// The voice button (Home, the player, the widget): tap and speak — a command for what's
// playing ("back 30 seconds"), a book to play, a scene ("when Harry finds the mirror"), or a
// question for Ask AI. Long-press it to type instead.
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { nav, useBackClose } from '../lib/nav.js';
import { aiReady } from '../lib/ai.js';
import { canListen, listen } from '../lib/voiceask.js';
import * as player from '../lib/player.js';

/** Do whatever was said (or typed). */
export async function runSaid(said) {
  if (!said.trim()) return;
  try {
    const { runCommand } = await import('../lib/voicecmd.js');
    const r = await runCommand(said, (t) => (t.startsWith('Opening') || t.startsWith('Working')) && toast(t === 'Working it out…' ? `🎧 “${said.trim().slice(0, 60)}”…` : t), aiReady());
    if (r.message) return toast(r.message);
    if (r.find) {
      // Books to find or recommend: Discover, with the bookseller's answer and your sources.
      nav.closeOverlay();
      const [{ openSearch }, { askNow }] = await Promise.all([import('../screens/Discover.jsx'), import('./bookseller.jsx')]);
      openSearch(r.query);
      askNow(r.query);
      return;
    }
    if (r.question) {
      // A question: Ask AI answers it and reads the answer out.
      if (player.getState().playing) player.pause();
      nav.closeOverlay();
      return nav.push('ask', { book: r.book, description: r.book?.description || '', question: said.trim(), here: !!r.here, askId: `${Date.now()}`, voice: true });
    }
    nav.openOverlay('player');
    toast(`▶ ${r.scene || r.book.title}${r.where ? ` · ${r.where}` : ''}`);
  } catch (e) {
    toast(e.message);
    if (e.want) import('../screens/Discover.jsx').then((m) => m.openSearch(`${e.want.title} ${e.want.author || ''}`.trim()));
  }
}

let listening = false;
/** Listen once and do what was said. Without a microphone, the box to type in opens. */
export async function voiceNow() {
  if (!canListen()) return openScene(false);
  if (listening) return;
  listening = true;
  toast('🎙 Listening…');
  let said = '';
  try {
    said = (await listen('Say a command, a book or a question')).trim();
  } catch (e) {
    toast(e.message || 'Voice input failed');
  }
  listening = false;
  if (said) runSaid(said);
}

/** chip: the player's small button, else Home's round one. Tap: speak. Long-press: type. */
export function SceneButton({ chip = false }) {
  const [open, setOpen] = useState(false);
  const held = useRef(null);
  const long = useRef(false);
  const press = {
    onPointerDown: () => {
      long.current = false;
      held.current = setTimeout(() => ((long.current = true), setOpen(true)), 550);
    },
    onPointerUp: () => clearTimeout(held.current),
    onPointerLeave: () => clearTimeout(held.current),
    onContextMenu: (e) => e.preventDefault(),
    onClick: () => !long.current && voiceNow(),
  };
  return (
    <>
      {chip ? (
        <button class="chip-btn" {...press} aria-label="Voice: speak a command, a book or a question (hold to type)">
          <Icon name="mic" size={16} /> Voice
        </button>
      ) : (
        <button class="icon-btn glass" {...press} aria-label="Voice: speak a command, a book or a question (hold to type)">
          <Icon name="mic" />
        </button>
      )}
      {open && createPortal(<SceneSheet close={() => setOpen(false)} />, document.body)}
    </>
  );
}

// Opened from outside (the widget, the app-icon shortcut).
const hostSubs = new Set();
let pending = null; // asked for before the app had drawn (opened from the widget)
/** From the widget: listen straight away (`listenNow`), else the box to type in. */
export function openScene(listenNow = false) {
  if (listenNow) {
    // Give the app a moment to come to the front before the microphone opens.
    return setTimeout(voiceNow, hostSubs.size ? 200 : 900);
  }
  if (!hostSubs.size) pending = { listenNow };
  hostSubs.forEach((f) => f({ listenNow }));
}
export function SceneHost() {
  const [req, setReq] = useState(() => pending);
  useEffect(() => {
    pending = null;
    hostSubs.add(setReq);
    return () => hostSubs.delete(setReq);
  }, []);
  return req ? createPortal(<SceneSheet close={() => setReq(null)} />, document.body) : null;
}

function SceneSheet({ close }) {
  useBackClose(true, close);
  const [text, setText] = useState('');
  const go = (t) => {
    if (!t.trim()) return;
    close();
    runSaid(t);
  };
  return (
    <div class="sheet-backdrop" onClick={close}>
      <div class="sheet scene-cmd" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <h3>Type a command</h3>
        <p class="muted small">A book to play, a book to find, a question about a book, or “back 30 seconds”, “next chapter”, “chapter 7”, “speed 1.5”, “sleep in 20 minutes”. Tap 🎤 to just say it.</p>
        <form
          class="scene-form"
          onSubmit={(e) => {
            e.preventDefault();
            go(text);
          }}
        >
          <textarea rows={2} value={text} autoFocus placeholder="A book, a question or a command" onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), go(text))} />
          <div class="scene-btns">
            <button type="submit" class="btn primary" disabled={!text.trim()}>
              <Icon name="play" size={16} /> Go
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
