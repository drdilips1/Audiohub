// "What's new": a short walk-through of this update, shown once after it arrives
// (and any time from Settings → About → What's new). Swipe or tap Next.
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Icon } from './icons.jsx';
import { persisted, useStore } from '../lib/store.js';
import { useBackClose } from '../lib/nav.js';

// Change the id for the next update's notes: everyone sees them once.
const EDITION = 'nov-2026e';
const seen = persisted('whatsNewSeen', '');

const STEPS = [
  {
    icon: 'car',
    title: 'AudioYam in Android Auto',
    bold: 'Continue listening, Recently played, Downloaded and Now playing — in the car.',
    text: 'Tap a book or say “Hey Google, play … on AudioYam” and it plays from your place. Search in the car finds your Audiobookshelf even with the app closed, and your phone, cloud and sources with it running in the background. (Phone-installed app: turn on Unknown sources in Android Auto’s developer settings.)',
  },
  {
    icon: 'text',
    title: 'The transcript follows the ebook',
    text: 'Attach the ebook and its own text shows at once, then follows the narrator sentence by sentence — tap a sentence to play from there. Choosing the ebook shows the list (the book itself first, EPUB, smaller first) and attaches nothing until you pick.',
  },
  {
    icon: 'chart',
    title: 'Stats that add up, and when you’ll finish',
    text: 'All time and Most listened now include everything before the stats began — the same as the Library’s hours. A book’s page says when you started it and about when you’ll finish. Reading time counts page turns and reading along with the audiobook.',
  },
  {
    icon: 'bookmark',
    title: 'Read later, and the books you’ve read',
    text: 'Press and hold a book → Read later (Library → Read later). Settings → Books you’ve read → Paste list: your read list from notes, with ratings, shapes recommendations and shows in Finished. “Already read it” and “Not for me — fewer like this” on any book.',
  },
  {
    icon: 'ai',
    title: 'AI and voice: your call',
    text: 'Settings → AI: turn voice off (no mic, answers never read aloud) or AI off altogether — every AI button hidden, nothing sent anywhere. Recommendations still work.',
  },
  {
    icon: 'server',
    title: 'Send to Audiobookshelf',
    text: 'Press and hold a cloud book → Send to Audiobookshelf: a torrent goes to your home server’s qBittorrent; anything else is downloaded and uploaded into the folder you choose (Settings → Audiobookshelf → Send books to).',
  },
  {
    icon: 'palette',
    title: 'Theme dice, top lists and more',
    text: 'The palette on Home rolls a new look (hold to go back). Top and New audiobooks in Discover, the Podcasts tab can be hidden, your cloud rows show the newest first, and “Hey Google, play … on AudioYam” works on the phone too.',
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
