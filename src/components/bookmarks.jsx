// Bookmarks outside the player: on the book's page and in Notes. Tap one to play the
// book from that moment (straight in if it's the book playing now).
import { Icon } from './icons.jsx';
import { Cover, toast } from './common.jsx';
import { bookmarks, progress, library, useStore } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { fmtTime } from '../lib/format.js';
import * as player from '../lib/player.js';
import { getDetails } from '../sources/index.js';

/** The book a bookmark belongs to (from what you've played or saved). */
export const bookOf = (uid) => (player.getState().book?.uid === uid && player.getState().book) || progress.get()[uid]?.book || library.get()[uid] || null;

export function playBookmark(book, bm) {
  if (!book) return toast('Open this book once to use its bookmarks');
  nav.openOverlay('player');
  if (player.getState().book?.uid === book.uid && player.getState().tracks.length) player.playBookmark(bm);
  else player.openAndPlay(book, getDetails, bm.time >= player.BOOKMARK_LEAD || !bm.track ? { index: bm.track, time: Math.max(0, bm.time - player.BOOKMARK_LEAD) } : { globalStart: Math.max(0, (bm.global ?? 0) - player.BOOKMARK_LEAD) });
}

/** Your own note on a bookmark (empty removes it). */
export function noteBookmark(uid, bm) {
  const note = window.prompt('Note for this bookmark', bm.note || '');
  if (note == null) return;
  bookmarks.set((all) => ({ ...all, [uid]: (all[uid] || []).map((b) => (b.createdAt === bm.createdAt ? { ...b, note: note.trim() } : b)) }));
}

const remove = (uid, bm) => bookmarks.set((all) => ({ ...all, [uid]: (all[uid] || []).filter((b) => b.createdAt !== bm.createdAt) }));

/** Bookmark rows: tap to play from there, ✎ to add a note, bin to delete. */
export function Rows({ uid, book, list, onPlay }) {
  return (
    <ol class="chapter-list bm-list">
      {list.map((bm) => (
        <li>
          <button onClick={() => (playBookmark(book, bm), onPlay?.())}>
            <span class="ch-num">
              <Icon name="bookmark" size={14} />
            </span>
            <span class="ch-title">
              {bm.label}
              {bm.note && <small class="bm-note">{bm.note}</small>}
            </span>
            <span class="ch-time">{fmtTime(bm.global ?? bm.time)}</span>
          </button>
          <button class="icon-btn" aria-label={bm.note ? 'Edit note' : 'Add a note'} onClick={() => noteBookmark(uid, bm)}>
            <Icon name="edit" size={16} />
          </button>
          <button class="icon-btn" aria-label="Delete bookmark" onClick={() => confirm('Delete this bookmark?') && remove(uid, bm)}>
            <Icon name="trash" size={16} />
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The book page's "Bookmarks" section (nothing when there are none). */
export function BookBookmarks({ book }) {
  const all = useStore(bookmarks);
  const list = all[book.uid] || [];
  if (!list.length) return null;
  return (
    <section class="pad">
      <h3 class="section-label">Bookmarks · {list.length}</h3>
      <Rows uid={book.uid} book={book} list={list} />
    </section>
  );
}

/** Every bookmark, by book (newest first), for Notes. */
export function AllBookmarks({ q = '' }) {
  const all = useStore(bookmarks);
  useStore(progress);
  const words = q.toLowerCase().trim();
  const groups = Object.entries(all)
    .map(([uid, list]) => {
      const book = bookOf(uid);
      const items = (list || []).filter((bm) => !words || `${bm.label} ${book?.title || ''} ${book?.author || ''}`.toLowerCase().includes(words));
      return { uid, book, items, last: Math.max(0, ...(list || []).map((b) => b.createdAt || 0)) };
    })
    .filter((g) => g.items.length)
    .sort((a, b) => b.last - a.last);
  if (!groups.length)
    return <p class="muted pad">{words ? `Nothing matches “${q}”.` : 'While listening, tap 🔖 in the player to bookmark a moment. Your bookmarks collect here, named after what was happening.'}</p>;
  return groups.map(({ uid, book, items }) => (
    <section class="notes-book">
      <button class="notes-book-head" onClick={() => book && nav.push('book', { book })}>
        <Cover book={book || { title: 'Book' }} />
        <div>
          <b>{book?.title || 'A book'}</b>
          <small>
            {book?.author ? `${book.author} · ` : ''}
            {items.length} bookmark{items.length > 1 ? 's' : ''}
          </small>
        </div>
      </button>
      <Rows uid={uid} book={book} list={items} />
    </section>
  ));
}

/** All bookmarks as Markdown (for Notes → Export). */
export function bookmarksMarkdown() {
  const out = ['# My bookmarks', ''];
  for (const [uid, list] of Object.entries(bookmarks.get() || {})) {
    if (!list?.length) continue;
    const b = bookOf(uid);
    out.push(`## ${b?.title || 'Book'}${b?.author ? ` — ${b.author}` : ''}`, '');
    for (const bm of list) {
      out.push(`- **${fmtTime(bm.global ?? bm.time)}** ${bm.label}`);
      if (bm.note) out.push(`  ${bm.note}`);
    }
    out.push('');
  }
  return out.length > 2 ? out.join('\n') : '';
}
