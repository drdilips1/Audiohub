import { useEffect, useState } from 'preact/hooks';
import { TopBar, Grid, Skeleton, Empty, Row } from '../components/common.jsx';
import { ia, absSrc, cloud, hc, enabled } from '../sources/index.js';
import { audible } from '../sources/catalogs.js';
import { lookup } from '../lib/meta.js';
import { useStore } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { HINDI_GENRES, isHindi } from './hindi.js';
import { SourceResults } from '../components/source-results.jsx';
import { sourceAddons } from '../sources/sourceaddons.js';
import { rankForYou, fitsHours, HOURS, hoursPick } from '../lib/taste.js';

const TABS = [
  ['yours', 'For you'],
  ['best', 'Bestsellers'],
  ['trend', 'Trending'],
  ['top', 'Best of'],
];
const THIS_YEAR = new Date().getFullYear();
const YEARS = [THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2, THIS_YEAR - 3, THIS_YEAR - 4, 'all'];
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Your own books per genre, kept for the session: going back to a genre is instant.
const mineCache = new Map();
const yoursCached = (genre) => {
  const key = genre.name;
  const hit = mineCache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60e3) return hit.p;
  const p = yours(genre).catch(() => []);
  mineCache.set(key, { t: Date.now(), p });
  return p;
};

/**
 * For you: your own books in the genre, then Audible's popular, well-rated titles you don't
 * have. Calls onUpdate as each part arrives, so the page fills in without waiting for the
 * slowest service.
 */
function forYou(genre, connected, onUpdate) {
  let mine = connected ? null : [];
  let pool = null;
  const emit = () => {
    const have = new Set((mine || []).map((b) => norm(b?.title)));
    // Ranked by your taste (your ratings, what you finish, authors and narrators you like),
    // with poorly rated or poorly narrated titles and anything you already know left out.
    const picks = rankForYou((pool || []).filter((b) => !have.has(norm(b.title)))).map(({ rank, ...b }) => b);
    onUpdate({ mine: mine || [], picks, loadingMine: mine === null, loadingPicks: pool === null });
  };
  const jobs = [
    audible.pool(genre.au || genre.name).catch(() => []).then((r) => ((pool = r), emit())),
    connected ? yoursCached(genre).then((r) => ((mine = r), emit())) : null,
  ];
  return Promise.all(jobs);
}

const HINDI_TABS = [
  ['yours', 'आपकी किताबें'],
  ['sources', 'सोर्सेज़'],
  ['best', 'और सुझाव'],
];

const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

/** Books from the user's own services that fit a genre. */
async function yours(genre) {
  const fits = (b) => (genre.hindi ? isHindi(b) : true);
  const hits = (list) => list.filter((b) => fits(b) && ((b.genres || []).some((g) => genre.match.test(g)) || genre.match.test(b.title)));
  const safe = (p) => within(p.catch(() => []), 8000).then((r) => r || []);
  const [server, shelves, tb, rd] = await Promise.all([
    absSrc.connected() && enabled('abs') ? safe(absSrc.all()) : [],
    hc.connected() && enabled('hc') ? safe(hc.allShelves()) : [],
    cloud.tbConnected() && enabled('tb') ? safe(cloud.torboxLibrary()) : [],
    cloud.rdConnected() && enabled('rd') ? safe(cloud.realdebridLibrary()) : [],
  ]);
  // Debrid files have no genres of their own: borrow them from metadata lookups (cached).
  const files = [...tb, ...rd].slice(0, 80);
  const metas = await within(Promise.all(files.map((b) => lookup(b).catch(() => null))), 10000);
  const cloudHits = files
    .map((b, i) => ({ ...b, genres: metas?.[i]?.genres || [], cover: b.cover || metas?.[i]?.cover || '', title: metas?.[i]?.title || b.title, author: metas?.[i]?.author || b.author }))
    .filter((b) => fits(b) && (b.genres.some((g) => genre.match.test(g)) || (genre.hindi && genre.match.test(b.title))));
  const seen = new Set();
  return [...hits(server), ...cloudHits, ...hits(shelves)].filter((b) => !seen.has(b.uid) && seen.add(b.uid));
}

export function Browse({ genre }) {
  const connected = absSrc.connected() || hc.connected() || cloud.tbConnected() || cloud.rdConnected();
  const [tab, setTab] = useState(genre.hindi && sourceAddons().length ? 'sources' : genre.hindi && !connected ? 'best' : 'yours');
  const [items, setItems] = useState(null);
  const [year, setYear] = useState(THIS_YEAR - 1);
  const hours = useStore(hoursPick);
  const fit = (list) => (hours && !genre.hindi ? list.filter((b) => fitsHours(b, hours)) : list);
  useEffect(() => {
    setItems(null);
    if (tab === 'sources') return;
    let alive = true;
    if (!genre.hindi && tab === 'yours') {
      forYou(genre, connected, (r) => alive && (r.picks.length || r.mine.length || (!r.loadingMine && !r.loadingPicks)) && setItems(r));
      return () => (alive = false);
    }
    const job = genre.hindi
      ? tab === 'yours'
        ? yoursCached(genre)
        : tab === 'best'
          ? audible.hindi(genre.au).then((r) => (genre.en === 'Hindi' && r.length > 14 ? r.slice(10) : r)) // hub: Top Shows row has the first ten
          : ia.hindi(genre.ia)
      : tab === 'best'
          ? audible.genre(genre.au || genre.name)
          : tab === 'trend'
            ? audible.trending(genre.au || genre.name)
            : audible.bestOf(genre.au || genre.name, year);
    job.then((r) => alive && setItems(r)).catch(() => alive && setItems([]));
    return () => (alive = false);
  }, [tab, genre, year]);
  return (
    <div class="screen" style={{ '--h': genre.hue }}>
      <TopBar title={genre.name} />
      <div class="genre-banner">
        <h2>{genre.name}</h2>
        {genre.en && genre.en !== 'Hindi' && <small class="genre-en">{genre.en}</small>}
        <p>
          {genre.hindi
            ? tab === 'yours'
              ? 'Hindi books from your server, debrid libraries and Hardcover shelves.'
              : tab === 'sources'
                ? 'Hindi audiobooks found by your source addons — Play or add to TorBox / Real-Debrid.'
                : tab === 'best'
                ? 'Top Hindi audiobooks on Audible India — open one to find it in your sources.'
                : 'Free Hindi recordings on Internet Archive.'
            : tab === 'yours'
            ? connected
              ? "Your books in this genre, then popular, well-rated picks from Audible you don't have yet."
              : "Popular, well-rated picks from Audible — open one to find it in your debrid or addons."
            : tab === 'best'
              ? 'Top audiobooks — open one to find it in your debrid or addons.'
              : tab === 'trend'
                ? 'Popular new releases from the last year and a half.'
                : `The best-rated popular titles${year === 'all' ? ' of all time' : ` released in ${year}`}.`}
        </p>
      </div>
      {genre.en === 'Hindi' && enabled('au') && (
        <Row title="टॉप शोज़" subtitle="Top Hindi audiobooks right now · Audible India" icon="flame" load={() => audible.hindi('').then((r) => r.slice(0, 10))} deps={[]} />
      )}
      {genre.hindi && (
        <div class="genre-scroll hindi-cats" lang="hi">
          {HINDI_GENRES.filter((g) => g.name !== genre.name).map((g) => (
            <button class="genre-chip" style={{ '--h': g.hue }} onClick={() => nav.push('browse', { genre: g })}>
              {g.name}
            </button>
          ))}
        </div>
      )}
      <div class="segmented scroll">
        {(genre.hindi ? HINDI_TABS : TABS).filter(([k]) => (k !== 'yours' || connected || !genre.hindi) && (k !== 'sources' || sourceAddons().length > 0)).map(([k, label]) => (
          <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'top' && !genre.hindi && (
        <div class="chips year-chips">
          {YEARS.map((y) => (
            <button class={'pill small' + (year === y ? ' active' : '')} onClick={() => setYear(y)}>
              {y === 'all' ? 'All time' : y}
            </button>
          ))}
        </div>
      )}
      {!genre.hindi && tab !== 'sources' && (
        <div class="chips year-chips hours-chips" title="How long a listen you're after">
          {HOURS.map(([k, label]) => (
            <button class={'pill small' + (hours === k ? ' active' : '')} onClick={() => hoursPick.set(k)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === 'sources' ? (
        <SourceResults query={`hindi ${genre.en === 'Hindi' ? 'audiobook' : genre.en}`} heading={false} />
      ) : items === null ? (
        <div class="grid">{Array.from({ length: 9 }, () => <Skeleton />)}</div>
      ) : items.mine ? (
        fit(items.mine).length || fit(items.picks).length ? (
          <>
            {fit(items.mine).length > 0 && (
              <>
                <h3 class="section-label pad">In your collection</h3>
                <Grid items={fit(items.mine)} />
              </>
            )}
            {items.loadingMine && (
              <p class="muted pad browse-loading">
                <span class="spinner small" /> Checking your server and libraries…
              </p>
            )}
            {fit(items.picks).length > 0 && (
              <>
                <h3 class="section-label pad">Recommended for you</h3>
                <p class="muted pad small browse-hint">Sorted by how well each fits your taste. Rate books you've heard (on their page) to sharpen it.</p>
                <Grid items={fit(items.picks)} />
              </>
            )}
          </>
        ) : (
          <Empty title="Nothing here yet">{hours ? 'Nothing that length here — try another length.' : 'Try Bestsellers or another genre.'}</Empty>
        )
      ) : fit(items).length ? (
        <Grid items={fit(items)} />
      ) : (
        <Empty title="Nothing here yet">
          {hours && !genre.hindi ? 'Nothing that length here — try another length.' : tab === 'yours' ? `None of your books are tagged with this genre yet. Try ${genre.hindi ? 'Audible India' : 'Bestsellers'}.` : 'Try another tab or genre.'}
        </Empty>
      )}
      <div class="footer-space" />
    </div>
  );
}
