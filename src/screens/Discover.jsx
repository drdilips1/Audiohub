import { useEffect, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { Grid, Empty, Skeleton, AskButton, Row, Cover, cachedRow } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { searchAll, SOURCES, sourceRank } from '../sources/index.js';
import { audible } from '../sources/catalogs.js';
import { persisted, useStore } from '../lib/store.js';
import { GenreChips, recommendedForYou, topicPool, tasteTopics, notOwned } from './Home.jsx';
import { GENRES } from './genres.js';
import { rankForYou, fitsHours } from '../lib/taste.js';
import { fmtDuration } from '../lib/format.js';
import { nav } from '../lib/nav.js';
import { BooksellerAnswer, askNow, looksLikeRequest, EXAMPLES } from '../components/bookseller.jsx';
import { SourceResults } from '../components/source-results.jsx';
import { sourceAddons } from '../sources/sourceaddons.js';
import { RelatedRows } from '../components/related.jsx';
import { PasteLink, isLink } from '../components/paste-link.jsx';

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
// ---- Browsing (nothing typed yet) ----------------------------------------------

const weekNo = () => Math.floor((Date.now() / 864e5 + 4) / 7); // changes every Monday
const pickCache = persisted('pickOfWeek', { week: 0, book: null });

/** One book worth your week: the top of your recommendations, held for seven days. */
function PickOfWeek() {
  const cached = useStore(pickCache);
  const [book, setBook] = useState(cached.week === weekNo() && cached.book ? cached.book : null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (book) return;
    let alive = true;
    const choose = (list) => {
      const r = (list || []).filter((b) => b?.title && b.cover);
      if (!r.length) return false;
      const b = r[weekNo() % Math.min(r.length, 5)];
      const slim = { uid: b.uid, source: b.source, title: b.title, author: b.author, cover: b.cover, duration: b.duration, rating: b.rating, match: b.match, why: b.why, kind: b.kind, genres: b.genres };
      pickCache.set({ week: weekNo(), book: slim });
      if (alive) setBook(slim);
      return true;
    };
    // Home's recommendations are usually loaded already; otherwise ask, then fall back to best sellers.
    (async () => {
      if (choose(cachedRow('homeRec'))) return;
      if (choose(await recommendedForYou().catch(() => []))) return;
      if (choose(await trending().catch(() => []))) return;
      if (alive) setFailed(true);
    })();
    return () => (alive = false);
  }, []);
  if (failed) return null;
  if (!book) return <div class="pick-hero pick-skel shimmer" />;
  const open = () => nav.push('book', { book });
  return (
    <button class="pick-hero" onClick={open}>
      {book.cover && <div class="pick-bg" style={{ backgroundImage: `url("${book.cover}")` }} />}
      <Cover book={book} eager />
      <div class="pick-text">
        <em>Pick of the week</em>
        <b>{book.title}</b>
        <small>
          {book.author}
          {book.duration ? ` · ${fmtDuration(book.duration)}` : ''}
        </small>
        <small>
          {book.rating ? `★ ${Number(book.rating).toFixed(1)}` : ''}
          {book.rating && book.match ? ' · ' : ''}
          {book.match ? `fits your taste ${book.match}%` : ''}
        </small>
        <span class="pick-btn">
          <Icon name="play" size={14} /> Listen
        </span>
      </div>
    </button>
  );
}

// Each mood is a shelf: Audible best sellers for a few keywords, ranked for your taste.
// One request per keyword (Audible's 40 best sellers), all at once; the list is kept
// for 12 hours so opening a mood again is instant (and refreshed in the background).
const moodCache = persisted('moodShelves', {}, { delay: 2000 });
const KEEP = ['uid', 'source', 'kind', 'title', 'author', 'narrator', 'cover', 'duration', 'rating', 'ratings', 'genres', 'year', 'released', 'link', 'match', 'why'];
const slimBook = (b) => Object.fromEntries(KEEP.filter((k) => b[k] !== undefined && b[k] !== '').map((k) => [k, k === 'genres' ? b[k].slice(0, 6) : b[k]]));
const moodShelf = (keys, { hours, sort } = {}) => {
  const fetchList = async () => {
    const lists = await Promise.all((typeof keys === 'function' ? keys() : keys).map((k) => audible.genre(k).catch(() => [])));
    const seen = new Set();
    const all = [];
    for (let i = 0; i < 40; i++)
      for (const p of lists) {
        const b = p[i];
        if (b && !seen.has(b.uid)) seen.add(b.uid) && all.push(b);
      }
    let list = notOwned(all).filter((b) => fitsHours(b, hours));
    const ranked = rankForYou(list);
    list = ranked.length >= 8 ? ranked : list;
    if (sort) list = [...list].sort(sort);
    return list.slice(0, 60).map(({ rank, ...b }) => slimBook(b));
  };
  return async () => {
    const id = (typeof keys === 'function' ? keys() : keys).join('|') + (hours || '');
    const hit = moodCache.get()[id];
    const save = (items) => items.length && moodCache.set((c) => ({ ...c, [id]: { t: Date.now(), items } }));
    if (hit?.items?.length) {
      if (Date.now() - hit.t > 12 * 3600e3) fetchList().then(save).catch(() => {});
      return hit.items;
    }
    const items = await fetchList();
    save(items);
    return items;
  };
};
const byRating = (a, b) => (b.rating || 0) * Math.log10((b.ratings || 0) + 10) - (a.rating || 0) * Math.log10((a.ratings || 0) + 10);
const MOODS = [
  ['💡', 'Learn something', 'big ideas, science', 160, moodShelf(['popular science', 'big ideas'])],
  ['🌙', 'Wind down', 'calm, gentle', 250, moodShelf(['cozy', 'nature writing', 'meditation'])],
  ['😂', 'Make me laugh', 'humour, memoir', 40, moodShelf(['humor', 'comedy memoir'])],
  ['⏱', 'Short listen', 'under 5 hours', 190, moodShelf(() => tasteTopics().map((g) => g.au || g.name), { hours: '0-5', sort: byRating })],
  ['🔥', 'Can’t stop', 'thrillers, sci-fi', 0, moodShelf(['thriller', 'science fiction'])],
  ['🧘', 'Grow', 'self-help', 300, moodShelf(['self development', 'personal success'])],
];

function MoodTiles() {
  return (
    <section class="mood-section">
      <h3 class="section-label">What are you in the mood for?</h3>
      <div class="mood-grid">
        {MOODS.map(([icon, title, sub, hue, load]) => (
          <button class="mood-tile" style={{ '--h': hue }} onClick={() => nav.push('shelf', { title: `${icon} ${title}`, subtitle: sub[0].toUpperCase() + sub.slice(1), load })}>
            <i>{icon}</i>
            <b>{title}</b>
            <small>{sub}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

const FAV_GENRES = [
  ['🧠', 'Psychology', 'Psychology & Human Behavior'],
  ['🧬', 'Science', 'Science & Biology'],
  ['🔭', 'Cosmos', 'Cosmos & Physics'],
  ['🏛', 'History', 'History & Civilization'],
  ['💰', 'Money', 'Money, Economics & Capitalism'],
  ['🕉', 'Spirituality', 'Spirituality & Consciousness'],
];

function GenreTiles() {
  const [all, setAll] = useState(false);
  return (
    <section>
      <h3 class="section-label">
        Browse by genre
        <button class="link-btn label-more" onClick={() => setAll(!all)}>
          {all ? 'Less' : 'All ›'}
        </button>
      </h3>
      {all ? (
        <div class="genre-grid">
          <GenreChips />
        </div>
      ) : (
        <div class="genre-tiles">
          {FAV_GENRES.map(([icon, label, name]) => {
            const g = GENRES.find((x) => x.name === name);
            return (
              g && (
                <button class="genre-tile" style={{ '--h': g.hue }} onClick={() => nav.push('browse', { genre: g })}>
                  <i>{icon}</i>
                  <b>{label}</b>
                </button>
              )
            );
          })}
        </div>
      )}
    </section>
  );
}

async function trending() {
  const now = Date.now();
  const all = notOwned(await topicPool());
  const fresh = all.filter((b) => b.released && b.released >= now - 548 * 864e5);
  return (fresh.length >= 8 ? fresh : all).slice(0, 30).map(({ rank, ...b }) => b);
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
    if (enter && looksLikeRequest(q)) askNow(q);
    if (term.length < 2) return;
    recent.set((h) => [term, ...h.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 8));
  };

  return (
    <div class="screen discover">
      <div class="screen-head">
        <h1 class="screen-title">Discover</h1>
        <AskButton />
      </div>
      <div class="search-box">
        <Icon name="search" size={20} />
        <input
          ref={inputRef}
          value={q}
          placeholder="Search, describe what you want, or paste a link…"
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && (commit(true), e.currentTarget.blur())}
          onBlur={() => commit()}
          enterkeyhint="search"
        />
        {q && (
          <button class="icon-btn" onClick={() => (setQ(''), inputRef.current?.focus())} aria-label="Clear">
            <Icon name="close" size={18} />
          </button>
        )}
      </div>

      {isLink(q) ? (
        <PasteLink q={q} />
      ) : term.length < 2 ? (
        <>
          <button class="search-hint" onClick={() => (setQ(hint), askNow(hint))}>
            <Icon name="sparkle" size={14} /> Try “{hint}”
          </button>
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
          <PickOfWeek />
          <MoodTiles />
          <GenreTiles />
          <Row title="Trending this week" subtitle="Best sellers in your topics" cacheKey="discTrend" load={trending} deps={[]} onMore={() => nav.push('shelf', { title: 'Trending this week', subtitle: 'Best sellers in your topics', load: trending })} />
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
      {term.split(/\s+/).length >= 3 && <BooksellerAnswer q={term} />}
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
