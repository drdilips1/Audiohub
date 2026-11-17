// Discover, browsing (nothing typed): four tabs — For you, Moods, Genres, Lists — each section
// with the same head (icon, title, See all), covers on the card edge, equal-width chips.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Row, Cover, Skeleton, Grid, cachedRow } from './common.jsx';
import { Icon } from './icons.jsx';
import { persisted, useStore, progress, settings } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { fmtDuration } from '../lib/format.js';
import { mainTitle, matches } from '../lib/match.js';
import { rankForYou, fitsHours, scoreBook } from '../lib/taste.js';
import { anchorBooks, tasteShelves } from '../lib/shelves.js';
import { seriesOf, seriesBooks, statusIn, nextIn } from '../lib/series.js';
import { fixFor } from '../lib/meta.js';
import { audible } from '../sources/catalogs.js';
import { absSrc } from '../sources/index.js';
import { localCfg } from '../sources/local.js';
import * as itunes from '../sources/itunes.js';
import { GenreChips, recommendedForYou, topicPool, tasteTopics, notOwned } from '../screens/Home.jsx';
import { GENRES } from '../screens/genres.js';

export const discTab = persisted('discoverTab', 'you');
const TABS = [
  ['you', 'For you'],
  ['moods', 'Moods'],
  ['genres', 'Genres'],
  ['lists', 'Lists'],
];

/** The section head used everywhere on Discover: icon, title, See all →, and a note under it. */
function Head({ icon, title, note, onMore, more = 'See all' }) {
  return (
    <>
      <div class="d-head">
        <span class="d-ico">
          <Icon name={icon} size={20} />
        </span>
        <h3>{title}</h3>
        {onMore && (
          <button class="d-more" onClick={onMore}>
            {more} <Icon name="arrow" size={15} />
          </button>
        )}
      </div>
      {note && <p class="d-note">{note}</p>}
    </>
  );
}

// ---- shared lists ---------------------------------------------------------------
const FICTION = /fiction|romance|fantasy|thriller|mystery|suspense|horror|teen|young adult|children|erotica|sci-fi|science fiction|litrpg|graphic novel|comics/i;
const isFiction = (b) => (b.genres || []).some((g) => FICTION.test(g));

export async function trending() {
  const now = Date.now();
  const all = notOwned(await topicPool());
  const fresh = all.filter((b) => b.released && b.released >= now - 548 * 864e5);
  return (fresh.length >= 8 ? fresh : all).slice(0, 30).map(({ rank, ...b }) => b);
}

// Each mood is a shelf: Audible best sellers for a few keywords, ranked for your taste, kept 12 hours.
const moodCache = persisted('moodShelves', {}, { delay: 2000 });
const KEEP = ['uid', 'source', 'kind', 'title', 'author', 'narrator', 'cover', 'duration', 'rating', 'ratings', 'genres', 'year', 'released', 'link', 'match', 'why'];
const slimBook = (b) => Object.fromEntries(KEEP.filter((k) => b[k] !== undefined && b[k] !== '').map((k) => [k, k === 'genres' ? b[k].slice(0, 6) : b[k]]));
const byRating = (a, b) => (b.rating || 0) * Math.log10((b.ratings || 0) + 10) - (a.rating || 0) * Math.log10((a.ratings || 0) + 10);
export const moodShelf = (keys, { hours, sort } = {}) => {
  const list = () => (typeof keys === 'function' ? keys() : keys);
  const fetchList = async () => {
    const lists = await Promise.all(list().map((k) => audible.genre(k).catch(() => [])));
    const seen = new Set();
    const all = [];
    for (let i = 0; i < 40; i++)
      for (const p of lists) {
        const b = p[i];
        if (b && !seen.has(b.uid)) seen.add(b.uid) && all.push(b);
      }
    let out = notOwned(all).filter((b) => fitsHours(b, hours));
    const ranked = rankForYou(out);
    out = ranked.length >= 8 ? ranked : out;
    if (sort) out = [...out].sort(sort);
    return out.slice(0, 60).map(({ rank, ...b }) => slimBook(b));
  };
  return async () => {
    const id = list().join('|') + (hours || '');
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
const tagged = (list) => list.map((b) => (b.match ? { ...b, tag: `${b.match}% match` } : b));

// ---- For you ----------------------------------------------------------------------
const weekNo = () => Math.floor((Date.now() / 864e5 + 4) / 7);
const pickCache = persisted('pickOfWeek', { week: 0, book: null });

/** The top of your recommendations, held for a week, with why it was picked. */
function PickedForYou() {
  const cached = useStore(pickCache);
  const [book, setBook] = useState(cached.week === weekNo() && cached.book ? cached.book : null);
  const [failed, setFailed] = useState(false);
  const [why, setWhy] = useState(false);
  useEffect(() => {
    if (book) return;
    let alive = true;
    const choose = (list) => {
      const r = (list || []).filter((b) => b?.title && b.cover);
      if (!r.length) return false;
      const b = r[weekNo() % Math.min(r.length, 5)];
      const slim = { uid: b.uid, source: b.source, title: b.title, author: b.author, narrator: b.narrator, cover: b.cover, duration: b.duration, rating: b.rating, ratings: b.ratings, match: b.match, why: b.why, kind: b.kind, genres: b.genres };
      pickCache.set({ week: weekNo(), book: slim });
      if (alive) setBook(slim);
      return true;
    };
    (async () => {
      if (choose(cachedRow('homeRec'))) return;
      if (choose(await recommendedForYou().catch(() => []))) return;
      if (choose(await trending().catch(() => []))) return;
      if (alive) setFailed(true);
    })();
    return () => (alive = false);
  }, []);
  const reasons = useMemo(() => {
    if (!book) return [];
    const r = scoreBook(book).reasons;
    return [...new Set([book.why, ...r].filter(Boolean))].slice(0, 3);
  }, [book?.uid]);
  if (failed) return null;
  const open = () => nav.push('book', { book });
  return (
    <section class="d-sec">
      <Head icon="sparkle" title="Picked for your taste" onMore={() => nav.push('shelf', { title: 'Picked for your taste', subtitle: 'Best matches for you', load: recommendedForYou })} />
      {!book ? (
        <div class="d-card d-pick shimmer" />
      ) : (
        <div class="d-card">
          <div class="d-pick" onClick={open}>
            <Cover book={book} eager />
            <div class="d-pick-m">
              {book.match ? (
                <span class="d-badge">
                  <Icon name="check" size={13} /> {book.match}% your taste
                </span>
              ) : null}
              <b>{book.title}</b>
              <small>
                {book.author}
                {book.duration ? ` · ${fmtDuration(book.duration)}` : ''}
              </small>
              <div class="d-pick-foot">
                <div class="d-chips">
                  {(book.genres || []).slice(0, 2).map((g) => (
                    <span>{String(g).split(/ & |, /)[0]}</span>
                  ))}
                </div>
                <span class="d-play">
                  <Icon name="play" size={18} solid />
                </span>
              </div>
            </div>
          </div>
          {reasons.length > 0 && (
            <button class="d-why" onClick={() => setWhy(!why)}>
              <Icon name="headphones" size={15} /> Why this pick? <Icon name={why ? 'up' : 'down'} size={14} />
            </button>
          )}
          {why && (
            <ul class="d-why-list">
              {reasons.map((r) => (
                <li>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Books on your server or this phone you've never started, best match first. */
async function hiddenGems() {
  const prog = progress.get();
  const started = Object.values(prog).filter((p) => p?.book?.title);
  const have = [...(absSrc.connected() ? await absSrc.all().catch(() => []) : []), ...(localCfg.get().books || []).filter((b) => b.kind !== 'text')];
  const seen = new Set();
  const out = [];
  for (const b0 of have) {
    if (!b0?.title || prog[b0.uid]) continue;
    const fix = fixFor(b0.uid);
    const b = fix?.title ? { ...b0, title: fix.title, author: fix.author || b0.author } : b0;
    const t = mainTitle(b.title);
    const k = t.toLowerCase();
    if (!k || seen.has(k) || started.some((p) => matches(t, p.book.title))) continue;
    seen.add(k);
    out.push({ ...b, match: scoreBook(b).match });
  }
  return tagged(out.sort((a, b) => b.match - a.match).slice(0, 30));
}

const SHORT = [
  ['0-3', 'Under 3h'],
  ['3-5', '3–5h'],
  ['5-8', '5–8h'],
  ['8-', '8h+'],
];
const shortPick = persisted('discShort', '0-3');
function ShortListens() {
  const pick = useStore(shortPick);
  const label = SHORT.find((x) => x[0] === pick)?.[1] || '';
  const load = moodShelf(() => tasteTopics().map((g) => g.au || g.name), { hours: pick, sort: byRating });
  return (
    <section class="d-sec">
      <Head icon="clock" title="Short listens" note="Your kind of book, done in an evening or two." onMore={() => nav.push('shelf', { title: `Short listens · ${label}`, subtitle: 'Your topics, best rated first', load })} />
      <div class="d-eq d-eq4">
        {SHORT.map(([k, l]) => (
          <button class={pick === k ? 'on' : ''} onClick={() => shortPick.set(k)}>
            {l}
          </button>
        ))}
      </div>
      <Row key={pick} title="" load={async () => tagged(await load())} cacheKey={'discShort' + pick} deps={[pick]} />
    </section>
  );
}

/** Series you're in: the next book, with how far through the series you are. */
function ContinueSeries() {
  const [cards, setCards] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const mine = Object.values(progress.get())
        .filter((p) => p?.book?.title && p.book.kind !== 'text' && p.book.source !== 'pod')
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      const done = new Set();
      const out = [];
      for (const p of mine.slice(0, 25)) {
        const s = seriesOf(p.book);
        if (!s?.name || done.has(s.name.toLowerCase())) continue;
        done.add(s.name.toLowerCase());
        const books = await seriesBooks(s.name, p.book.author).catch(() => []);
        if (books.length < 2) continue;
        const list = statusIn(books);
        const next = nextIn(list);
        if (!next || next.state === 'reading') continue; // a book in progress is on Home already
        out.push({ name: s.name, next: next.book, n: list.indexOf(next) + 1, total: list.length, finished: list.filter((x) => x.state === 'finished').length });
        if (out.length >= 2) break;
      }
      if (alive) setCards(out);
    })();
    return () => (alive = false);
  }, []);
  if (!cards?.length) return null;
  return (
    <section class="d-sec">
      <Head icon="layers" title="Continue a series" />
      {cards.map((c) => (
        <button class="d-card d-series" onClick={() => nav.push('book', { book: c.next })}>
          <Cover book={c.next} />
          <div class="d-series-m">
            <b>{c.name}</b>
            <small>
              Next: {mainTitle(c.next.title)} · {c.n} of {c.total}
            </small>
            <div class="d-prog">
              <i style={{ width: `${Math.round((c.finished / c.total) * 100)}%` }} />
            </div>
          </div>
          <span class="d-play">
            <Icon name="play" size={18} solid />
          </span>
        </button>
      ))}
    </section>
  );
}

/** "Because you enjoyed…": the book it's built on, opening the shelf of picks. */
function BecauseYouEnjoyed() {
  const shelf = useMemo(() => tasteShelves().find((s) => s.key.startsWith('enjoyed:')), []);
  const anchor = useMemo(() => anchorBooks(1)[0], []);
  if (!shelf || !anchor) return null;
  const open = () => nav.push('shelf', { title: shelf.title, subtitle: shelf.subtitle, load: shelf.load });
  return (
    <section class="d-sec">
      <Head icon="star" title="Because you enjoyed…" more="More" onMore={open} />
      <button class="d-card d-bec" onClick={open}>
        <Cover book={anchor} />
        <div class="d-bec-m">
          <b>{mainTitle(anchor.title)}</b>
          <small>{shelf.subtitle}</small>
          <em>See the picks</em>
        </div>
        <Icon name="chevron" size={18} />
      </button>
    </section>
  );
}

/** One strong pick from your taste, opened ready to play. */
function SurpriseMe() {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const list = (cachedRow('homeRec') || []).length ? cachedRow('homeRec') : await recommendedForYou();
      const top = (list || []).filter((b) => b?.title).slice(0, 15);
      if (top.length) nav.push('book', { book: top[Math.floor(Math.random() * top.length)] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="d-surprise">
      <div>
        <b>
          <Icon name="wand" size={20} /> Surprise me
        </b>
        <p>One strong pick from your taste, ready to play.</p>
        <button class="d-pill" disabled={busy} onClick={go}>
          {busy ? <span class="spinner small" /> : 'Pick a book'} <Icon name="chevron" size={15} />
        </button>
      </div>
      <div class="d-stack" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

function ForYou() {
  return (
    <>
      <PickedForYou />
      <section class="d-sec d-rowsec">
        <Head icon="gem" title="Hidden gems you own" note="On your server or this phone, never started." onMore={() => nav.push('shelf', { title: 'Hidden gems you own', subtitle: 'Never started, best match first', load: hiddenGems })} />
        <Row title="" load={hiddenGems} cacheKey="discGems" deps={[]} />
      </section>
      <ShortListens />
      <ContinueSeries />
      <BecauseYouEnjoyed />
      <SurpriseMe />
    </>
  );
}

// ---- Moods --------------------------------------------------------------------------
const MOODS = [
  ['mind', 'brain', 'Mind-bending', 'Big ideas', 265, ['popular science', 'big ideas']],
  ['calm', 'moon', 'Wind down', 'Calm, gentle', 205, ['cozy', 'nature writing', 'meditation']],
  ['rush', 'bolt', 'Can’t stop', 'Feel the rush', 8, ['thriller', 'science fiction']],
  ['grow', 'sprout', 'Inspiring', 'Be your best', 45, ['self development', 'personal success']],
  ['fun', 'smile', 'Funny', 'Laugh out loud', 330, ['humor', 'comedy memoir']],
  ['epic', 'map', 'Escape', 'Epic worlds', 150, ['epic fantasy', 'space opera']],
];
const LENGTHS = [
  ['', 'Any'],
  ['0-5', 'Under 5h'],
  ['5-12', '5–12h'],
  ['12-', '12h+'],
];
const KINDS = [
  ['', 'Both'],
  ['fic', 'Fiction'],
  ['non', 'Non-fiction'],
];
const moodPick = persisted('discMood', { mood: 'mind', hours: '', kind: '' });
function Moods() {
  const pick = useStore(moodPick);
  const set = (p) => moodPick.set((x) => ({ ...x, ...p }));
  const m = MOODS.find((x) => x[0] === pick.mood) || MOODS[0];
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    setItems(null);
    moodShelf(m[5], { hours: pick.hours })()
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]));
    return () => (alive = false);
  }, [pick.mood, pick.hours]);
  const shown = items && tagged(items.filter((b) => (pick.kind === 'fic' ? isFiction(b) : pick.kind === 'non' ? !isFiction(b) : true)));
  const lenLabel = LENGTHS.find((x) => x[0] === pick.hours)?.[1];
  return (
    <>
      <section class="d-sec">
        <Head icon="sparkle" title="How do you want to feel?" />
        <div class="d-moods">
          {MOODS.map(([k, icon, title, sub, hue]) => (
            <button class={'d-mood' + (k === m[0] ? ' on' : '')} style={{ '--h': hue }} onClick={() => set({ mood: k })}>
              <span class="d-mood-i">
                <Icon name={icon} size={18} />
              </span>
              <span>
                <b>{title}</b>
                <small>{sub}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section class="d-sec">
        <Head icon="clock" title="How long?" />
        <div class="d-eq d-eq4">
          {LENGTHS.map(([k, l]) => (
            <button class={pick.hours === k ? 'on' : ''} onClick={() => set({ hours: k })}>
              {l}
            </button>
          ))}
        </div>
      </section>
      <section class="d-sec">
        <div class="d-seg">
          {KINDS.map(([k, l]) => (
            <button class={pick.kind === k ? 'on' : ''} onClick={() => set({ kind: k })}>
              {l}
            </button>
          ))}
        </div>
      </section>
      <section class="d-sec">
        <Head icon={m[1]} title={`${m[2]}${pick.hours ? ` · ${lenLabel}` : ''}`} note="Best match first, not in your library." />
        {!shown ? (
          <div class="grid">{Array.from({ length: 6 }, () => <Skeleton />)}</div>
        ) : shown.length ? (
          <Grid items={shown} />
        ) : (
          <p class="muted">Nothing for this mix — try another length or Both.</p>
        )}
      </section>
    </>
  );
}

// ---- Genres and Lists ----------------------------------------------------------------
const FAV_GENRES = [
  ['🧠', 'Psychology', 'Psychology & Human Behavior'],
  ['🧬', 'Science', 'Science & Biology'],
  ['🔭', 'Cosmos', 'Cosmos & Physics'],
  ['🏛', 'History', 'History & Civilization'],
  ['💰', 'Money', 'Money, Economics & Capitalism'],
  ['🕉', 'Spirituality', 'Spirituality & Consciousness'],
];
function Genres() {
  return (
    <>
      <section class="d-sec">
        <Head icon="star" title="Your favourites" />
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
      </section>
      <section class="d-sec">
        <Head icon="grid" title="All genres" />
        <div class="genre-grid">
          <GenreChips />
        </div>
      </section>
    </>
  );
}

function Lists() {
  return (
    <section class="d-rows">
      <Row title="Trending this week" subtitle="Best sellers in your topics" icon="flame" cacheKey="discTrend" load={trending} deps={[]} onMore={() => nav.push('shelf', { title: 'Trending this week', subtitle: 'Best sellers in your topics', load: trending })} />
      <Row title="Top audiobooks" subtitle="Apple Books charts" icon="chart" cacheKey="itTop" load={() => itunes.top()} deps={[]} onMore={() => nav.push('shelf', { title: 'Top audiobooks', subtitle: 'Apple Books charts', load: () => itunes.top() })} />
      <Row title="New audiobooks" subtitle="Released this year" icon="sparkle" cacheKey="itNew" load={() => itunes.newest()} deps={[]} onMore={() => nav.push('shelf', { title: 'New audiobooks', subtitle: 'Released this year', load: () => itunes.newest() })} />
    </section>
  );
}

/** Tabs and the chosen tab's content. */
export function DiscoverBrowse() {
  const tab = useStore(discTab);
  useStore(settings);
  return (
    <div class="disc2">
      <div class="d-tabs">
        {TABS.map(([k, l]) => (
          <button class={tab === k ? 'on' : ''} onClick={() => discTab.set(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'moods' ? <Moods /> : tab === 'genres' ? <Genres /> : tab === 'lists' ? <Lists /> : <ForYou />}
    </div>
  );
}
