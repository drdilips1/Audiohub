// "What's new": a short walk-through of this update, shown once after it arrives
// (and any time from Settings → About → What's new). Swipe or tap Next.
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Icon } from './icons.jsx';
import { persisted, useStore } from '../lib/store.js';
import { useBackClose } from '../lib/nav.js';

// Change the id for the next update's notes: everyone sees them once.
const EDITION = 'nov-2026b';
const seen = persisted('whatsNewSeen', '');

const STEPS = [
  {
    icon: 'palette',
    title: 'A new look: Ivory & Gold',
    text: 'Warm ivory, ink text and an antique-gold accent. A new player — the cover in the middle, chapter and X-Ray as pills, an Ask · Explain · Find · X-Ray row and labelled buttons — and a full-screen Text view with a slim strip.',
    tip: 'Other colours are in Settings → Appearance. In Text, tap the cover at the bottom to get back to the player.',
  },
  {
    icon: 'list',
    title: 'Chapters in single-file books',
    text: 'M4B and MP3 books that are one long file now show their chapters — the kinds most converters write — and, when a file has none, the book’s published chapter list, fitted to its length.',
  },
  {
    icon: 'server',
    title: 'In step with Audiobookshelf',
    text: 'Listened further in Absorb or the web player? Audiohub carries on from there — when you open the book and when you press play after a break, even if you play it here from TorBox or a download. Your place here goes back to your server too.',
    tip: 'Server not answering? Play uses your copy on the phone or in TorBox / Real-Debrid instead.',
  },
  {
    icon: 'replay',
    title: 'Playback history',
    text: 'Player → More → History: every play, pause, skip, jump and sleep-timer stop, with the time and where you were. Fell asleep or bumped skip? Tap an entry to go back there.',
  },
  {
    icon: 'ai',
    title: 'Ask AI reads the book',
    text: 'With the ebook attached, Ask AI answers from the book’s own text (never past where you are, with No spoilers on), or from what you’ve heard. Answers say where they came from, and you can share, copy, listen or save them.',
  },
  {
    icon: 'headphones',
    title: 'Read along, and more',
    text: 'Open the ebook while its audiobook plays and tap “Follow the audio”: the paragraph being read lights up. Press and hold any cover for Play, Download, tags, finished, reset and more. Whole covers, not cut-off ones.',
    tip: 'Addon torrents now play through TorBox / Real-Debrid, and sources say “seeds ?” instead of hiding results they don’t know.',
  },
  {
    icon: 'book',
    title: 'Select by sliding',
    text: 'In an ebook, press on a word, hold a moment, then slide your finger — the selection follows it word by word (the page scrolls at the edges). Or tap Sentence, Paragraph or + Next to select exactly that.',
    tip: 'The buttons stay at the bottom, out of the way, and the page no longer jumps while you select.',
  },
  {
    icon: 'edit',
    title: 'This book’s notes, right there',
    text: 'In the reader, tap ✎ at the top; in the player, More → Notes. Highlights, notes and bookmarks of that book — from its ebook and its audiobook — to jump to or edit. Highlights are also saved in the app’s own files, so they can’t be lost, and they’re in backups and sync.',
    tip: 'All of them, for every book, are still in Notes.',
  },
  {
    icon: 'text',
    title: 'Translate into your language — and listen',
    text: 'Translate now works in Hindi, Bengali, Marathi, Tamil, Telugu, Gujarati, Urdu, Spanish, French and more, and 🔊 reads it in a natural voice. Text (T) → “Read this book in…” translates the whole book as you read, and Read aloud speaks it.',
    tip: 'While reading aloud, the 1× button on the bar changes the speed at once (up to 2×).',
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
        <small class="wn-kicker">What’s new in Audiohub · {i + 1} of {STEPS.length}</small>
        <div class="wn-icon">
          <Icon name={st.icon} size={30} />
        </div>
        <h3>{st.title}</h3>
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
