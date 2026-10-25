// "What's new": a short walk-through of this update, shown once after it arrives
// (and any time from Settings → About → What's new). Swipe or tap Next.
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Icon } from './icons.jsx';
import { persisted, useStore } from '../lib/store.js';
import { useBackClose } from '../lib/nav.js';

// Change the id for the next update's notes: everyone sees them once.
const EDITION = 'oct-2026';
const seen = persisted('whatsNewSeen', '');

const STEPS = [
  {
    icon: 'mic',
    title: 'One voice button for everything',
    text: 'Tap 🎤 on Home or in the player and just say it: “back 30 seconds”, “next chapter”, “chapter 7”, “speed 1.5”, “sleep in 20 minutes”, “bookmark”, “play Sapiens”, “find a book on consciousness” — or ask anything about a book. Hold the button to type instead.',
    tip: 'Add the Voice widget to your home screen: long-press the home screen → Widgets → Audiohub.',
  },
  {
    icon: 'car',
    title: 'Driving mode',
    text: 'Huge buttons, and one big area to ask out loud: the book pauses, you hear a short answer, and it carries on. Voice commands work here too.',
    tip: 'Open it with the car on Home or in the player, or long-press the app icon.',
  },
  {
    icon: 'text',
    title: 'A transcript in the book’s own words',
    text: 'Tap Text in the player to read along. When the book’s ebook is on hand (it’s found by itself), the transcript shows its exact words. Tap 🔍 to search everything you’ve heard and jump there.',
    tip: 'The current line is highlighted in the middle; tap any line to play from there.',
  },
  {
    icon: 'xray',
    title: 'X-Ray, recaps and Ask AI',
    text: 'X-Ray shows who and where is in the scene, and every chapter a character appears in. Story gives spoiler-free recaps — and after a break, a “welcome back” recap. Explain, Challenge and Rabbit hole answer about the part you’re hearing.',
    tip: 'AI uses your own free key: Groq, Gemini or OpenRouter (or Claude, or your own AI) in Settings → AI.',
  },
  {
    icon: 'bookmark',
    title: 'Bookmarks that say something',
    text: 'Bookmarks are named after what was being said, and you can add your own note (✎). Find them on the book page and in Notes, and export highlights, bookmarks and ideas as one file.',
    tip: 'Each audiobook also keeps its own speed and volume boost now.',
  },
  {
    icon: 'covers',
    title: 'Your library, your way',
    text: 'Show it as a list, a grid, covers only or shelves by author / series. Search your own books, use smart shelves (Not started, Short listens, Recently added), and fill in missing covers in one tap.',
    tip: 'Podcasts: rate episodes, get recommended ones, and let new episodes download by themselves on Wi-Fi.',
  },
  {
    icon: 'palette',
    title: 'More colours, and a few handy extras',
    text: 'Settings → Appearance has light and dark colour themes side by side; each mode keeps its own. Paste any MP3 / M4B or EPUB link in Discover to play or read it. Single-file M4B books now show their chapters.',
    tip: 'Your backup and sync work as before.',
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
