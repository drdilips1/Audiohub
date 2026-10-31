// Press and hold a book (Home, Library, search) for its actions: play, download, tag,
// library, finished / reset, details, take off Continue.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { Cover, toast } from './common.jsx';
import { useStore, library, progress, bookTags, toggleLibrary, hideFromContinue, summarize } from '../lib/store.js';
import { nav, useBackClose } from '../lib/nav.js';
import { allTags } from './book-tags.jsx';
import { FixDetails } from './fix-details.jsx';

// The book whose sheet is open (not saved).
let current = null;
const subs = new Set();
const sheet = { get: () => current, set: (v) => ((current = v), subs.forEach((f) => f(v))), subscribe: (f) => (subs.add(f), () => subs.delete(f)) };
export const openBookActions = (book) => book?.uid && sheet.set(book);

/** Long-press handlers for a card: `{ onPointerDown, …, onClickCapture }` (a hold doesn't also open the book). */
export function longPress(getBook) {
  let timer = null;
  let fired = false;
  let start = null;
  const cancel = () => clearTimeout(timer);
  return {
    onPointerDown: (e) => {
      fired = false;
      start = [e.clientX, e.clientY];
      cancel();
      timer = setTimeout(() => {
        fired = true;
        navigator.vibrate?.(12);
        openBookActions(getBook());
      }, 480);
    },
    onPointerMove: (e) => start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10 && cancel(),
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e) => e.preventDefault(),
    onClickCapture: (e) => {
      if (fired) {
        e.preventDefault();
        e.stopPropagation();
        fired = false;
      }
    },
  };
}

const ebookOnly = (b) => b.kind === 'text';

export function BookActionsSheet() {
  const book = useStore(sheet);
  const lib = useStore(library);
  const prog = useStore(progress);
  const [busy, setBusy] = useState('');
  const [fixing, setFixing] = useState(false);
  const close = () => (setFixing(false), sheet.set(null));
  useBackClose(!!book, close);
  useEffect(() => (setBusy(''), setFixing(false)), [book?.uid]);
  if (!book) return null;
  const p = prog[book.uid];
  const pct = p ? Math.round((p.percent || 0) * 100) : 0;
  const saved = !!lib[book.uid];
  const act = (fn) => () => {
    close();
    fn();
  };
  const details = async () => (await import('../sources/index.js')).getDetails(book);
  const play = async () => {
    if (ebookOnly(book)) return act(() => nav.push('reader', { book }))();
    setBusy('play');
    try {
      const d = await details();
      const player = await import('../lib/player.js');
      close();
      nav.openOverlay('player');
      player.playBook(d);
    } catch (e) {
      toast(e.message);
      setBusy('');
    }
  };
  const download = async () => {
    setBusy('dl');
    try {
      const d = await details();
      close();
      toast('Downloading — see Library → On this phone');
      const { downloadBook } = await import('../lib/downloads.js');
      await downloadBook(d);
    } catch (e) {
      if (e.message !== 'cancelled') toast(e.message);
      setBusy('');
    }
  };
  const tag = () => {
    const have = bookTags.get()[book.uid] || [];
    const others = allTags().filter((t) => !have.includes(t)).slice(0, 8);
    const t = window.prompt(`Tag “${book.title}”${others.length ? `\nYour tags: ${others.join(', ')}` : ''}`, '');
    const tag = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!tag) return;
    if (!have.some((x) => x.toLowerCase() === tag.toLowerCase())) bookTags.set((all) => ({ ...all, [book.uid]: [...have, tag] }));
    toast(`Tagged ${tag}`);
    close();
  };
  const setDone = (finished) =>
    progress.set((all) => ({
      ...all,
      [book.uid]: { ...(all[book.uid] || { book: summarize(book), kind: book.kind }), ...(finished ? { finished: true, percent: 1 } : { finished: false, percent: 0, track: 0, time: 0 }), hidden: false, updatedAt: Date.now() },
    }));
  const canDownload = !ebookOnly(book) && !['loc', 'tts', 'pod', 'sum', 'discover'].includes(book.source) && book.kind !== 'discover';
  return (
    <div class="sheet-backdrop" onClick={close}>
      <div class="sheet book-actions" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <div class="ba-book">
          <Cover book={book} />
          <span>
            <b>{book.title}</b>
            <small>{[book.author, pct ? `${pct}%` : p?.finished ? 'finished' : ''].filter(Boolean).join(' · ')}</small>
          </span>
        </div>
        <button class="menu-item" disabled={!!busy} onClick={play}>
          {busy === 'play' ? <span class="spinner small" /> : <Icon name={ebookOnly(book) ? 'book' : 'play'} size={18} />} {ebookOnly(book) ? 'Read' : pct ? 'Continue' : 'Play'}
        </button>
        {canDownload && (
          <button class="menu-item" disabled={!!busy} onClick={download}>
            {busy === 'dl' ? <span class="spinner small" /> : <Icon name="download" size={18} />} Download
          </button>
        )}
        <button class="menu-item" onClick={act(() => (toggleLibrary(book), toast(saved ? 'Removed from your library' : 'Added to your library')))}>
          <Icon name="heart" size={18} fill={saved} /> {saved ? 'Remove from library' : 'Add to library'}
        </button>
        <button class="menu-item" onClick={tag}>
          <Icon name="plus" size={18} /> Add a tag
        </button>
        {p?.finished ? (
          <button class="menu-item" onClick={act(() => (setDone(false), toast('Marked as not finished')))}>
            <Icon name="check" size={18} /> Mark as not finished
          </button>
        ) : (
          <button class="menu-item" onClick={act(() => (setDone(true), toast('Marked as finished')))}>
            <Icon name="check" size={18} /> Mark as finished
          </button>
        )}
        {pct > 0 && (
          <button class="menu-item" onClick={act(() => confirm(`Start “${book.title}” from the beginning?`) && (setDone(false), toast('Progress reset')))}>
            <Icon name="replay" size={18} /> Reset progress
          </button>
        )}
        {fixing ? (
          <FixDetails book={book} autoOpen onDone={close} />
        ) : (
          <button class="menu-item" onClick={() => setFixing(true)}>
            <Icon name="covers" size={18} /> {book.cover ? 'Find a better cover & details' : 'Find cover & details'}
          </button>
        )}
        <button class="menu-item" onClick={act(() => nav.push('book', { book }))}>
          <Icon name="info" size={18} /> Details
        </button>
        {p && !p.hidden && (
          <button class="menu-item danger" onClick={act(() => (hideFromContinue([book.uid]), toast('Taken off Continue listening')))}>
            <Icon name="close" size={18} /> Remove from Continue listening
          </button>
        )}
      </div>
    </div>
  );
}
