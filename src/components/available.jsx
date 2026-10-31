import { useEffect, useMemo, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { useStore } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { getDetails, findOwned, localSrc, absSrc } from '../sources/index.js';
import * as qb from '../sources/qbit.js';
import { downloads } from '../lib/downloads.js';
import { savedEbooks, cloudReaderBook, badEbooks, isBadEbook } from '../lib/epub.js';
import { mainTitle, matches } from '../lib/match.js';
import { useQuickSources, quickPlay, readerBookFor } from './source-results.jsx';
import { wait } from '../lib/waitlist.js';

const fmtMb = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.round(b / 1048576)} MB`);

const SVC = { tb: 'TorBox', rd: 'Real-Debrid', abs: 'Audiobookshelf', torbox: 'TorBox', realdebrid: 'Real-Debrid' };
const surname = (a) => String(a || '').split(',')[0].trim().split(/\s+/).pop()?.toLowerCase() || '';

/**
 * "Available": every way to listen to or read this book right now, as one row of
 * buttons under length / year / language — the book on your phone, downloaded, kept
 * ebooks, your Audiobookshelf and TorBox / Real-Debrid files, and source results that
 * play at once. Audiobook pages show ebooks too, and the other way round.
 */
export function Available({ book, editions }) {
  const local = useStore(localSrc.localCfg);
  const dls = useStore(downloads);
  const kept = useStore(savedEbooks);
  const bad = useStore(badEbooks);
  const quick = useQuickSources(book.uid);
  const [owned, setOwned] = useState(null);
  const [onAbs, setOnAbs] = useState(null);
  const [busy, setBusy] = useState('');

  // Your Audiobookshelf, checked the same careful way as before sending a book home
  // (your whole library list, then the server's own search) — works whatever the book's source.
  useEffect(() => {
    setOnAbs(null);
    if (book.source === 'abs' || !book.title || !absSrc.connected()) return;
    let alive = true;
    qb.onServer({ title: book.title, author: book.author || '' })
      .then((hit) => alive && setOnAbs(hit || null))
      .catch(() => {});
    return () => (alive = false);
  }, [book.uid]);

  // Your own services, for books that aren't a search result (those have `editions`).
  useEffect(() => {
    setOwned(null);
    if (book.kind === 'discover' || !book.title) return;
    let alive = true;
    findOwned(book).then((o) => alive && setOwned(o));
    return () => (alive = false);
  }, [book.uid]);

  const chips = useMemo(() => {
    const t = mainTitle(book.title || '');
    if (!t) return [];
    const sn = surname(book.author);
    const same = (b) => b && b.uid !== book.uid && matches(t, `${b.title || ''} ${b.rawName || ''}`) && (!sn || !b.author || surname(b.author) === sn || String(b.author).toLowerCase().includes(sn));
    const out = [];
    const add = (c) => !out.some((x) => x.key === c.key) && !isBadEbook(c.act?.book) && out.push(c);
    const listen = (b) => ({ kind: 'listen', book: b });
    const read = (b) => ({ kind: 'read', book: b });

    // The book's own ebook files (an audiobook folder in your cloud that has the EPUB too).
    for (const f of book.ebooks || [])
      if (f.format === 'EPUB' || f.format === 'PDF') add({ key: 'own:' + f.name, icon: 'book', label: `Read ${f.format}`, sub: 'in this folder', act: read(cloudReaderBook(book, f)) });
    for (const b of local.books || [])
      if (same(b)) add(b.kind === 'text' ? { key: b.uid, icon: 'book', label: `Read ${b.ebookFormat || 'ebook'}`, sub: 'on this phone', act: read(b) } : { key: b.uid, icon: 'headphones', label: 'Listen', sub: 'on this phone', act: listen(b) });
    for (const d of Object.values(dls || {}))
      if (d?.status === 'done' && (d.book?.uid === book.uid ? false : same(d.book))) add({ key: 'dl:' + d.book.uid, icon: 'headphones', label: 'Listen', sub: 'downloaded', act: listen(d.book) });
    for (const x of Object.values(kept || {}))
      if (x?.book && (x.book.uid === `${book.uid.replace(/#ebook$/, '')}#ebook` || same(x.book))) add({ key: 'kept:' + x.book.uid, icon: 'book', label: `Read ${x.format || ''}`.trim(), sub: 'saved on phone', act: read(x.book) });
    const mine = editions || owned;
    if (onAbs && onAbs.uid !== book.uid) add({ key: onAbs.uid, icon: 'headphones', label: 'Listen', sub: 'Audiobookshelf', act: listen(onAbs) });
    for (const b of mine?.server || []) if (same(b)) add({ key: b.uid, icon: 'headphones', label: 'Listen', sub: 'Audiobookshelf', act: listen(b) });
    for (const b of mine?.cloud || [])
      if (same(b))
        add(
          b.kind === 'text'
            ? { key: b.uid, icon: 'book', label: 'Ebook', sub: SVC[b.source] || 'your cloud', act: { kind: 'open', book: b } }
            : { key: b.uid, icon: 'headphones', label: 'Listen', sub: SVC[b.source] || 'your cloud', act: listen(b) }
        );
    // Source results that play at once / open in the reader.
    for (const { r, via } of quick?.instant || []) add({ key: 'q:' + r.key, icon: 'play', label: 'Play now', sub: `instant · ${SVC[via]}`, act: { kind: 'quick', r, via } });
    // Not ready yet: fetched through TorBox / Real-Debrid, plays when it's there.
    for (const { r, via } of quick?.fetch || []) add({ key: 'f:' + r.key, icon: 'download', label: 'Get & play', sub: `${SVC[via]}${r.seeders == null ? '' : ` · ${r.seeders} seed${r.seeders === 1 ? '' : 's'}`}${r.size ? ` · ${fmtMb(r.size)}` : ''}`, act: { kind: 'fetch', r, via } });
    for (const r of quick?.readable || []) {
      const rb = readerBookFor(r, book);
      if (rb) add({ key: 'qr:' + r.key, icon: 'book', label: `Read ${rb.ebookFormat || ''}`.trim(), sub: 'from sources', act: read(rb) });
    }
    // An audiobook app: ways to listen first, then ebooks to read.
    const reading = (c) => c.icon === 'book';
    return [...out.filter((c) => !reading(c)), ...out.filter(reading)].slice(0, 8);
  }, [book, editions, owned, local, dls, kept, quick, onAbs, bad]);

  const run = async (c) => {
    const a = c.act;
    if (a.kind === 'read') return nav.push('reader', { book: a.book });
    if (a.kind === 'open') return nav.push('book', { book: a.book });
    setBusy(c.key);
    try {
      if (a.kind === 'quick') await quickPlay(a.r, a.via, book, (text) => toast(text));
      else if (a.kind === 'fetch') {
        try {
          await quickPlay(a.r, a.via, book, (text) => toast(text));
        } catch (e) {
          if (!e.pending) throw e;
          // Still downloading on the service: it starts playing by itself when it's ready.
          wait({ ...e.pending, magnet: a.r.magnet, title: a.r.title, bookTitle: book.title || '', author: book.author || a.r.author || '', cover: book.cover || '' });
          toast(`${e.message} — it will start playing when it's ready`);
        }
      }
      else {
        const d = await getDetails(a.book);
        nav.openOverlay('player');
        player.playBook(d);
      }
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };

  const searching = book.kind === 'discover' && (!editions || quick?.pending);
  if (!chips.length && !searching) return null;
  return (
    <div class="available">
      <span class="available-label">Available</span>
      <div class="available-row">
        {chips.map((c) => (
          <button class={'avail-chip ' + c.act.kind} disabled={!!busy} onClick={() => run(c)}>
            {busy === c.key ? <span class="spinner small" /> : <Icon name={c.icon} size={16} />}
            <span>
              <b>{c.label}</b>
              <small>{c.sub}</small>
            </span>
          </button>
        ))}
        {searching && (
          <span class="avail-chip looking">
            <span class="spinner small" />
            <span>
              <b>Looking…</b>
              <small>your services & sources</small>
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
