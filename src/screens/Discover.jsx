import { useEffect, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { Grid, Empty, Skeleton, AskButton } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { searchAll, SOURCES, sourceRank } from '../sources/index.js';
import { persisted, useStore } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { BooksellerAnswer, askNow, looksLikeRequest, EXAMPLES } from '../components/bookseller.jsx';
import { SourceResults } from '../components/source-results.jsx';
import { sourceAddons } from '../sources/sourceaddons.js';
import { RelatedRows } from '../components/related.jsx';
import { PasteLink, isLink } from '../components/paste-link.jsx';
import { aiOn } from '../lib/ai.js';
import { DiscoverBrowse } from '../components/discover-tabs.jsx';

const recent = persisted('recentSearches', []);
let pendingQuery = '';

/** Jump to the Discover tab with a query already typed in. */
// Discover stays alive between tab switches: an open screen gets the query directly.
const searchSubs = new Set();
export function openSearch(q) {
  pendingQuery = q;
  if (searchSubs.size) {
    searchSubs.forEach((f) => f(q));
    pendingQuery = '';
  }
  nav.tab('discover');
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
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const f = (x) => setQ(x);
    searchSubs.add(f);
    return () => searchSubs.delete(f);
  }, []);
  const [hint] = useState(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]);
  const inputRef = useRef();

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (term.length < 2 || isLink(term)) return setResults({});
    let alive = true;
    setResults({});
    setPending(1);
    searchAll(term, (src, items, err) => {
      if (!alive) return;
      setResults((r) => ({ ...r, [src]: { items, err } }));
    }).then(() => alive && setPending(0));
    return () => (alive = false);
  }, [term]);

  const commit = (enter) => {
    if (enter && aiOn() && looksLikeRequest(q)) askNow(q);
    if (term.length < 2) return;
    recent.set((h) => [term, ...h.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 8));
  };

  return (
    <div class="screen discover">
      <div class="screen-head">
        <h1 class="screen-title">Discover</h1>
        <div class="d-acts">
          <button class="icon-btn" aria-label="Search" onClick={() => (setOpen(true), setTimeout(() => inputRef.current?.focus(), 30))}>
            <Icon name="search" size={22} />
          </button>
          <AskButton />
        </div>
      </div>
      {!(open || q) && <p class="d-tagline">Find your next great listen.</p>}
      <div class={'search-box' + (open || q ? '' : ' d-hidden')}>
        <Icon name="search" size={20} />
        <input
          ref={inputRef}
          value={q}
          placeholder={aiOn() ? 'Search, describe what you want, or paste a link…' : 'Search, or paste a link…'}
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && (commit(true), e.currentTarget.blur())}
          onBlur={() => commit()}
          enterkeyhint="search"
        />
        {q && (
          <button class="icon-btn" onClick={() => (setQ(''), setOpen(false))} aria-label="Clear">
            <Icon name="close" size={18} />
          </button>
        )}
      </div>

      {isLink(q) ? (
        <PasteLink q={q} />
      ) : term.length < 2 ? (
        <>
          {aiOn() && (
            <button class="search-hint" onClick={() => (setQ(hint), askNow(hint))}>
              <Icon name="sparkle" size={14} /> Try “{hint}”
            </button>
          )}
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
          <DiscoverBrowse />
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
      {aiOn() && term.split(/\s+/).length >= 3 && <BooksellerAnswer q={term} />}
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
