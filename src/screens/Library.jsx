import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Grid, Empty, Cover, BookCover, toast, AskButton, BookCard } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { library, progress, useStore, forgetBook, persisted, clearPodcastHistory } from '../lib/store.js';
import { localSrc } from '../sources/index.js';
import { fmtDuration } from '../lib/format.js';
import { metaNow, metaFixes, coverNow, findMissingCovers } from '../lib/meta.js';
import { seriesOf } from '../lib/series.js';
import { oneEach } from '../lib/works.js';
import { downloads, removeDownload } from '../lib/downloads.js';
import { forgetEbook, savedEbooks } from '../lib/epub.js';
import { nav } from '../lib/nav.js';
import { podcasts } from '../sources/podcasts.js';
import { ShowGrid } from './Podcasts.jsx';
import { EbookSearchBox, EbookSearchResults } from '../components/ebook-search.jsx';

const TABS = [
  ['progress', 'Continue'],
  ['audio', 'Audiobooks'],
  ['text', 'Ebooks'],
  ['podcasts', 'Podcasts'],
  ['finished', 'Finished'],
];
// Inside Audiobooks / Ebooks: where the books are.
const WHERE = [
  ['all', 'All'],
  ['phone', 'On this phone'],
  ['downloaded', 'Downloaded'],
  ['saved', 'Saved'],
  // Smart shelves
  ['notstarted', 'Not started'],
  ['short', 'Short listens'],
  ['recent', 'Recently added'],
];

// How the books are laid out.
const VIEWS = [
  ['list', 'list', 'list'],
  ['grid', 'grid', 'grid'],
  ['covers', 'covers', 'covers only'],
  ['shelves', 'shelves', 'shelves'],
];

/** The books in the chosen layout: a list, a grid with titles, or small covers only. */
function Books({ items, mode, prog }) {
  if (mode === 'list') return <ListView items={items} prog={prog} />;
  if (mode === 'covers') return <CoverGrid items={items} />;
  return <Grid items={items} />;
}

/** Small covers only, four or five to a row: more books on the screen at once. */
function CoverGrid({ items }) {
  const [count, setCount] = useState(80);
  return (
    <>
      <div class="cover-grid">
        {items.slice(0, count).map((b) => (
          <button class="cover-tile" aria-label={titleOf(b)} onClick={() => (b.kind === 'text' && !String(b.uid).startsWith('lbl') ? nav.push('reader', { book: b }) : nav.push('book', { book: b }))}>
            <BookCover book={b} />
          </button>
        ))}
      </div>
      {items.length > count && (
        <button class="btn ghost-wide" onClick={() => setCount(count + 120)}>
          Show more ({items.length - count})
        </button>
      )}
    </>
  );
}

/** Shelves: a sideways row per author (or per series), most books first. */
function Shelves({ items, by }) {
  const groups = new Map();
  for (const b of items) {
    const name = by === 'series' ? seriesOf(b)?.name || 'Not in a series' : authorOf(b) || 'Unknown author';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(b);
  }
  const list = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const [count, setCount] = useState(20);
  return (
    <>
      {list.slice(0, count).map(([name, books]) => (
        <section class="row lib-shelf">
          <header class="row-head">
            <h3>
              {name} <small>{books.length}</small>
            </h3>
          </header>
          <div class="row-scroll">
            {books.slice(0, 40).map((b) => (
              <BookCard key={b.uid} book={b} />
            ))}
          </div>
        </section>
      ))}
      {list.length > count && (
        <button class="btn ghost-wide" onClick={() => setCount(count + 20)}>
          More shelves ({list.length - count})
        </button>
      )}
    </>
  );
}

const SORTS = [
  ['recent', 'Recent'],
  ['title', 'Title'],
  ['author', 'Author'],
  ['length', 'Length'],
  ['series', 'Series'],
];
const surname = (name) => String(name).split(',')[0].trim().split(/\s+/).pop() || '';
const libView = persisted('libraryView', { list: false, sort: 'recent', tab: 'progress', where: 'all' });
const lengthOf = (b) => b.duration || metaNow(b)?.runtime || b.size || 0;
// Phone and cloud books often get their author from the online lookup.
const authorOf = (b) => metaNow(b)?.author || b.author || '';
// "- A Court of Mist and Fury" (a file name with the author cut off): no leading dash.
const bare = (t) => String(t || '').replace(/^[\s\-–—_.,:;]+/, '');
const titleOf = (b) => bare((b.source === 'loc' && metaNow(b)?.title) || b.title || '');
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
  const kept = useStore(savedEbooks);
  const tab = TABS.some(([k]) => k === view.tab) ? view.tab : 'progress';
  const where = view.where || 'all';
  const mode = view.mode || (view.list ? 'list' : 'grid');
  const setTab = (t) => libView.set((v) => ({ ...v, tab: t, where: 'all' }));
  const setWhere = (w) => libView.set((v) => ({ ...v, where: w }));
  const [editing, setEditing] = useState(false);
  const [ebookQ, setEbookQ] = useState('');
  const findingEbook = tab === 'text' && ebookQ.trim().length > 1;
  const [editShown, setEditShown] = useState(60);
  // Search everything in your library (any tab): saved, started, finished, phone, downloads, ebooks.
  const [finding, setFinding] = useState(false);
  const [libQ, setLibQ] = useState('');
  const last = useRef([]);
  // Every group of books, once per change.
  const groups = useMemo(() => {
    // Defensive: skip anything malformed rather than failing the whole screen.
    const ok = (b) => b && typeof b === 'object' && typeof b.uid === 'string';
    const saved = Object.values(lib || {}).filter((b) => ok(b) && !/^lbl?:/.test(b.uid) && b.source !== 'pod').sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const started = Object.values(prog || {}).filter((p) => p && ok(p.book)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const phone = (local.books || []).filter(ok);
    const downloaded = Object.values(dls || {})
      .filter((d) => d && ok(d.book) && d.status !== 'cancelled')
      .map((d) => d.book);
    const kindOf = (b) => (b.kind === 'text' ? 'text' : 'audio');
    const unique = (list) => {
      const seen = new Set();
      return list.filter((b) => !seen.has(b.uid) && seen.add(b.uid));
    };
    const byKind = (k) => {
      const pick = (list) => list.filter((b) => kindOf(b) === k && b.source !== 'pod');
      const sub = {
        saved: pick(saved),
        phone: pick(phone),
        // Ebooks: the ones kept on the phone after opening them in the app.
        downloaded: k === 'audio' ? pick(downloaded) : Object.values(kept || {}).map((x) => x.book).filter(ok),
      };
      // Every copy of a book (phone, download, server, cloud) shows once.
      sub.all = oneEach(unique([...pick(started.map((p) => p.book)), ...sub.saved, ...sub.downloaded, ...sub.phone]));
      // Smart shelves: never played; under 5 hours (audiobooks); added in the last 30 days.
      sub.notstarted = sub.all.filter((b) => !prog?.[b.uid]);
      const secs = (b) => Number(b.duration) || Number(metaNow(b)?.runtime) || 0;
      sub.short = k === 'audio' ? sub.all.filter((b) => secs(b) > 0 && secs(b) < 5 * 3600) : [];
      const month = Date.now() - 30 * 864e5;
      sub.recent = sub.all.filter((b) => (b.addedAt || 0) > month || (lib?.[b.uid]?.addedAt || 0) > month).sort((a, b) => (b.addedAt || lib?.[b.uid]?.addedAt || 0) - (a.addedAt || lib?.[a.uid]?.addedAt || 0));
      return sub;
    };
    return {
      progress: started.filter((p) => !p.finished).map((p) => p.book),
      finished: started.filter((p) => p.finished).map((p) => p.book),
      // Episodes you've started and not finished.
      podcasts: started.filter((p) => !p.finished && p.book.source === 'pod').map((p) => p.book),
      audio: byKind('audio'),
      text: byKind('text'),
    };
  }, [lib, prog, dls, local, kept]);
  const subs = tab === 'audio' || tab === 'text' ? groups[tab] : null;
  const fresh = subs ? subs[where] || subs.all : groups[tab];
  // Phone books are listed once a folder has been scanned.
  useEffect(() => {
    if ((tab === 'audio' || tab === 'text') && localSrc.connected() && !local.scannedAt) localSrc.rescan().catch(() => {});
  }, [tab]);
  const sorted = useMemo(() => (view.sort !== 'recent' && SORTERS[view.sort] ? [...fresh].sort(SORTERS[view.sort]) : fresh), [fresh, view.sort]);
  // Position saves (every few seconds while playing) give new objects for one book at
  // most: keep the same list when nothing else changed, so the grid isn't redone.
  const items = sorted.length === last.current.length && sorted.every((b, i) => b === last.current[i]) ? last.current : (last.current = sorted);

  const found = useMemo(() => {
    const words = libQ.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const seen = new Set();
    const all = [...groups.progress, ...groups.audio.all, ...groups.text.all, ...groups.finished].filter((b) => !seen.has(b.uid) && seen.add(b.uid));
    return oneEach(all).filter((b) => {
      const hay = `${titleOf(b)} ${b.title || ''} ${authorOf(b)} ${b.narrator || ''} ${b.series || ''} ${b.rawName || ''} ${b.ebookName || ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [libQ, groups]);

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
          <button
            class={'icon-btn glass' + (finding ? ' active' : '')}
            onClick={() => {
              if (finding) setLibQ('');
              setFinding(!finding);
            }}
            aria-label="Search your library"
          >
            <Icon name="search" size={19} />
          </button>
          <button class="icon-btn glass" onClick={() => nav.push('notes')} aria-label="Notes and bookmarks">
            <Icon name="bookmark" size={19} />
          </button>
          <button class="icon-btn glass" onClick={() => nav.push('stats')} aria-label="Listening stats">
            <Icon name="chart" size={20} />
          </button>
          <button class={'pill small' + (editing ? ' active' : '')} onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </button>
          <AskButton />
        </div>
      </div>
      {finding && (
        <div class="pad lib-find">
          <input type="search" autoFocus placeholder="Search your library — title, author, narrator, series" value={libQ} onInput={(e) => setLibQ(e.currentTarget.value)} />
        </div>
      )}
      {found ? (
        <>
          <h3 class="section-label pad">
            {found.length ? `In your library · ${found.length}` : `Nothing in your library matches “${libQ.trim()}”`}
          </h3>
          {found.length > 0 && <Books items={found} mode={mode === 'shelves' ? 'grid' : mode} prog={prog} />}
          {!found.length && (
            <button class="btn ghost-wide lib-manage" onClick={() => import('./Discover.jsx').then((m) => m.openSearch(libQ.trim()))}>
              <Icon name="search" size={16} /> Search everywhere for “{libQ.trim()}”
            </button>
          )}
        </>
      ) : (
        <>
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
      {subs && (
        <div class="lib-where">
          {WHERE.filter(([k]) => k === 'all' || (subs[k].length && !(k === 'saved' && subs.saved.length === subs.all.length)) || (k === 'phone' && localSrc.available)).map(([k, label]) => (
            <button class={'pill small' + (where === k ? ' active' : '')} onClick={() => setWhere(k)}>
              {label} <span class="lib-count">{subs[k].length}</span>
            </button>
          ))}
        </div>
      )}
      {tab === 'text' && <EbookSearchBox q={ebookQ} setQ={setEbookQ} />}
      {findingEbook ? (
        <EbookSearchResults q={ebookQ} />
      ) : (
        <>
      {subs && where === 'phone' && items.length > 0 && <PhoneManage />}
      {subs && where === 'downloaded' && (
        <button class="btn ghost-wide lib-manage" onClick={() => nav.push('downloads')}>
          <Icon name="download" size={16} /> Manage downloads
        </button>
      )}
      {tab !== 'podcasts' && items.length > 1 && (
        <div class="lib-tools">
          <div class="lib-sort">
            {SORTS.map(([k, label]) => (
              <button class={'pill small' + (view.sort === k ? ' active' : '')} onClick={() => libView.set((v) => ({ ...v, sort: k }))}>
                {label}
              </button>
            ))}
          </div>
          <div class="lib-views" role="group" aria-label="Show as">
            {VIEWS.map(([k, icon, label]) => (
              <button class={'icon-btn' + (mode === k ? ' active' : '')} aria-label={`Show as ${label}`} onClick={() => libView.set((v) => ({ ...v, mode: k, list: k === 'list' }))}>
                <Icon name={icon} size={18} />
              </button>
            ))}
          </div>
        </div>
      )}
      {tab !== 'podcasts' && <MissingCovers items={items} local={local} />}
      {subs && where === 'phone' && !items.length ? (
        <PhoneEmpty />
      ) : tab === 'podcasts' ? (
        <div class="lib-pods">
          {items.length > 0 && (
            <>
              <div class="lib-pod-head">
                <h3 class="section-label pad">Episodes in progress</h3>
                <button
                  class="link-btn"
                  onClick={() => confirm('Clear podcast history? Episodes you haven’t finished lose their place and leave this list and Home.') && (clearPodcastHistory(), toast('Podcast history cleared'))}
                >
                  Clear history
                </button>
              </div>
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
      ) : items.length && editing && !(subs && where === 'phone') ? (
        <div class="lib-edit">
          {items.slice(0, editShown).map((b) => (
            <div class="lib-edit-row">
              <BookCover book={b} />
              <div>
                <b>{b.title}</b>
                <small>{b.author}</small>
              </div>
              <button class="icon-btn" aria-label={`Remove ${b.title}`} onClick={() => remove(b, subs ? where : tab)}>
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
        mode === 'shelves' ? <Shelves items={items} by={view.sort === 'series' ? 'series' : 'author'} /> : view.sort === 'series' ? <SeriesGroups items={items} mode={mode} prog={prog} /> : <Books items={items} mode={mode} prog={prog} />
      ) : (
        <Empty icon="library" title="Your shelf is empty">
          Tap the heart on any book to save it, or{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), nav.tab('discover'))}>
            discover something new
          </a>
          .
        </Empty>
      )}
        </>
      )}
        </>
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
          <button class="lib-row" onClick={() => nav.push(b.kind === 'text' && /#ebook$/.test(b.uid) ? 'reader' : 'book', { book: b })}>
            <BookCover book={b} />
            <div>
              <b>{bare(b.title)}</b>
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
      if (typeof r === 'number') toast(r ? `${r} book${r > 1 ? 's' : ''} added` : 'Nothing added');
      else if (Array.isArray(r)) toast(`${r.length} book${r.length === 1 ? '' : 's'} found`);
    } catch (e) {
      if (!/no folder chosen|cancelled/i.test(e.message)) toast(e.message);
    } finally {
      setBusy('');
    }
  };
  return [busy, run];
}

/** Choose folder / Add EPUB or PDF files / Rescan. */
function PhoneButtons({ busy, run }) {
  const cfg = useStore(localSrc.localCfg);
  return (
    <div class="phone-actions">
      <button class="btn primary" disabled={!!busy} onClick={run('add', localSrc.addFolder)}>
        {busy === 'add' ? <span class="spinner" /> : <Icon name="plus" size={16} />} {cfg.folders.length ? 'Add folder' : 'Choose folder'}
      </button>
      <button class="btn secondary" disabled={!!busy} onClick={run('files', localSrc.pickBooks)}>
        {busy === 'files' ? <span class="spinner" /> : <Icon name="book" size={16} />} Add EPUB / PDF
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
  const count = (list) => {
    const eb = list.filter((b) => b.kind === 'text').length;
    const au = list.length - eb;
    return [au && `${au} audiobook${au > 1 ? 's' : ''}`, eb && `${eb} ebook${eb > 1 ? 's' : ''}`].filter(Boolean).join(' · ') || 'No books yet';
  };
  const added = cfg.imported || [];
  return (
    <div class="phone-manage">
      <button class="btn ghost-wide lib-manage" onClick={() => setOpen(!open)}>
        <Icon name="library" size={16} /> Folders & files
        <small>
          {cfg.folders.length} folder{cfg.folders.length === 1 ? '' : 's'}
          {added.length ? ` · ${added.length} added` : ''}
        </small>
        <Icon name="down" size={16} />
      </button>
      {open && (
        <div class="phone-panel">
          {cfg.folders.map((f) => (
            <div class="set-row">
              <div>
                <b>{decodeURIComponent(f.name)}</b>
                <small>{count(cfg.books.filter((b) => b.folder === f.uri))}</small>
              </div>
              <button class="pill small" onClick={() => confirm(`Stop reading “${decodeURIComponent(f.name)}”? The files stay on the phone.`) && localSrc.removeFolder(f.uri)}>
                Remove
              </button>
            </div>
          ))}
          {added.length > 0 && (
            <div class="set-row">
              <div>
                <b>Added files</b>
                <small>{count(added)} · opened with or shared to Audiohub</small>
              </div>
            </div>
          )}
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
        Audiobooks and ebooks (EPUB, PDF) already on the phone show here in the Android app.
      </Empty>
    );
  return (
    <Empty icon="library" title={localSrc.connected() ? 'No books found' : 'Books on your phone'}>
      {localSrc.connected()
        ? 'Nothing playable in your chosen folders yet.'
        : 'Choose the folder where your audiobooks and ebooks are (e.g. Audiobooks or Books), or add single EPUB / PDF files. They play and open straight from the phone, no internet needed.'}
      <PhoneButtons busy={busy} run={run} />
    </Empty>
  );
}

/** Remove a book from the library: saved copy, reading/listening history and, for ebooks, the file kept on the phone. */
async function remove(book, tab) {
  if (tab === 'downloaded') {
    if (book.kind === 'text') {
      await forgetEbook(book.uid);
      return toast('Removed from this phone');
    }
    await removeDownload(book.uid).catch(() => {});
    return toast('Download removed');
  }
  forgetBook(book.uid);
  if (book.kind === 'text') forgetEbook(book.uid);
  if (book.imported) await localSrc.removeImported(book.uid);
  toast(`Removed "${book.title}"`);
}

/** Library sorted by series: each series in reading order, then books in no series. */
/** "3 of 7 finished · 1 in progress". */
function seriesLine(books, prog) {
  const done = books.filter((b) => prog?.[b.uid]?.finished).length;
  const going = books.filter((b) => prog?.[b.uid] && !prog[b.uid].finished).length;
  return [`${books.length} book${books.length > 1 ? 's' : ''}`, done && `${done} finished`, going && `${going} in progress`].filter(Boolean).join(' · ');
}

function SeriesGroups({ items, mode = 'grid', prog }) {
  const groups = new Map();
  const loose = [];
  for (const b of items) {
    const s = seriesOf(b);
    if (!s?.name) {
      loose.push(b);
      continue;
    }
    const k = s.name.toLowerCase();
    if (!groups.has(k)) groups.set(k, { name: s.name, books: [] });
    groups.get(k).books.push({ b, n: s.n });
  }
  const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {list.map((g) => (
        <section class="lib-series">
          <h3 class="section-label pad">
            {g.name} <small>{seriesLine(g.books.map((x) => x.b), prog)}</small>
          </h3>
          <Books items={g.books.sort((x, y) => (x.n ?? 1e9) - (y.n ?? 1e9)).map((x) => x.b)} mode={mode} prog={prog} />
        </section>
      ))}
      {loose.length > 0 && (
        <section class="lib-series">
          <h3 class="section-label pad">{list.length ? 'Not in a series' : 'No series found yet'}</h3>
          <Books items={loose} mode={mode} prog={prog} />
        </section>
      )}
    </>
  );
}

/** "Find 37 missing covers": looks them all up in one go (Audible, Apple, Google, Open Library). */
function MissingCovers({ items, local }) {
  useStore(metaFixes);
  const [run, setRun] = useState(null); // { done, total, found }
  const phoneCover = (b) => b.source === 'loc' && (local.books || []).find((x) => x.uid === b.uid)?.cover;
  const missing = items.filter((b) => !coverNow(b) && !phoneCover(b));
  if (!missing.length && !run) return null;
  const go = async () => {
    setRun({ done: 0, total: missing.length, found: 0 });
    const r = await findMissingCovers(missing, (done, total, found) => setRun({ done, total, found }));
    setRun(null);
    toast(r.found ? `Found ${r.found} of ${r.total} covers` : 'No covers found for these — try “Find cover & details” on a book');
  };
  return (
    <button class="btn ghost-wide lib-manage" disabled={!!run} onClick={go}>
      {run ? (
        <>
          <span class="spinner small" /> Finding covers {run.done}/{run.total} · {run.found} found
        </>
      ) : (
        <>
          <Icon name="covers" size={16} /> Find {missing.length} missing cover{missing.length === 1 ? '' : 's'}
        </>
      )}
    </button>
  );
}
