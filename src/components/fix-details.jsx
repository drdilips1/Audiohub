// "Find cover & details": search several places at once (Audible, Apple audiobooks and
// Apple Books, Goodreads, Google Books, Open Library) and pick the right one for this book.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { setFix, searchCovers, metaNow, fixFor } from '../lib/meta.js';
import { mainTitle } from '../lib/match.js';
import { localSrc } from '../sources/index.js';

/** A picture from the phone as a small cover (square-ish, ~40 KB), kept as a data URL. */
async function coverFromFile(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 480 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

/** "Choose your own picture" — keeps this book's details, swaps only the cover. */
export function OwnCoverButton({ book, onFixed = () => {}, onDone = () => {}, label = 'Choose your own picture' }) {
  return (
    <label class="link-btn fix-link own-cover">
      <Icon name="covers" size={14} /> {label}
      <input
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!f) return;
          try {
            const cover = await coverFromFile(f);
            const now = metaNow(book) || {};
            const fix = { title: book.title, author: book.author || '', description: book.description || '', narrator: book.narrator || '', year: book.year || '', genres: book.genres || [], ...now, cover, source: now.source || 'you' };
            setFix(book.uid, fix);
            if (book.source === 'loc') localSrc.setCover(book.uid, cover);
            onFixed({ ...fix, metaSource: fix.source, fixed: true });
            toast('Your picture is this book’s cover now');
            onDone();
          } catch (err) {
            toast("Couldn't use that picture: " + err.message);
          }
        }}
      />
    </label>
  );
}

export function FixDetails({ book, onFixed = () => {}, autoOpen = false, onDone = () => {} }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(null);
  const search = async (term) => {
    if (!term.trim()) return;
    setBusy(true);
    setList(null);
    setList(await searchCovers(term).catch(() => []));
    setBusy(false);
  };
  const start = () => {
    const term = `${mainTitle(book.title)} ${(book.author || '').split(',')[0]}`.trim();
    setQ(term);
    setOpen(true);
    search(term);
  };
  useEffect(() => {
    if (autoOpen) start();
  }, []);
  const pick = (m) => {
    const fix = {
      title: m.title,
      author: m.author || book.author || '',
      cover: m.cover,
      description: m.description || '',
      narrator: m.narrator || '',
      year: m.year || '',
      genres: m.genres || m.subjects || [],
      source: m.from || 'Search',
    };
    setFix(book.uid, fix);
    // A phone book keeps the cover with its file details too (survives rescans).
    if (book.source === 'loc' && fix.cover) localSrc.setCover(book.uid, fix.cover);
    onFixed({ ...fix, metaSource: fix.source, fixed: true });
    setOpen(false);
    toast('Cover & details saved for this book');
    onDone();
  };
  if (!open)
    return (
      <div class="fix-row">
        <button class="link-btn fix-link" onClick={start}>
          <Icon name="search" size={14} /> {book.cover ? 'Wrong cover or details? Find the right ones' : 'Find cover & details'}
        </button>
        <OwnCoverButton book={book} onFixed={onFixed} label="Use your own picture" />
        {book.fixed && (
          <button
            class="link-btn fix-link"
            onClick={() => {
              setFix(book.uid, null);
              toast('Back to the original details — reopen the book to see them');
            }}
          >
            Undo
          </button>
        )}
      </div>
    );
  return (
    <div class="fix-panel">
      <form
        class="set-form inline"
        onSubmit={(e) => {
          e.preventDefault();
          search(q);
        }}
      >
        <input value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Title and author" />
        <button class="btn primary" disabled={busy}>
          {busy ? <span class="spinner small" /> : 'Search'}
        </button>
      </form>
      <OwnCoverButton book={book} onFixed={onFixed} onDone={() => (setOpen(false), onDone())} label="Or choose your own picture from the phone" />
      {busy && <p class="muted small">Looking in Audible, Apple, Goodreads, Google Books and Open Library…</p>}
      {list && !list.length && <p class="muted small">Nothing found — try fewer words.</p>}
      <div class="fix-list">
        {(list || []).map((m) => (
          <button class="fix-item" onClick={() => pick(m)}>
            {m.cover ? <img src={m.cover} alt="" loading="lazy" /> : <span class="fix-nocover" />}
            <span>
              <b>{m.title}</b>
              <small>
                {m.author}
                {m.year ? ` · ${m.year}` : ''} · {m.from}
              </small>
            </span>
          </button>
        ))}
      </div>
      <button
        class="link-btn"
        onClick={() => {
          setOpen(false);
          onDone();
        }}
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * Edit a book's details by hand — title, author, narrator, series, year — when what came with
 * the file (or the lookup) is wrong. Kept on this phone for this book; Undo brings back the
 * original. onSaved(fields) lets the page show them at once.
 */
export function EditDetails({ book, onSaved = () => {}, onClose = () => {} }) {
  const fix = fixFor(book.uid) || {};
  const [f, setF] = useState({
    title: fix.title || book.title || '',
    author: fix.author || book.author || '',
    narrator: fix.narrator || book.narrator || '',
    series: fix.series || book.series || '',
    year: String(fix.year || book.year || ''),
  });
  const field = (k, label, hint) => (
    <label class="edit-field">
      <span>{label}</span>
      <input value={f[k]} placeholder={hint} onInput={(e) => setF((x) => ({ ...x, [k]: e.currentTarget.value }))} />
    </label>
  );
  const save = () => {
    const clean = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v).trim()]));
    if (!clean.title) return toast('A title is needed');
    setFix(book.uid, { ...fix, ...clean, edited: true, source: fix.source || 'you' });
    onSaved(clean);
    toast('Details saved for this book');
    onClose();
  };
  return (
    <div class="edit-details">
      {field('title', 'Title', 'Book title')}
      {field('author', 'Author', 'e.g. Siddhartha Mukherjee')}
      {field('narrator', 'Narrator', 'Who reads it')}
      {field('series', 'Series', 'e.g. The Expanse #3')}
      {field('year', 'Year', 'e.g. 2010')}
      <div class="edit-actions">
        <button class="btn primary" onClick={save}>
          Save
        </button>
        <button class="btn secondary" onClick={onClose}>
          Cancel
        </button>
        {fixFor(book.uid)?.edited && (
          <button
            class="link-btn"
            onClick={() => {
              setFix(book.uid, null);
              toast('Back to the original details — reopen the book to see them');
              onClose();
            }}
          >
            Undo my edits
          </button>
        )}
      </div>
    </div>
  );
}
