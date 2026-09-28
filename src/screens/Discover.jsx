import { useEffect, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { Grid, Empty, Skeleton } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { searchAll, SOURCES, sourceRank, sourceOrder, ia, gb, ol, absSrc, cloud, hc, gr } from '../sources/index.js';
import { openExternal } from '../sources/summaries.js';
import { audible, googleBooks } from '../sources/catalogs.js';
import { settings } from '../lib/store.js';
import { HINDI_ALL } from './hindi.js';
import { persisted, useStore } from '../lib/store.js';
import { GenreChips } from './Home.jsx';
import { nav } from '../lib/nav.js';
import { AskBookseller } from '../components/bookseller.jsx';
import { SourceResults } from '../components/source-results.jsx';
import { sourceAddons } from '../sources/sourceaddons.js';
import { RelatedRows } from '../components/related.jsx';

const recent = persisted('recentSearches', []);
let pendingQuery = '';

/** Jump to the Discover tab with a query already typed in. */
export function openSearch(q) {
  pendingQuery = q;
  nav.tab('discover');
}
/** What tapping a source tile opens: its books, or Settings when it isn't set up. */
function openSource(k) {
  const shelf = (title, subtitle, load) => nav.push('shelf', { title, subtitle, load });
  const setup = () => nav.tab('settings');
  switch (k) {
    case 'abs':
      return absSrc.connected() ? shelf('Audiobookshelf', 'Your whole library', absSrc.all) : setup();
    case 'tb':
      return cloud.tbConnected() ? shelf('Your TorBox', 'Audiobooks in your TorBox cloud', cloud.torboxLibrary) : setup();
    case 'rd':
      return cloud.rdConnected() ? shelf('Your Real-Debrid', 'Audiobooks in your Real-Debrid cloud', cloud.realdebridLibrary) : setup();
    case 'hc':
      return hc.connected() ? shelf('Hardcover', 'All your shelves', () => hc.allShelves()) : setup();
    case 'gr':
      return gr.shelves().length ? shelf('Goodreads', 'All your shelves', async () => gr.shelves().flatMap((x) => gr.shelf(x))) : setup();
    case 'au':
      return shelf('Audible bestsellers', 'Audible catalog', () => audible.genre('bestsellers'));
    case 'gbk':
      return shelf('Google Books', 'Popular listings', () => googleBooks.search('bestseller'));
    case 'ia':
    case 'lv':
      return shelf('Most listened', 'LibriVox via Internet Archive', ia.popular);
    case 'gb':
      return shelf('Classics to read', 'Project Gutenberg · most downloaded', () => gb.popular(settings.get().language));
    case 'ol':
      return shelf('Trending this week', 'Open Library readers', () => ol.trending('weekly'));
    case 'hi':
      return nav.push('browse', { genre: HINDI_ALL });
    default:
      return setup();
  }
}

const FILTERS = [
  ['all', 'All'],
  ['audio', 'Listen'],
  ['text', 'Read'],
  ['discover', 'Discover'],
];

export function Discover() {
  const [q, setQ] = useState(() => {
    const p = pendingQuery;
    pendingQuery = '';
    return p;
  });
  const [term, setTerm] = useState('');
  const [results, setResults] = useState({});
  const [pending, setPending] = useState(0);
  const [filter, setFilter] = useState('all');
  const history = useStore(recent);
  const inputRef = useRef();

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (term.length < 2) return setResults({});
    let alive = true;
    setResults({});
    setPending(1);
    searchAll(term, (src, items, err) => {
      if (!alive) return;
      setResults((r) => ({ ...r, [src]: { items, err } }));
    }).then(() => alive && setPending(0));
    return () => (alive = false);
  }, [term]);

  const commit = () => {
    if (term.length < 2) return;
    recent.set((h) => [term, ...h.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 8));
  };

  return (
    <div class="screen discover">
      <h1 class="screen-title">Discover</h1>
      <div class="search-box">
        <Icon name="search" size={20} />
        <input
          ref={inputRef}
          value={q}
          placeholder="Titles, authors, subjects…"
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && (commit(), e.currentTarget.blur())}
          onBlur={commit}
          enterkeyhint="search"
        />
        {q && (
          <button class="icon-btn" onClick={() => (setQ(''), inputRef.current?.focus())} aria-label="Clear">
            <Icon name="close" size={18} />
          </button>
        )}
      </div>

      {term.length < 2 ? (
        <>
          <AskBookseller />
          {history.length > 0 && (
            <section class="recent">
              <h3>Recent</h3>
              <div class="chips">
                {history.map((h) => (
                  <button class="pill" onClick={() => setQ(h)}>
                    {h}
                  </button>
                ))}
                <button class="pill ghost" onClick={() => recent.set([])}>
                  Clear
                </button>
              </div>
            </section>
          )}
          <h3 class="section-label">Browse genres</h3>
          <div class="genre-grid">
            <GenreChips />
          </div>
          <h3 class="section-label">Sources</h3>
          <div class="source-cards">
            {sourceOrder().map((k) => [k, SOURCES[k]]).map(([k, s]) => (
              <button class="source-card" style={{ '--h': s.hue }} onClick={() => openSource(k)}>
                <b>{s.name}</b>
                <span>{s.blurb}</span>
                <em>{s.kind}</em>
              </button>
            ))}
          </div>
        </>
      ) : (
        <Results results={results} filter={filter} setFilter={setFilter} term={term} pending={pending} />
      )}
      <div class="footer-space" />
    </div>
  );
}

// Results are drawn separately from the search box so typing doesn't redraw every grid.
const Results = memo(function Results({ results, filter, setFilter, term, pending }) {
  const groups = Object.entries(results)
    .map(([src, r]) => [src, r.items.filter((b) => filter === 'all' || b.kind === filter)])
    .filter(([, items]) => items.length)
    .sort((a, b) => sourceRank(a[0]) - sourceRank(b[0]));
  const total = groups.reduce((a, [, i]) => a + i.length, 0);
  // Seed for "related" rows: the top Audible hit, else the first result anywhere.
  const seed = results.au?.items?.[0] || groups.flatMap(([, i]) => i).find((b) => b.kind !== 'text') || null;
  return (
    <>
      <div class="segmented">
        {FILTERS.map(([k, label]) => (
          <button class={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>
      {pending > 0 && !total && <div class="grid">{Array.from({ length: 6 }, () => <Skeleton />)}</div>}
      {groups.map(([src, items]) => (
        <ResultGroup key={src} src={src} items={items} />
      ))}
      {sourceAddons().length > 0 && (filter === 'all' || filter === 'audio' || filter === 'text') && <SourceResults query={term} title={term} />}
      {(results.au || !pending) && seed && <RelatedRows book={seed} label={seed.title} />}
      {!pending && !total && !sourceAddons().length && (
        <Empty icon="search" title="No matches">
          Nothing found for “{term}”. Try an author's surname or a shorter title.
        </Empty>
      )}
    </>
  );
});

const FIRST = 9;
function ResultGroup({ src, items }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <section class="result-group">
      <h3 class="section-label" style={{ '--h': SOURCES[src].hue }}>
        <span class="dot" /> {SOURCES[src].name} <small>{items.length}</small>
      </h3>
      <Grid items={shown} />
      {items.length > FIRST && (
        <button class="btn ghost-wide" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}
