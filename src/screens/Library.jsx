import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Grid, Empty, Cover, toast, AskButton } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { library, progress, useStore, forgetBook, persisted } from '../lib/store.js';
import { localSrc } from '../sources/index.js';
import { fmtDuration } from '../lib/format.js';
import { metaNow } from '../lib/meta.js';
import { downloads, removeDownload } from '../lib/downloads.js';
import { forgetEbook } from '../lib/epub.js';
import { nav } from '../lib/nav.js';
import { podcasts } from '../sources/podcasts.js';
import { ShowGrid } from './Podcasts.jsx';

const TABS = [
  ['progress', 'In progress'],
  ['saved', 'Saved'],
  ['phone', 'On this phone'],
  ['audio', 'Audiobooks'],
  ['text', 'Ebooks'],
  ['podcasts', 'Podcasts'],
  ['downloaded', 'Downloaded'],
  ['finished', 'Finished'],
];

const SORTS = [
  ['recent', 'Recent'],
  ['title', 'Title'],
  ['author', 'Author'],
  ['length', 'Length'],
];
const surname = (name) => String(name).split(',')[0].trim().split(/\s+/).pop() || '';
const libView = persisted('libraryView', { list: false, sort: 'recent' });
const lengthOf = (b) => b.duration || metaNow(b)?.runtime || b.size || 0;
// Phone and cloud books often get their author from the online lookup.
const authorOf = (b) => metaNow(b)?.author || b.author || '';
const titleOf = (b) => (b.source === 'loc' && metaNow(b)?.title) || b.title || '';
const SORTERS = {
  title: (a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { numeric: true }),
  // By surname; books with no known author go last.
  author: (a, b) => {
    const x = surname(authorOf(a));
    const y = surname(authorOf(b));
    if (!x !== !y) return x ? -1 : 1;
    return x.localeCompare(y) || SORTERS.title(a, b);
  },
  length: (a, b) => lengthOf(b) - lengthOf(a),
};

export function Library() {
  const view = useStore(libView);
  const local = useStore(localSrc.localCfg);
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
      case 'phone':
        return local.books || [];
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
  }, [lib, prog, tab, dls, local]);
  // Phone books are listed once a folder has been scanned.
  useEffect(() => {
    if (tab === 'phone' && localSrc.connected() && !local.scannedAt) localSrc.rescan().catch(() => {});
  }, [tab]);
  const sorted = useMemo(() => (view.sort !== 'recent' && SORTERS[view.sort] ? [...fresh].sort(SORTERS[view.sort]) : fresh), [fresh, view.sort]);
  // Position saves (every few seconds while playing) give new objects for one book at
  // most: keep the same list when nothing else changed, so the grid isn't redone.
  const items = sorted.length === last.current.length && sorted.every((b, i) => b === last.current[i]) ? last.current : (last.current = sorted);

  const stats = useMemo(() => {
    const vals = Object.values(prog || {}).filter((p) => p && typeof p === 'object');
    const seconds = vals.reduce((a, p) => a + (p.global || 0), 0);
    return { books: vals.length, hours: Math.round(seconds / 360) / 10, done: vals.filter((p) => p.finished).length };
  }, [prog]);

  return (
    <div class="screen library">
      <div class="library-head">
        <h1 class="screen-title">Library</h1>
        <div class="library-head-actions">
          <button class="icon-btn glass" onClick={() => nav.push('stats')} aria-label="Listening stats">
            <Icon name="chart" size={20} />
          </button>
          <button class={'pill small' + (editing ? ' active' : '')} onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </button>
          <AskButton />
        </div>
      </div>
      <button class="stats" onClick={() => nav.push('stats')} aria-label="Listening stats">
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
      </button>
      <div class="segmented scroll">
        {TABS.map(([k, label]) => (
          <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'phone' && items.length > 0 && localSrc.available && <PhoneManage />}
      {tab !== 'podcasts' && items.length > 1 && (
        <div class="lib-tools">
          <div class="lib-sort">
            {SORTS.map(([k, label]) => (
              <button class={'pill small' + (view.sort === k ? ' active' : '')} onClick={() => libView.set((v) => ({ ...v, sort: k }))}>
                {label}
              </button>
            ))}
          </div>
          <button class="icon-btn" aria-label={view.list ? 'Show as grid' : 'Show as list'} onClick={() => libView.set((v) => ({ ...v, list: !v.list }))}>
            <Icon name={view.list ? 'grid' : 'list'} size={20} />
          </button>
        </div>
      )}
      {tab === 'phone' && !items.length ? (
        <PhoneEmpty />
      ) : tab === 'podcasts' ? (
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
      ) : items.length && editing && tab !== 'phone' ? (
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
        view.list ? <ListView items={items} prog={prog} /> : <Grid items={items} />
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

/** One row per book: cover, title, author and how far you are. */
function ListView({ items, prog }) {
  const [count, setCount] = useState(80);
  return (
    <div class="lib-list">
      {items.slice(0, count).map((b) => {
        const p = prog?.[b.uid];
        const pct = p && !p.finished ? Math.round((p.percent || 0) * 100) : 0;
        return (
          <button class="lib-row" onClick={() => nav.push('book', { book: b })}>
            <Cover book={b} />
            <div>
              <b>{b.title}</b>
              <small>
                {b.author}
                {b.duration ? ` · ${fmtDuration(b.duration)}` : ''}
                {p?.finished ? ' · Finished' : pct ? ` · ${pct}%` : ''}
              </small>
              {pct > 0 && (
                <div class="progress-bar">
                  <div style={{ width: pct + '%' }} />
                </div>
              )}
            </div>
          </button>
        );
      })}
      {items.length > count && (
        <button class="btn ghost-wide" onClick={() => setCount(count + 80)}>
          Show more ({items.length - count})
        </button>
      )}
    </div>
  );
}

/** Run a phone-books action with a busy flag and a short result toast. */
function usePhoneRun() {
  const [busy, setBusy] = useState('');
  const run = (label, fn) => async () => {
    setBusy(label);
    try {
      const r = await fn();
      if (Array.isArray(r)) toast(`${r.length} audiobook${r.length === 1 ? '' : 's'} found`);
    } catch (e) {
      if (!/no folder chosen|cancelled/i.test(e.message)) toast(e.message);
    } finally {
      setBusy('');
    }
  };
  return [busy, run];
}

/** Choose folder / Rescan. */
function PhoneButtons({ busy, run }) {
  const cfg = useStore(localSrc.localCfg);
  return (
    <div class="phone-actions">
      <button class="btn primary" disabled={!!busy} onClick={run('add', localSrc.addFolder)}>
        {busy === 'add' ? <span class="spinner" /> : <Icon name="plus" size={16} />} {cfg.folders.length ? 'Add folder' : 'Choose folder'}
      </button>
      {cfg.folders.length > 0 && (
        <button class="btn secondary" disabled={!!busy} onClick={run('scan', localSrc.rescan)}>
          {busy === 'scan' ? <span class="spinner" /> : <Icon name="shuffle" size={16} />} Rescan
        </button>
      )}
    </div>
  );
}

/** "On this phone" with books: the folders it reads (with counts), add / remove / rescan. */
function PhoneManage() {
  const cfg = useStore(localSrc.localCfg);
  const [open, setOpen] = useState(false);
  const [busy, run] = usePhoneRun();
  return (
    <div class="phone-manage">
      <button class="btn ghost-wide lib-manage" onClick={() => setOpen(!open)}>
        <Icon name="library" size={16} /> Folders
        <small>
          {cfg.folders.length} folder{cfg.folders.length === 1 ? '' : 's'}
        </small>
        <Icon name="down" size={16} />
      </button>
      {open && (
        <div class="phone-panel">
          {cfg.folders.map((f) => {
            const n = cfg.books.filter((b) => b.folder === f.uri).length;
            return (
              <div class="set-row">
                <div>
                  <b>{decodeURIComponent(f.name)}</b>
                  <small>{n ? `${n} audiobook${n > 1 ? 's' : ''}` : 'No books yet'}</small>
                </div>
                <button class="pill small" onClick={() => confirm(`Stop reading “${decodeURIComponent(f.name)}”? The files stay on the phone.`) && localSrc.removeFolder(f.uri)}>
                  Remove
                </button>
              </div>
            );
          })}
          <PhoneButtons busy={busy} run={run} />
        </div>
      )}
    </div>
  );
}

/** "On this phone" before a folder is chosen (or when it has no books). */
function PhoneEmpty() {
  const [busy, run] = usePhoneRun();
  if (!localSrc.available)
    return (
      <Empty icon="library" title="Books on your phone">
        Audiobooks already on the phone show here in the Android app.
      </Empty>
    );
  return (
    <Empty icon="library" title={localSrc.connected() ? 'No books found' : 'Books on your phone'}>
      {localSrc.connected() ? 'Nothing playable in your chosen folders yet.' : 'Choose the folder where your audiobooks are (e.g. Audiobooks). They play straight from the phone, no internet needed.'}
      <PhoneButtons busy={busy} run={run} />
    </Empty>
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
