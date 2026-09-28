import { useMemo, useRef, useState } from 'preact/hooks';
import { Grid, Empty, Cover, toast } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { library, progress, useStore, forgetBook } from '../lib/store.js';
import { downloads, removeDownload } from '../lib/downloads.js';
import { forgetEbook } from '../lib/epub.js';
import { nav } from '../lib/nav.js';
import { podcasts } from '../sources/podcasts.js';
import { ShowGrid } from './Podcasts.jsx';

const TABS = [
  ['progress', 'In progress'],
  ['saved', 'Saved'],
  ['audio', 'Audiobooks'],
  ['text', 'Ebooks'],
  ['podcasts', 'Podcasts'],
  ['downloaded', 'Downloaded'],
  ['finished', 'Finished'],
];

export function Library() {
  const lib = useStore(library);
  const prog = useStore(progress);
  const dls = useStore(downloads);
  const pods = useStore(podcasts);
  const [tab, setTab] = useState('progress');
  const [editing, setEditing] = useState(false);
  const [editShown, setEditShown] = useState(60);
  const last = useRef([]);
  const fresh = useMemo(() => {
    // Defensive: skip anything malformed rather than failing the whole screen.
    const ok = (b) => b && typeof b === 'object' && typeof b.uid === 'string';
    const saved = Object.values(lib || {}).filter((b) => ok(b) && !/^lbl?:/.test(b.uid)).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const started = Object.values(prog || {}).filter((p) => p && ok(p.book)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    switch (tab) {
      case 'progress':
        return started.filter((p) => !p.finished).map((p) => p.book);
      case 'finished':
        return started.filter((p) => p.finished).map((p) => p.book);
      case 'saved':
        return saved;
      case 'podcasts':
        // Episodes you've started and not finished.
        return started.filter((p) => !p.finished && p.book.source === 'pod').map((p) => p.book);
      case 'downloaded':
        return Object.values(dls || {})
          .filter((d) => d && ok(d.book) && d.status !== 'cancelled')
          .map((d) => d.book);
      default: {
        // Audiobooks / Ebooks: everything saved or started of that kind.
        const seen = new Set();
        return [...saved, ...started.map((p) => p.book)].filter((b) => b.kind === tab && b.source !== 'pod' && !seen.has(b.uid) && seen.add(b.uid));
      }
    }
  }, [lib, prog, tab, dls]);
  // Position saves (every few seconds while playing) give new objects for one book at
  // most: keep the same list when nothing else changed, so the grid isn't redone.
  const items = fresh.length === last.current.length && fresh.every((b, i) => b === last.current[i]) ? last.current : (last.current = fresh);

  const stats = useMemo(() => {
    const vals = Object.values(prog || {}).filter((p) => p && typeof p === 'object');
    const seconds = vals.reduce((a, p) => a + (p.global || 0), 0);
    return { books: vals.length, hours: Math.round(seconds / 360) / 10, done: vals.filter((p) => p.finished).length };
  }, [prog]);

  return (
    <div class="screen library">
      <div class="library-head">
        <h1 class="screen-title">Library</h1>
        <button class={'pill small' + (editing ? ' active' : '')} onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      <div class="stats">
        <div>
          <b>{stats.books}</b>
          <span>started</span>
        </div>
        <div>
          <b>{stats.hours}</b>
          <span>hours listened</span>
        </div>
        <div>
          <b>{stats.done}</b>
          <span>finished</span>
        </div>
      </div>
      <div class="segmented scroll">
        {TABS.map(([k, label]) => (
          <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'podcasts' ? (
        <div class="lib-pods">
          {items.length > 0 && (
            <>
              <h3 class="section-label pad">Episodes in progress</h3>
              <Grid items={items} />
            </>
          )}
          <h3 class="section-label pad">Your shows</h3>
          {pods.subs.length ? (
            <div class="pad">
              <ShowGrid shows={pods.subs} />
            </div>
          ) : (
            <Empty icon="mic" title="No shows yet">
              Follow podcasts from the{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), nav.tab('podcasts'))}>
                Podcasts tab
              </a>
              .
            </Empty>
          )}
        </div>
      ) : items.length && editing ? (
        <div class="lib-edit">
          {items.slice(0, editShown).map((b) => (
            <div class="lib-edit-row">
              <Cover book={b} />
              <div>
                <b>{b.title}</b>
                <small>{b.author}</small>
              </div>
              <button class="icon-btn" aria-label={`Remove ${b.title}`} onClick={() => remove(b, tab)}>
                <Icon name="trash" size={18} />
              </button>
            </div>
          ))}
          {items.length > editShown && (
            <button class="btn ghost-wide" onClick={() => setEditShown(editShown + 60)}>
              Show more ({items.length - editShown})
            </button>
          )}
        </div>
      ) : items.length ? (
        <Grid items={items} />
      ) : (
        <Empty icon="library" title="Your shelf is empty">
          Tap the heart on any book to save it, or{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), nav.tab('discover'))}>
            discover something new
          </a>
          .
        </Empty>
      )}
      <div class="footer-space" />
    </div>
  );
}

/** Remove a book from the library: saved copy, reading/listening history and, for ebooks, the file kept on the phone. */
async function remove(book, tab) {
  if (tab === 'downloaded') {
    await removeDownload(book.uid).catch(() => {});
    return toast('Download removed');
  }
  forgetBook(book.uid);
  if (book.kind === 'text') forgetEbook(book.uid);
  toast(`Removed "${book.title}"`);
}
