// "What's new": a short walk-through of this update, shown once after it arrives
// (and any time from Settings → About → What's new). Swipe or tap Next.
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Icon } from './icons.jsx';
import { persisted, useStore } from '../lib/store.js';
import { useBackClose } from '../lib/nav.js';

// Change the id for the next update's notes: everyone sees them once.
const EDITION = 'nov-2026f';
const seen = persisted('whatsNewSeen', '');

const STEPS = [
  {
    icon: 'home',
    title: 'A new Home, Discover and Library',
    bold: 'Calmer pages, made around what you’re listening to.',
    text: 'Home leads with your book and what’s close to finished. Discover has tabs for you, top lists, new books and moods. The Library opens on a front page — continue, read later, your shelves — with the full list one tap away. Podcasts got the same new look.',
  },
  {
    icon: 'book',
    title: 'Book pages, authors and narrators',
    text: 'The book page opens on its cover’s colour, with 👍 / 👎 and names you can tap. Authors and narrators have their own pages: their books, a photo (pick one or add your own) and Follow, so their new books show up for you.',
  },
  {
    icon: 'play',
    title: 'A player in the cover’s colours',
    text: 'The controls take the cover’s colour, a ring shows how far through the chapter you are, and the minutes left in the chapter sit under it. At night the player turns dark and warm with bigger buttons, and dims itself after a little while (tap to wake).',
  },
  {
    icon: 'replay',
    title: 'Back a little, credits skipped, caught up',
    text: 'After a pause it starts a few seconds back (longer after a long break), so you never lose a sentence. Opening and closing credits can be skipped, and if the sleep timer stopped the book, “Catch me up” tells you what you missed in the last minutes before it stopped.',
  },
  {
    icon: 'bookmark',
    title: 'Bookmarks with names',
    text: 'Bookmarks name themselves from what was being said, with a ribbon on the chapter bar and a button in Live text. Live text itself keeps its place better and follows the narrator more smoothly.',
  },
  {
    icon: 'sparkle',
    title: 'Motion',
    text: 'Small, light animations: play turning into pause, a ripple on skip, sparks on a like, the cover growing into the player. Settings → Appearance → Motion: Off, Gentle or Full (the phone’s “reduce motion” is respected).',
  },
  {
    icon: 'covers',
    title: 'Covers and finding your copy',
    text: 'Missing covers are filled in by themselves, and Audiobookshelf covers stop disappearing. Your own copy is found even when titles differ in punctuation or a subtitle after a dash, an offline server no longer holds things up, Read later removals stay removed on every device, and a problem report now includes a short log.',
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
