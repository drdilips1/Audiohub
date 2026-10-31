// This book's notes, inside the reader and the player: ebook highlights (with your notes)
// and audiobook bookmarks / transcript quotes — including those made in the other form
// of the same book (its audiobook while reading, its ebook while listening).
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { bookmarks, highlights, useStore } from '../lib/store.js';
import { forWork, removeHighlight, updateHighlight } from '../lib/highlights.js';
import { sameWork } from '../lib/works.js';
import { nav } from '../lib/nav.js';
import { shareQuote } from '../lib/quoteshare.js';
import { Rows, bookOf } from './bookmarks.jsx';

const short = (t, n) => (t.length > n ? t.slice(0, n) + '…' : t);

function shareHighlight(h) {
  shareQuote({ kind: 'text', title: h.book?.title || 'A book', author: h.book?.author || '', cover: h.book?.cover || '', quote: h.text, note: h.note || '' })
    .then((r) => r === 'copied' && toast('Copied — paste it anywhere'))
    .catch((e) => toast(e.message));
}

/** Ebook highlights of this book (any copy). `onOpen(h)` goes to one; else opens the reader there. */
export function HighlightCards({ book, onOpen, title }) {
  useStore(highlights);
  const list = forWork(book, sameWork).sort((a, b) => (a.home === b.home ? a.parts[0].a - b.parts[0].a : a.elsewhere ? 1 : -1));
  if (!list.length) return null;
  const open = (h) => (onOpen ? onOpen(h) : nav.push('reader', { book: h.book, at: h.parts[0].a }));
  const cards = list.map((h) => {
    const uid = h.home || h.book?.uid || book.uid;
    return (
      <div class="note-card">
        <button class="note-quote" onClick={() => open(h)}>
          “{short(h.text, 400)}”
        </button>
        {h.note && <p class="note-text">{h.note}</p>}
        <div class="note-foot">
          <small>{new Date(h.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small>
          <span>
            <button class="icon-btn" aria-label="Share" onClick={() => shareHighlight(h)}>
              <Icon name="upload" size={15} />
            </button>
            <button
              class="icon-btn"
              aria-label={h.note ? 'Edit note' : 'Add a note'}
              onClick={() => {
                const note = window.prompt('Your note', h.note || '');
                if (note != null) updateHighlight(uid, h.id, { note: note.trim() });
              }}
            >
              <Icon name="edit" size={15} />
            </button>
            <button class="icon-btn" aria-label="Delete highlight" onClick={() => confirm('Delete this highlight?') && removeHighlight(uid, h.id)}>
              <Icon name="trash" size={15} />
            </button>
          </span>
        </div>
      </div>
    );
  });
  return (
    <>
      {title && <h4 class="section-label">{title}</h4>}
      {cards}
    </>
  );
}

/** Bookmarks and transcript quotes of this book's audiobook(s), other than `except` (the one playing). */
const audioGroups = (all, book, except) =>
  Object.entries(all)
    .filter(([uid, list]) => uid !== except && list?.length)
    .map(([uid, list]) => ({ uid, list, book: bookOf(uid) }))
    .filter((g) => g.book && g.book.kind !== 'text' && (g.uid === book.uid || sameWork(g.book, book)));

export const hasAudioNotes = (book) => audioGroups(bookmarks.get(), book).length > 0;

export function AudioNotes({ book, except, onPlay, title }) {
  const groups = audioGroups(useStore(bookmarks), book, except);
  if (!groups.length) return null;
  return (
    <>
      {title && <h4 class="section-label">{title}</h4>}
      {groups.map((g) => (
        <Rows uid={g.uid} book={g.book} list={g.list} onPlay={onPlay} />
      ))}
    </>
  );
}

/** Counts for a button label: highlights of the work + audiobook bookmarks of the work. */
export function useBookNoteCount(book) {
  useStore(highlights);
  const all = useStore(bookmarks);
  if (!book) return 0;
  let n = forWork(book, sameWork).length;
  for (const [uid, list] of Object.entries(all)) {
    if (!list?.length) continue;
    const b = uid === book.uid ? book : bookOf(uid);
    if (b && b.kind !== 'text' && (uid === book.uid || sameWork(b, book))) n += list.length;
  }
  return n;
}
