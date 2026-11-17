import { BgImage } from '../components/bg-image.jsx';
import { rankForYou, profile } from '../lib/taste.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Row, BookCard, withMeta, AskButton } from '../components/common.jsx';
import { openDrive } from '../components/drive-mode.jsx';
import { SceneButton } from '../components/scene-cmd.jsx';
import { useTileRating } from '../lib/ratings.js';
import { openExternal } from '../sources/summaries.js';
import { useMeta } from '../lib/meta.js';
import { useLocalCover } from '../sources/local.js';
import { picksForYou } from '../lib/bookseller.js';
import { mainTitle } from '../lib/match.js';
import { Icon } from '../components/icons.jsx';
import { ia, gb, ol, absSrc, addonSrc, cloud, localSrc, hc, gr, enabled, sourceOrder, sourceRank } from '../sources/index.js';
import { Fragment } from 'preact';
import { sameWork } from '../lib/works.js';
import { FollowRow } from '../components/follow-row.jsx';
import { progress, settings, addons, abs, debrid, hardcover, goodreads, useStore, persisted, library, toggleLibrary, hideFromContinue } from '../lib/store.js';
import { greeting, firstName, fmtDuration, hiResCover } from '../lib/format.js';
import { useSquareCover } from '../lib/meta.js';
import { UpNextRow, PlanRow } from '../components/up-next.jsx';
import { account } from '../lib/sync.js';
import { nav, useBackClose } from '../lib/nav.js';
import { GENRES } from './genres.js';
import { tasteShelves, moreLike } from '../lib/shelves.js';
import { HINDI_ALL } from './hindi.js';
import { audible } from '../sources/catalogs.js';
import { waitlist, cancel, playNow } from '../lib/waitlist.js';
import { toast, Cover } from '../components/common.jsx';
import { getDetails } from '../sources/index.js';
import * as player from '../lib/player.js';
import { rollTheme, previousLook } from '../lib/theme.js';

// Picks for the banner: the user's own services first; free classics only as a fallback.
// Shows the last banner instantly, then merges each service as it answers
// (a slow service never holds the others back).
const heroCache = persisted('heroCache', { items: [] });
// Books the banner has actually shown, and when (a few days kept): it brings new ones first,
// and a book seen recently goes to the back.
const heroSeen = persisted('heroSeen', {}, { delay: 2000 }); // uid -> when last on screen
const HERO_FORGET = 4 * 864e5;
function markHeroSeen(uid) {
  if (!uid) return;
  heroSeen.set((m) => {
    const now = Date.now();
    const next = {};
    for (const [k, t] of Object.entries(m)) if (now - t < HERO_FORGET) next[k] = t;
    next[uid] = now;
    return next;
  });
}

// Recommendations lead the banner: picks from your taste (AI with a free key,
// otherwise Audible's "listeners also enjoyed")
// and highly rated bestsellers you don't own; your own services follow.
const ownedTitles = () => {
  const t = new Set();
  for (const b of Object.values(library.get())) if (b?.title) t.add(mainTitle(b.title).toLowerCase());
  for (const p of Object.values(progress.get())) if (p?.book?.title) t.add(mainTitle(p.book.title).toLowerCase());
  return t;
};
export const notOwned = (list) => {
  const owned = ownedTitles();
  return (list || []).filter((b) => b?.title && !owned.has(mainTitle(b.title).toLowerCase()));
};
async function topRated() {
  const r = await audible.genre('bestsellers');
  return rankForYou(notOwned(r).filter((b) => (b.rating || 0) >= 4.5 && (b.ratings || 0) >= 200)).slice(0, 30);
}

// Store-style rows, non-fiction in your taste: your top categories (from what you listen to,
// save and rate), Psychology / Science / History until the app knows you better.
const FICTION = /fiction|romance|fantasy|thriller|mystery|suspense|horror|teen|young adult|children|erotica|sci-fi|science fiction|litrpg|graphic novel|comics/i;
const isFiction = (b) => (b.genres || []).some((g) => FICTION.test(g));
// Settings → Your taste → Fiction too: novels stay in.
const nonFiction = (list) => (settings.get().tasteFiction ? list || [] : (list || []).filter((b) => !isFiction(b)));
const DEFAULT_TOPICS = ['Psychology & Human Behavior', 'Science & Biology', 'History & Civilization'];
/** The topics the app learned from what you listen to, save and rate (up to `n`). */
export function learnedTopics(n = 3) {
  const p = profile();
  return GENRES.filter((g) => g.au)
    .map((g) => {
      let w = 0;
      for (const [name, v] of p.genres) if (g.match.test(name)) w += v.w;
      return [g, w];
    })
    .filter(([, w]) => w > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, n)
    .map(([g]) => g);
}
export function tasteTopics() {
  // Picked in Settings → Your taste: those first (or only them).
  const st = settings.get();
  const picked = GENRES.filter((g) => g.au && (st.tastePicks || []).includes(g.name));
  if (picked.length && st.tastePicksOnly) return picked;
  if (picked.length) {
    const more = learnedTopics(5).filter((g) => !picked.includes(g));
    return [...picked, ...more].slice(0, Math.max(3, picked.length));
  }
  const p = profile();
  const scored = GENRES.filter((g) => g.au) // the non-fiction categories
    .map((g) => {
      let w = 0;
      for (const [name, v] of p.genres) if (g.match.test(name)) w += v.w;
      return [g, w];
    })
    .filter(([, w]) => w > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([g]) => g);
  return scored.length ? scored : GENRES.filter((g) => DEFAULT_TOPICS.includes(g.name));
}
const topicNames = () =>
  tasteTopics()
    .map((g) => g.name.split(/ & |, /)[0])
    .join(', ');
// Best sellers in your topics, merged in rank order (1st of each, then 2nd of each…).
export async function topicPool() {
  const pools = await Promise.all(tasteTopics().map((g) => audible.pool(g.au || g.name).catch(() => [])));
  const out = [];
  const seen = new Set();
  for (let i = 0; i < 150; i++)
    for (const p of pools) {
      const b = p[i];
      if (b && !seen.has(b.uid)) seen.add(b.uid) && out.push(b);
    }
  return nonFiction(out);
}
export async function recommendedForYou() {
  const r = await picksForYou().catch(() => []);
  const noRank = ({ rank, ...b }) => b;
  const picks = nonFiction(r.length ? rankForYou(notOwned(r)) : []);
  if (picks.length >= 6) return picks.slice(0, 24).map(noRank);
  // Not enough yet: well-rated best sellers in your topics.
  const extra = rankForYou(notOwned(await topicPool())).filter((b) => !picks.some((x) => x.uid === b.uid));
  return [...picks, ...extra].slice(0, 24).map(noRank);
}
async function newReleases() {
  const now = Date.now();
  const all = notOwned(await topicPool()).filter((b) => b.released && b.released <= now);
  let fresh = all.filter((b) => b.released >= now - 120 * 864e5);
  if (fresh.length < 8) fresh = all.filter((b) => b.released >= now - 365 * 864e5);
  return fresh
    .sort((a, b) => b.released - a.released)
    .slice(0, 24)
    .map(({ rank, ...b }) => b);
}
async function topThisMonth() {
  const r = await topicPool();
  return r.slice(0, 20).map((b, i) => ({ ...b, rank: i + 1 }));
}

/**
 * Shelves that say why: "Because you enjoyed …", "More from authors you love", "Narrators like
 * the ones you love", "A little outside your comfort zone", and one per "More like this".
 * Only the ones there's something to build from (a new listener sees none yet).
 */
function TasteShelves() {
  const ml = useStore(moreLike);
  const shelves = useMemo(() => tasteShelves(), [ml]);
  return shelves.map((sh) => <Row key={sh.key} title={sh.title} subtitle={sh.subtitle} icon="sparkle" cacheKey={'shelf:' + sh.key} rec load={sh.load} deps={[sh.key]} />);
}

/** Explore categories: colourful tiles, two rows that scroll sideways. */
function CategoryTiles() {
  const list = [...(enabled('hi') ? [{ ...HINDI_ALL, name: 'हिंदी', hindi: true }] : []), ...GENRES];
  return (
    <section class="cat-section">
      <div class="row-head">
        <h2>Explore categories</h2>
      </div>
      <div class="cat-grid">
        {list.map((g) => (
          <button class="cat-tile" style={{ '--h': g.hue }} lang={g.hindi ? 'hi' : undefined} onClick={() => nav.push('browse', { genre: g.hindi ? HINDI_ALL : g })}>
            <span>{g.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function heroSources() {
  const list = [];
  list.push([() => picksForYou().then((r) => rankForYou(notOwned(r))), 'Picked for you', 'ai']);
  list.push([topRated, 'Top rated now', 'top']);
  if (absSrc.connected() && enabled('abs')) list.push([() => absSrc.inProgress(), 'Continue on your server', 'abs'], [() => absSrc.recent(), 'New on your server', 'abs']);
  if (cloud.tbConnected() && enabled('tb')) list.push([() => cloud.torboxLibrary(), 'In your TorBox', 'tb']);
  if (cloud.rdConnected() && enabled('rd')) list.push([() => cloud.realdebridLibrary(), 'In your Real-Debrid', 'rd']);
  if (hc.connected() && enabled('hc')) list.push([() => hc.shelf(hc.STATUS.reading), 'Reading on Hardcover', 'hc'], [() => hc.shelf(hc.STATUS.want), 'On your Want to Read', 'hc']);
  const rank = (k) => (k === 'ai' ? -2 : k === 'top' ? -1 : sourceRank(k));
  return list.sort((a, b) => rank(a[2]) - rank(b[2]));
}

/**
 * Shuffle, books not seen lately first; ones the banner showed in the last few days go to the
 * back (the longer ago, the sooner they come back). Each group gives at most `max` books, so a
 * short list (what you're in the middle of) doesn't fill the banner.
 */
function freshFirst(list, max = 6) {
  const seen = heroSeen.get();
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const fresh = a.filter((b) => !seen[b.uid]);
  const old = a.filter((b) => seen[b.uid]).sort((x, y) => seen[x.uid] - seen[y.uid]);
  return [...fresh, ...old].slice(0, max);
}

function roundRobin(groups) {
  const picks = [];
  const seen = new Set();
  for (let i = 0; picks.length < 10 && groups.some((g) => g && g[i]); i++) {
    for (const g of groups) {
      const b = g && g[i];
      if (b && !seen.has(b.uid) && picks.length < 10) {
        seen.add(b.uid);
        picks.push(b);
      }
    }
  }
  return picks;
}

/** A short label for what kind of thing a banner title is. */
function kindLabel(b) {
  if (b.source === 'pod') return 'Podcast';
  if (b.kind === 'text') return 'Ebook';
  if (b.kind === 'audio' || b.source === 'au') return 'Audiobook';
  return 'Book';
}

/** One banner slide: full-bleed artwork, badge, big title, details and actions. */
function FeatureSlide({ book: raw, active }) {
  const meta = useMeta(raw);
  const b = withMeta(raw, meta);
  const saved = !!useStore(library)[b.uid];
  const rt = useTileRating(active ? b : null);
  const playable = b.kind === 'audio';
  // Audiobooks: the square audiobook cover (Apple Books / Audible), not a cropped print cover.
  const square = useSquareCover(b.kind === 'text' || /^data:/.test(b.cover || '') || meta?.fixed ? null : b, true);
  const heroCover = square || hiResCover(b.cover);
  const bits = [
    (meta?.genres || [])[0],
    b.year || meta?.year,
    b.duration ? fmtDuration(b.duration) : '',
  ].filter(Boolean);
  return (
    <div class={'feature-slide' + (active ? ' on' : '') + (b.cover ? '' : ' no-art')} aria-hidden={!active}>
      <div class="feature-art">{b.cover ? <BgImage url={heroCover} /> : <div class="feature-art-empty" />}</div>
      <div class="feature-content">
        <div class="feature-poster">
          {b.cover ? (
            <BgImage url={heroCover} />
          ) : (
            <div class="feature-poster-empty">
              <span>{b.title}</span>
            </div>
          )}
        </div>
      {active && (
        <div class="feature-body">
          <div class="feature-badges">
            <span class="feature-badge">{kindLabel(b)}</span>
            {raw.heroTag && <span class="feature-from">{raw.heroTag}</span>}
          </div>
          <h2 class="feature-title">{b.title}</h2>
          {b.author && <p class="feature-author">{b.author}</p>}
          {raw.why && <p class="feature-why">{raw.why}</p>}
          {(bits.length > 0 || rt) && (
            <p class="feature-meta">
              {bits.map((x, k) => (
                <span key={k}>{x}</span>
              ))}
              {rt && (
                <span
                  class="feature-rating"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (rt.url) openExternal(rt.url);
                  }}
                >
                  <Icon name="star" size={13} fill /> {rt.rating.toFixed(1)} ({rt.count.toLocaleString()})
                </span>
              )}
            </p>
          )}
          <div class="feature-actions">
            <button
              class="feature-btn primary"
              onClick={(e) => {
                e.stopPropagation();
                if (!playable) return nav.push('book', { book: b });
                nav.openOverlay('player');
                player.openAndPlay(b, getDetails);
              }}
            >
              <Icon name={playable ? 'play' : 'info'} size={18} /> {playable ? 'Listen' : 'Details'}
            </button>
            <button
              class={'feature-btn ghost' + (saved ? ' saved' : '')}
              onClick={(e) => {
                e.stopPropagation();
                toggleLibrary(b);
                toast(saved ? 'Removed from library' : 'Saved to library');
              }}
            >
              <Icon name={saved ? 'check' : 'plus'} size={18} /> {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function Feature({ items, index, onDot }) {
  const touch = useRef(null);
  const swiped = useRef(false);
  const count = items.length;
  const cur = items[index];
  return (
    <section
      class="feature"
      onTouchStart={(e) => {
        touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        swiped.current = false;
      }}
      onTouchEnd={(e) => {
        const t = touch.current;
        if (!t) return;
        const dx = e.changedTouches[0].clientX - t.x;
        const dy = e.changedTouches[0].clientY - t.y;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
          swiped.current = true;
          onDot((index + (dx < 0 ? 1 : count - 1)) % count);
        }
      }}
      onClick={() => !swiped.current && nav.push('book', { book: cur })}
    >
      {items.map((b, k) => (
        <FeatureSlide key={b.uid} book={b} active={k === index} />
      ))}
      <div class="feature-dots">
        {items.map((_, k) => (
          <button
            key={k}
            class={k === index ? 'on' : ''}
            aria-label={`Show ${k + 1} of ${count}`}
            onClick={(e) => {
              e.stopPropagation();
              onDot(k);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function Hero() {
  const [items, setItems] = useState(() => (heroCache.get().items.length ? heroCache.get().items : null));
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(0);
  // A new set when you come back to the app after 30 minutes or more.
  const [round, setRound] = useState(0);
  useEffect(() => {
    let away = 0;
    const vis = () => {
      if (document.visibilityState === 'hidden') away = Date.now();
      else if (away && Date.now() - away > 30 * 60e3) setRound((r) => r + 1);
    };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, []);
  // What's actually on screen counts as seen.
  useEffect(() => {
    if (items?.length) markHeroSeen(items[i % items.length]?.uid);
  }, [i, items]);
  useEffect(() => {
    const sources = heroSources();
    const groups = new Array(sources.length).fill(null);
    let alive = true;
    let pending = sources.length;
    let lastIds = '';
    const publish = () => {
      const picks = roundRobin(groups);
      if (!alive) return;
      if (picks.length) {
        // Same books as already shown: leave the banner (and its timer) alone.
        const ids = picks.map((b) => b.uid).join('|');
        if (ids === lastIds) return;
        lastIds = ids;
        setItems(picks);
        heroCache.set({ items: picks });
      } else if (!pending) {
        // Nothing connected (or everything failed): free classics as a fallback.
        enabled('ia') ? ia.popular().then((r) => alive && setItems(r.slice(0, 6).map((x) => ({ ...x, heroTag: 'Most loved free audiobook' })))).catch(() => alive && setItems([])) : setItems([]);
      }
    };
    if (!sources.length) return publish(), () => (alive = false);
    sources.forEach(([load, tag, kind], k) => {
      // A slow service stops blocking the free fallback after 8s, but its books still join the banner when they arrive.
      let settled = false;
      const settle = () => {
        if (settled) return publish();
        settled = true;
        pending--;
        publish();
      };
      setTimeout(settle, 8000);
      Promise.resolve()
        .then(load)
        .then((r) => (groups[k] = freshFirst(r || [], kind === 'ai' || kind === 'top' ? 6 : 2).map((x) => ({ ...x, heroTag: tag }))))
        .catch(() => {})
        .finally(settle);
    });
    return () => (alive = false);
  }, [round]);
  // One steady timer: books arriving from slower services don't restart it.
  const count = useRef(0);
  count.current = items?.length || 0;
  useEffect(() => {
    // Only while Home is on screen (it stays alive in the background on other tabs).
    const onScreen = () => document.visibilityState === 'visible' && nav.state().tab === 'home' && !nav.state().top && !nav.state().overlay;
    const t = setInterval(() => count.current && onScreen() && setI((x) => (x + 1) % count.current), 7000);
    return () => clearInterval(t);
  }, [paused]);
  if (!items) return <section class="feature shimmer" />;
  // Nothing to feature: keep room for the floating header.
  if (!items.length) return <div class="feature-spacer" />;
  return (
    <Feature
      items={items}
      index={i % items.length}
      onDot={(k) => {
        setI(k);
        setPaused((p) => p + 1); // restart the auto-advance timer after a manual swipe
      }}
    />
  );
}

/** Date line under the greeting, e.g. "Friday, 26 September". */

// "Audiobooks in your folders / cloud" rows: audiobooks only (ebooks are in Library → Ebooks).
const audioOnly = (load) => () => load().then((list) => (list || []).filter((b) => b.kind !== 'text'));

// A Continue card's cover: the book's own current cover (the phone copy's, or one you picked),
// not only the picture saved with your place — that one can be out of date or another book's.
const topUidKey = (p) => p.book.uid;
function ContinueCover({ book, big }) {
  const local = useLocalCover(book);
  const meta = useMeta(book);
  const b = withMeta(local ? { ...book, cover: local } : book, meta?.fixed ? meta : null);
  return (
    <>
      {big && b.cover && <div class="continue-big-bg" style={{ backgroundImage: `url("${b.cover}")` }} />}
      <Cover book={b} eager={big} />
    </>
  );
}

function ContinueRow() {
  const prog = useStore(progress);
  const items = useMemo(
    () =>
      Object.entries(prog)
        .filter(([uid, p]) => !p.finished && !p.hidden && p.book && !/^(lbl?|sum):/.test(uid))
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        // One card per book: the copy (or format) you used last.
        .filter(([, p], i, all) => !all.slice(0, i).some(([, q]) => sameWork(q.book, p.book)))
        .slice(0, 12),
    [prog]
  );
  // Get the book you're most likely to resume ready to play (its parts and audio link).
  const topUid = items[0]?.[0];
  useEffect(() => {
    if (!topUid) return;
    const p = items[0][1];
    if (p.kind === 'text') return;
    const t = setTimeout(() => player.prefetch(p.book, getDetails), 1500);
    return () => clearTimeout(t);
  }, [topUid]);
  if (!items.length) return null;
  const open = (p) => {
    if (p.kind === 'text') return nav.push('reader', { book: p.book });
    nav.openOverlay('player');
    player.openAndPlay(p.book, getDetails);
  };
  const left = (p) => (p.kind === 'text' ? 'Reading' : p.total ? `${fmtDuration(p.total - p.global)} left` : 'Listening');
  // ✕: off the Continue row (every copy of that book), its place kept for later.
  const hide = (e, p) => {
    e.stopPropagation();
    hideFromContinue(Object.entries(prog).filter(([, q]) => q.book && sameWork(q.book, p.book)).map(([u]) => u));
    toast('Removed from Continue — your place is kept');
  };
  const Hide = ({ p }) => (
    <span class="continue-hide" role="button" aria-label={`Remove ${p.book.title} from Continue`} onClick={(e) => hide(e, p)}>
      <Icon name="close" size={14} />
    </span>
  );
  const [[, top], ...rest] = items;
  return (
    <section class="continue-section">
      <div class="d-head home-head">
        <span class="d-ico">
          <Icon name="headphones" size={20} />
        </span>
        <h3>{top.kind === 'text' ? 'Continue reading' : 'Continue listening'}</h3>
        {/* Your other unfinished books: Library → Continue (no row of them here). */}
        {rest.length > 0 && (
          <button
            class="d-more"
            onClick={() =>
              import('./Library.jsx').then((m) => {
                m.libView.set((v) => ({ ...v, tab: 'progress', where: 'all', open: true }));
                nav.tab('library');
              })
            }
          >
            All {items.length} <Icon name="arrow" size={15} />
          </button>
        )}
      </div>
      {/* The book you were last on, big; the others in a row below. */}
      <button class="continue-big" onClick={() => open(top)}>
        <ContinueCover key={topUidKey(top)} book={top.book} big />
        <div class="continue-big-text">
          <em>{top.book.narrator ? `Read by ${String(top.book.narrator).split(',')[0]}` : top.kind === 'text' ? 'Reading' : 'Listening'}</em>
          <b>{top.book.title}</b>
          {top.book.author && <small>{top.book.author}</small>}
          <div class="progress-bar">
            <div style={{ width: Math.round((top.percent || 0) * 100) + '%' }} />
          </div>
          <small>
            {Math.round((top.percent || 0) * 100)}% · {left(top)}
          </small>
        </div>
        <span class="continue-big-play">
          <Icon name={top.kind === 'text' ? 'book' : 'play'} size={24} />
        </span>
        <Hide p={top} />
      </button>

    </section>
  );
}

function WaitingRow() {
  const list = useStore(waitlist);
  if (!list.length) return null;
  return (
    <section class="row">
      <header class="row-head">
        <div>
          <h2>
            <Icon name="download" size={18} /> Downloading for you
          </h2>
          <p>Plays automatically when your debrid service finishes</p>
        </div>
      </header>
      <div class="wait-list">
        {list.map((w) => (
          <div class={'wait-item' + (w.ready ? ' ready' : '')}>
            <Cover book={{ title: w.bookTitle || w.title, author: w.author, cover: w.cover }} class="wait-cover" />
            <div class="wait-meta">
              <b>{w.bookTitle || w.title}</b>
              <span>
                {w.ready ? 'Ready to play' : `${Math.round((w.progress || 0) * 100)}%${w.state ? ` · ${w.state}` : ''}`} · {w.provider === 'torbox' ? 'TorBox' : 'Real-Debrid'}
              </span>
              <div class="progress-bar">
                <div style={{ width: (w.ready ? 100 : Math.round((w.progress || 0) * 100)) + '%' }} />
              </div>
            </div>
            {w.ready ? (
              <button class="continue-play" aria-label="Play" onClick={() => playNow(w).catch((e) => toast(e.message))}>
                <Icon name="play" size={16} />
              </button>
            ) : (
              <button class="icon-btn" aria-label="Stop waiting" onClick={() => cancel(w.hash)}>
                <Icon name="close" size={18} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function GenreChips() {
  return (
    <div class="genre-scroll">
      {enabled('hi') && (
        <button class="genre-chip hindi-chip" lang="hi" style={{ '--h': HINDI_ALL.hue }} onClick={() => nav.push('browse', { genre: HINDI_ALL })}>
          हिंदी
        </button>
      )}
      {GENRES.map((g) => (
        <button class="genre-chip" style={{ '--h': g.hue }} onClick={() => nav.push('browse', { genre: g })}>
          {g.name}
        </button>
      ))}
    </div>
  );
}

/** One tap: a random theme (light or dark, palette and accent). Long-press: back to the previous one. */
function ThemeDice() {
  const timer = useRef(0);
  const held = useRef(false);
  const roll = () => {
    const { name, ...look } = rollTheme(settings.get());
    settings.patch(look);
    toast(`${name} — long-press to go back`);
  };
  return (
    <button
      class="icon-btn glass"
      aria-label="Surprise me with a theme"
      onPointerDown={() => {
        held.current = false;
        timer.current = setTimeout(() => {
          held.current = true;
          const prev = previousLook();
          if (prev) {
            settings.patch(prev);
            toast('Back to your previous theme');
          }
        }, 600);
      }}
      onPointerUp={() => clearTimeout(timer.current)}
      onPointerLeave={() => clearTimeout(timer.current)}
      onClick={() => !held.current && roll()}
    >
      <Icon name="palette" />
    </button>
  );
}

export function Home() {
  const st = useStore(settings);
  const acct = useStore(account);
  const addonList = useStore(addons);
  const absCfg = useStore(abs);
  const deb = useStore(debrid);
  const localCfg = useStore(localSrc.localCfg);
  const hcCfg = useStore(hardcover);
  const grData = useStore(goodreads);
  const [addonRows, setAddonRows] = useState([]);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!enabled('addon')) return setAddonRows([]);
    addonSrc.catalogRows().then(setAddonRows).catch(() => setAddonRows([]));
  }, [addonList, st.sources]);

  const blocks = {
    // Hindi section: only when switched on in Settings → Sources, in the user's chosen place.
    hi: enabled('hi') && (
      <Row
        title="हिंदी ऑडियोबुक"
        subtitle="Top Hindi audiobooks · Audible India"
        icon="headphones"
        load={() => audible.hindi('')}
        deps={[]}
        onMore={() => nav.push('browse', { genre: HINDI_ALL })}
      />
    ),
    abs: absSrc.connected() && enabled('abs') && (
        <>
          <Row title="On your server" subtitle="Audiobookshelf · in progress" icon="server" load={absSrc.inProgress} deps={[absCfg.token]} showErrors />
          <Row title="Recently added" subtitle="Audiobookshelf" icon="server" cacheKey="absRecent" load={absSrc.recent} deps={[absCfg.token, absCfg.libraryId]} onMore={() => nav.push('shelf', { title: 'Audiobookshelf', subtitle: 'Your whole library', load: absSrc.all })} showErrors emptyText={absSrc.emptyHint} />
        </>
      ),
    loc: localSrc.connected() && enabled('loc') && <Row title="On this phone" subtitle="Audiobooks in your folders" icon="headphones" cacheKey="loc" load={audioOnly(localSrc.library)} deps={[localCfg.scannedAt]} onMore={() => nav.push('shelf', { title: 'On this phone', subtitle: 'Audiobooks in your folders', load: audioOnly(localSrc.library) })} emptyText="No audiobooks found in your folder." />,
    tb: cloud.tbConnected() && enabled('tb') && <Row title="Your TorBox" subtitle="Audiobooks in your cloud" icon="download" cacheKey="tb" load={audioOnly(cloud.torboxLibrary)} deps={[deb.torbox]} onMore={() => nav.push('shelf', { title: 'Your TorBox', subtitle: 'Audiobooks in your TorBox cloud', load: audioOnly(cloud.torboxLibrary) })} showErrors emptyText="No audiobooks in your TorBox yet." />,
    rd: cloud.rdConnected() && enabled('rd') && <Row title="Your Real-Debrid" subtitle="Audiobooks in your cloud" icon="download" cacheKey="rd" load={audioOnly(cloud.realdebridLibrary)} deps={[deb.realdebrid]} onMore={() => nav.push('shelf', { title: 'Your Real-Debrid', subtitle: 'Audiobooks in your Real-Debrid cloud', load: audioOnly(cloud.realdebridLibrary) })} showErrors emptyText="No audiobooks in your Real-Debrid yet." />,
    hc: hc.connected() && enabled('hc') && (
        <>
          <Row title="Currently reading" subtitle="Hardcover" icon="book" load={() => hc.shelf(hc.STATUS.reading)} deps={[hcCfg.token]} onMore={() => nav.push('shelf', { title: 'Currently reading', subtitle: 'Hardcover', load: () => hc.shelf(hc.STATUS.reading) })} showErrors emptyText="Nothing on your Hardcover Currently Reading shelf." />
          <Row title="Want to read" subtitle="Hardcover" icon="heart" load={() => hc.shelf(hc.STATUS.want)} deps={[hcCfg.token]} onMore={() => nav.push('shelf', { title: 'Want to read', subtitle: 'Hardcover', load: () => hc.shelf(hc.STATUS.want) })} showErrors emptyText="Nothing on your Hardcover Want to Read shelf." />
          <Row title="Read" subtitle="Hardcover" icon="check" load={() => hc.shelf(hc.STATUS.read)} deps={[hcCfg.token]} onMore={() => nav.push('shelf', { title: 'Read', subtitle: 'Hardcover', load: () => hc.shelf(hc.STATUS.read) })} />
        </>
      ),
    gr: enabled('gr') && grData.books.length > 0 && (
        <>
          <Row title="Currently reading" subtitle="Goodreads" icon="book" items={gr.shelf('currently-reading')} onMore={() => nav.push('shelf', { title: 'Currently reading', subtitle: 'Goodreads', load: async () => gr.shelf('currently-reading') })} />
          <Row title="Read" subtitle="Goodreads" icon="check" items={gr.shelf('read').slice(0, 40)} />
          <Row title="Want to read" subtitle="Goodreads" icon="heart" items={gr.shelf('to-read').slice(0, 40)} onMore={() => nav.push('shelf', { title: 'Want to read', subtitle: 'Goodreads', load: async () => gr.shelf('to-read') })} />
        </>
      ),
    gb: enabled('gb') && <Row title="Classics to read" subtitle="Project Gutenberg · most downloaded" icon="book" load={() => gb.popular(st.language)} deps={[st.language]} />,
    ol: enabled('ol') && <Row title="Trending this week" subtitle="Open Library readers" icon="flame" load={() => ol.trending('weekly')} deps={[]} />,
    addon: addonRows.map((r) => (
        <Row key={r.key} title={r.title} subtitle={r.subtitle} icon="puzzle" load={r.load} deps={[r.key]} />
      )),
    ia: enabled('ia') && (
        <>
          <Row title="Most listened" subtitle="LibriVox via Internet Archive" icon="headphones" load={ia.popular} deps={[]} />
          <Row title="Fresh recordings" subtitle="Newest LibriVox releases" icon="sparkle" load={ia.newest} deps={[]} />
          <Row title="Old‑time radio" subtitle="Golden-age drama & mystery" icon="headphones" load={() => ia.query('collection:oldtimeradio', { rows: 24 })} deps={[]} />
        </>
      ),
  };
  const me = firstName(st.myName, acct);
  return (
    <div class="screen home">
      <header class="home-top home-bar">
        <div class="home-logo">
          <svg viewBox="0 0 512 512" aria-hidden="true" class="ay-mark">
            {/* One solid colour from your theme (the purple-pink gradient read as an AI app). */}
            <rect width="512" height="512" rx="120" style={{ fill: 'var(--accent)' }} />
            <g transform="translate(0 10)" fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round">
              <path d="M128 178 a128 128 0 0 1 256 0" strokeWidth="20" />
              <path d="M224 164 a46 46 0 0 1 64 0" strokeWidth="18" />
              <path d="M200 132 a80 80 0 0 1 112 0" strokeWidth="18" />
              <path d="M150 208 L256 318 L362 208" strokeWidth="42" />
              <path d="M256 318 V420" strokeWidth="42" />
            </g>
            <g transform="translate(0 10)" fill="#fff">
              <rect x="96" y="172" width="62" height="94" rx="28" />
              <rect x="354" y="172" width="62" height="94" rx="28" />
            </g>
          </svg>
          <div class="home-hello">
            <b>
              Audio<span class="ay-y">Y</span>am
            </b>
            <small class="home-tagline">
              <span class="ay-y">Y</span>our books, <span class="ay-y">Y</span>our way
            </small>
          </div>
        </div>
        <div class="home-top-actions">
          <button class="icon-btn drive-btn" onClick={() => openDrive()} aria-label="Driving mode">
            <Icon name="car" />
          </button>
          <SceneButton />
          <AskButton />
          <ThemeDice />
          <button class="icon-btn home-search" onClick={() => nav.tab('discover')} aria-label="Search">
            <Icon name="search" />
          </button>
        </div>
      </header>
      <Greeting me={me} />

      {homeOrder(st).map((id) => {
        if (homeHidden(st).includes(id)) return null;
        switch (id) {
          case 'hero':
            return <Hero key={id} />;
          case 'continue':
            return (
              <Fragment key={id}>
                <ContinueRow />
                <FollowRow />
                <WaitingRow />
              </Fragment>
            );
          case 'upnext':
            return <UpNextRow key={id} />;
          case 'plan':
            return <PlanRow key={id} />;
          case 'rec':
            return (
              <Fragment key={id}>
                <Row title="Recommended for you" subtitle={settings.get().tasteFiction ? "From your listening and ratings" : "Non-fiction from your listening and ratings"} icon="sparkle" cacheKey="homeRec" shuffle rec load={recommendedForYou} deps={[]} />
                <TasteShelves />
              </Fragment>
            );
          case 'new':
            return <Row key={id} title="New releases" subtitle={`New in ${topicNames()}`} icon="flame" cacheKey="homeNew" shuffle rec load={newReleases} deps={[]} />;
          case 'top':
            return <Row key={id} title="Top titles this month" subtitle={`Best sellers in ${topicNames()}`} icon="star" cacheKey="homeTop" shuffle load={topThisMonth} deps={[]} />;
          case 'cats':
            return <CategoryTiles key={id} />;
          case 'sources':
            return (
              <Fragment key={id}>
                <YourBooks />
                {sourceOrder()
                  .filter((k) => !YOURS.includes(k))
                  .map((k) => (
                    <Fragment key={k}>{blocks[k]}</Fragment>
                  ))}
              </Fragment>
            );
          default:
            return null;
        }
      })}
      <button class="btn ghost-wide home-customise" onClick={() => setEditing(true)}>
        <Icon name="grid" size={16} /> Customise Home
      </button>
      {editing && <HomeEditor onClose={() => setEditing(false)} />}
      <div class="footer-space" />
    </div>
  );
}

// ---- Greeting and Your books --------------------------------------------------------

/** "Good evening, Dilip" and how long is left in the book you're on. */
function Greeting({ me }) {
  const prog = useStore(progress);
  const cur = useMemo(
    () =>
      Object.values(prog)
        .filter((p) => p?.book && !p.finished && !p.hidden && p.kind !== 'text' && p.total > 0)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0],
    [prog]
  );
  return (
    <div class="home-greet">
      <h1>{me ? `${greeting()}, ${me}` : greeting()}</h1>
      {cur && (
        <p>
          {fmtDuration(Math.max(0, cur.total - (cur.global || 0)))} left in {cur.book.title}
        </p>
      )}
    </div>
  );
}

// Your services' books: one tile each (how many, tap for all), and one "Recently added" row
// across them all, instead of a long row per service.
// Your server keeps its own rows (in progress, recently added); the tile just opens it.
const YOURS = ['loc', 'tb', 'rd'];
function yourSources() {
  const out = [];
  if (localSrc.connected() && enabled('loc')) out.push({ k: 'loc', icon: 'headphones', name: 'On this phone', sub: 'Audiobooks in your folders', load: audioOnly(localSrc.library) });
  if (cloud.tbConnected() && enabled('tb')) out.push({ k: 'tb', icon: 'cloud', name: 'TorBox', sub: 'Audiobooks in your TorBox cloud', load: audioOnly(cloud.torboxLibrary) });
  if (cloud.rdConnected() && enabled('rd')) out.push({ k: 'rd', icon: 'cloud', name: 'Real-Debrid', sub: 'Audiobooks in your Real-Debrid cloud', load: audioOnly(cloud.realdebridLibrary) });
  if (absSrc.connected() && enabled('abs')) out.push({ k: 'abs', icon: 'server', name: 'Your server', sub: 'Audiobookshelf · your whole library', load: absSrc.all });
  return out;
}
const yourCounts = persisted('yourBookCounts', {});
const tagFrom = { loc: 'Phone', tb: 'TorBox', rd: 'Real-Debrid', abs: 'Server' };
async function recentAcross() {
  const lists = await Promise.all(
    yourSources().filter((s) => s.k !== 'abs').map(async (s) => {
      const r = await s.load().catch(() => []);
      return (r || []).map((b, i) => ({ ...b, _from: s.k, _i: i }));
    })
  );
  const all = lists.flat();
  const dated = all.some((b) => b.addedAt);
  return (dated ? all.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0) || a._i - b._i) : all.sort((a, b) => a._i - b._i))
    .slice(0, 24)
    .map(({ _i, _from, ...b }) => b);
}
function YourBooks() {
  const counts = useStore(yourCounts);
  const list = yourSources();
  useEffect(() => {
    let alive = true;
    for (const s of list)
      s.load()
        .then((r) => alive && Array.isArray(r) && yourCounts.set((c) => ({ ...c, [s.k]: r.length })))
        .catch(() => {});
    return () => (alive = false);
  }, [list.map((s) => s.k).join()]);
  if (!list.length) return null;
  return (
    <>
      <section class="d-sec home-yours">
        <div class="d-head">
          <span class="d-ico">
            <Icon name="grid" size={20} />
          </span>
          <h3>Your books</h3>
        </div>
        <div class={'yours-tiles n' + Math.min(list.length, 4)}>
          {list.map((s) => (
            <button class="yours-tile" onClick={() => nav.push('shelf', { title: s.name, subtitle: s.sub, load: s.load })}>
              <span class="yours-i">
                <Icon name={s.icon} size={18} />
              </span>
              <b>{counts[s.k] ?? '…'}</b>
              <small>{s.name}</small>
            </button>
          ))}
        </div>
      </section>
      {list.some((s) => s.k !== 'abs') && <Row title="Recently added" subtitle={list.filter((s) => s.k !== 'abs').map((s) => tagFrom[s.k]).join(' · ')} icon="clock" cacheKey="homeRecentAll" load={recentAcross} deps={[list.map((s) => s.k).join()]} />}
    </>
  );
}

// ---- Customise Home: order and hide its sections (saved with your settings) ----
const HOME_SECTIONS = [
  ['hero', 'Banner', 'Picked for you, top rated, your server & cloud'],
  ['continue', 'Continue', 'What you’re listening to and reading'],
  ['upnext', 'Up next', 'Books lined up to play next'],
  ['plan', 'Listen for…', '10 / 30 / 60-minute plans from your books'],
  ['rec', 'Recommended for you', 'From your listening and ratings'],
  ['new', 'New releases', 'In your topics'],
  ['top', 'Top titles this month', 'Best sellers in your topics'],
  ['cats', 'Explore categories', 'Genre tiles'],
  ['sources', 'Your services', 'Audiobookshelf, phone, TorBox, Real-Debrid, Hardcover… (their order: Settings → Sources)'],
];
const homeOrder = (st) => {
  const saved = (st.homeOrder || []).filter((id) => HOME_SECTIONS.some(([k]) => k === id));
  return [...saved, ...HOME_SECTIONS.map(([k]) => k).filter((k) => !saved.includes(k))];
};
const homeHidden = (st) => st.homeHidden || [];

function HomeEditor({ onClose }) {
  useBackClose(true, onClose);
  const st = useStore(settings);
  const order = homeOrder(st);
  const hidden = homeHidden(st);
  const move = (i, d) => {
    const next = [...order];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    settings.patch({ homeOrder: next });
  };
  const toggle = (id) => settings.patch({ homeHidden: hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id] });
  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div class="sheet home-edit" onClick={(e) => e.stopPropagation()}>
        <div class="home-edit-head">
          <h3>Customise Home</h3>
          <button class="link-btn" onClick={onClose}>
            Done
          </button>
        </div>
        {order.map((id, i) => {
          const [, label, sub] = HOME_SECTIONS.find(([k]) => k === id);
          const on = !hidden.includes(id);
          return (
            <div class={'home-edit-row' + (on ? '' : ' off')}>
              <div class="home-edit-move">
                <button class="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${label} up`}>
                  <Icon name="up" size={16} />
                </button>
                <button class="icon-btn" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${label} down`}>
                  <Icon name="down" size={16} />
                </button>
              </div>
              <div class="home-edit-text">
                <b>{label}</b>
                <small>{sub}</small>
              </div>
              <input type="checkbox" class="switch" checked={on} onChange={() => toggle(id)} aria-label={`Show ${label}`} />
            </div>
          );
        })}
        <button class="link-btn" onClick={() => settings.patch({ homeOrder: [], homeHidden: [] })}>
          Reset to the usual layout
        </button>
      </div>
    </div>
  );
}

export { BookCard };
