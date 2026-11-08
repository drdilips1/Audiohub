// Press and hold a book (Home, Library, search) for its actions: play, download, tag,
// library, finished / reset, details, take off Continue.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { Cover, toast } from './common.jsx';
import { useStore, library, progress, bookTags, toggleLibrary, hideFromContinue, summarize } from '../lib/store.js';
import { nav, useBackClose } from '../lib/nav.js';
import { allTags } from './book-tags.jsx';
import { FixDetails } from './fix-details.jsx';
import { upNext, addUpNext, removeUpNext } from '../lib/upnext.js';
import { markNotInterested, markAlreadyRead } from '../lib/taste.js';
import { readLater, toggleReadLater } from '../lib/readlists.js';
import { canSendToAbs, sendToAbs, absUploads } from '../lib/absupload.js';

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
  const queue = useStore(upNext);
  const prog = useStore(progress);
  const later = useStore(readLater);
  const ups = useStore(absUploads);
  // Send to Audiobookshelf: which way (home server for torrents, or upload from the phone).
  const [absPick, setAbsPick] = useState(null); // { checking, hit, torrent }
  const pickAbsRoute = async () => {
    const q = await import('../sources/qbit.js');
    const torrent = !!book.hash && q.available && q.configured();
    // Auto-send (or you) already gave this torrent to your home server.
    const sent = torrent && q.wasSent(String(book.hash).toLowerCase());
    setAbsPick({ checking: true, torrent, sent });
    const hit = await q.onServer(book).catch(() => null);
    setAbsPick({ checking: false, hit, torrent, sent });
  };
  const viaHomeServer = async () => {
    try {
      const q = await import('../sources/qbit.js');
      toast(`${await q.send(book)} — it shows in Audiobookshelf once downloaded`);
    } catch (e) {
      toast(`Home server: ${e.message}`);
    }
  };
  const viaPhone = () => {
    toast('Sending to Audiobookshelf — downloading first; you can keep using the app');
    sendToAbs(book)
      .then((t) => t && toast(`“${book.title}” is on your Audiobookshelf (${t.label}) — it shows there after the scan`))
      .catch((e) => toast(`Audiobookshelf: ${e.message}`));
  };
  const [busy, setBusy] = useState('');
  const [fixing, setFixing] = useState(false);
  const close = () => (setFixing(false), sheet.set(null));
  useBackClose(!!book, close);
  useEffect(() => (setBusy(''), setFixing(false), setAbsPick(null)), [book?.uid]);
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
        {canSendToAbs() && book.source !== 'abs' && !ebookOnly(book) && !absPick && (
          <button
            class="menu-item"
            disabled={['downloading', 'uploading'].includes(ups[book.uid]?.status)}
            onClick={() => pickAbsRoute()}
          >
            <Icon name="server" size={18} />{' '}
            {ups[book.uid]?.status === 'downloading'
              ? 'Sending to Audiobookshelf · downloading…'
              : ups[book.uid]?.status === 'uploading'
                ? `Sending to Audiobookshelf · ${Math.round((ups[book.uid].pct || 0) * 100)}%`
                : ups[book.uid]?.status === 'done'
                  ? 'Send to Audiobookshelf again'
                  : 'Send to Audiobookshelf'}
          </button>
        )}
        {absPick && (
          <div class="abs-pick">
            {absPick.checking ? (
              <p class="muted small">
                <span class="spinner small" /> Checking your Audiobookshelf…
              </p>
            ) : (
              <>
                {absPick.hit && <p class="small">Already on your Audiobookshelf: “{absPick.hit.title}”{absPick.hit.author ? ` · ${absPick.hit.author}` : ''}</p>}
                {!absPick.hit && absPick.sent && <p class="small">Already sent to your home server (qBittorrent) — it shows in Audiobookshelf once downloaded there.</p>}
                {absPick.torrent && (
                  <button class="menu-item" onClick={act(() => viaHomeServer())}>
                    <Icon name="server" size={18} />
                    <span>
                      Home server downloads it{absPick.hit || absPick.sent ? ' again' : ' (recommended)'}
                      <small class="muted"> — qBittorrent saves it straight into your library; nothing goes through the phone. Needs people sharing it.</small>
                    </span>
                  </button>
                )}
                <button class="menu-item" onClick={act(() => viaPhone())}>
                  <Icon name="upload" size={18} />
                  <span>
                    Upload from the phone{absPick.hit ? ' anyway' : ''}
                    <small class="muted"> — downloads from your cloud, then uploads (uses data twice). Works for anything that plays.</small>
                  </span>
                </button>
                <button class="menu-item quiet" onClick={() => setAbsPick(null)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        )}
        {!ebookOnly(book) &&
          (queue.some((x) => x.book.uid === book.uid && x.at == null) ? (
            <button class="menu-item" onClick={act(() => (removeUpNext(book.uid), toast('Taken off Up next')))}>
              <Icon name="list" size={18} /> Remove from Up next
            </button>
          ) : (
            <button class="menu-item" onClick={act(() => (addUpNext(book), toast(`Up next: ${book.title}`)))}>
              <Icon name="list" size={18} /> Add to Up next
            </button>
          ))}
        {!p && (
          <button class="menu-item" onClick={act(() => toast(toggleReadLater(book) ? 'Added to Read later (Library)' : 'Taken off Read later'))}>
            <Icon name="bookmark" size={18} fill={!!later[book.uid]} /> {later[book.uid] ? 'Remove from Read later' : 'Read later'}
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
        {!p && (
          <button class="menu-item" onClick={act(() => (markAlreadyRead(book), toast('Got it — it won’t be recommended (undo in Settings → AI)')))}>
            <Icon name="check" size={18} /> Already read it
          </button>
        )}
        <button class="menu-item danger" onClick={act(() => (markNotInterested(book), toast('Hidden — you’ll see less like this (undo in Settings → AI)')))}>
          <Icon name="close" size={18} /> Not for me — fewer like this
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
