// "What's new": a short walk-through of this update, shown once after it arrives
// (and any time from Settings → About → What's new). Swipe or tap Next.
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Icon } from './icons.jsx';
import { persisted, useStore } from '../lib/store.js';
import { useBackClose } from '../lib/nav.js';

// Change the id for the next update's notes: everyone sees them once.
const EDITION = 'nov-2026d';
const seen = persisted('whatsNewSeen', '');

const STEPS = [
  {
    icon: 'sparkle',
    title: 'Audiohub is now AudioYam',
    bold: 'Same app, new name — your library, progress, settings and connections are all here.',
    text: 'Another audiobook app already used the name Audiohub, so this one now has a name of its own. Updates keep coming as before.',
  },
  {
    icon: 'headphones',
    title: 'Plays the copy on your phone first',
    text: 'Resume a book (Continue, the mini player, Library) and AudioYam plays the copy in your phone folders when it has one — offline, no buffering, from the same place. Tapping a TorBox or Audiobookshelf copy on the book page still plays that copy.',
  },
  {
    icon: 'covers',
    title: 'Your own cover pictures',
    text: 'Don’t like a cover? Press and hold a book → Find a better cover & details → Or choose your own picture from the phone. It shows everywhere: cards, the book page and the player.',
  },
  {
    icon: 'palette',
    title: 'Easier to read',
    text: 'Pop-up menus are readable in light themes, the reader’s voice list is readable on dark pages, and the read-aloud bar is slim again.',
  },
];

let openNow = null;
/** Show the walk-through again (Settings). */
export const showWhatsNew = () => openNow?.();

export function WhatsNew() {
  const s = useStore(seen);
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => {
    openNow = () => (setI(0), setOpen(true));
    // A moment after the app opens, once per update.
    const t = s !== EDITION ? setTimeout(() => setOpen(true), 1200) : null;
    return () => clearTimeout(t);
  }, []);
  const close = () => {
    seen.set(EDITION);
    setOpen(false);
  };
  useBackClose(open, close);
  if (!open) return null;
  const st = STEPS[i];
  const last = i === STEPS.length - 1;
  let x0 = null;
  return createPortal(
    <div class="sheet-backdrop" onClick={close}>
      <div
        class="sheet whats-new"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => (x0 = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (x0 == null) return;
          const dx = e.changedTouches[0].clientX - x0;
          if (dx < -50 && !last) setI(i + 1);
          if (dx > 50 && i > 0) setI(i - 1);
          x0 = null;
        }}
      >
        <div class="sheet-handle" />
        <small class="wn-kicker">What’s new in AudioYam · {i + 1} of {STEPS.length}</small>
        <div class="wn-icon">
          <Icon name={st.icon} size={30} />
        </div>
        <h3>{st.title}</h3>
        {st.bold && (
          <p>
            <b>{st.bold}</b>
          </p>
        )}
        <p>{st.text}</p>
        {st.tip && <p class="wn-tip">💡 {st.tip}</p>}
        <div class="wn-dots">
          {STEPS.map((_, k) => (
            <span class={k === i ? 'on' : ''} onClick={() => setI(k)} />
          ))}
        </div>
        <div class="wn-btns">
          <button class="btn secondary" onClick={close}>
            {last ? 'Close' : 'Skip'}
          </button>
          <button class="btn primary" onClick={() => (last ? close() : setI(i + 1))}>
            {last ? 'Start listening' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
