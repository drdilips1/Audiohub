import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { Component } from 'preact';
import { hashHue, fmtDuration, cardCover } from '../lib/format.js';
import { SOURCES, sourceOf } from '../sources/index.js';
import { Icon } from './icons.jsx';
import { nav } from '../lib/nav.js';
import { progress as progressStore, useStoreKey, persisted, useStore, settings } from '../lib/store.js';
import { useImage, coverFrame, frameStyle, frameTall } from '../lib/image.js';
import { longPress } from './book-actions.jsx';
import { useSquareCover, squareNow } from '../lib/meta.js';
import { activePalette, isInk } from '../lib/theme.js';
import { useMeta } from '../lib/meta.js';
import { useTileRating } from '../lib/ratings.js';
import { openExternal } from '../sources/summaries.js';
import { useStoryShots, chooseStoryShots } from '../sources/storyshots.js';
import { useLocalCover } from '../sources/local.js';
import { audioFormat } from '../sources/debrid.js';
import { markNotInterested, notInterested, isNotInterested } from '../lib/taste.js';

export function Cover({ book, class: cls = '', eager }) {
  // A tall print cover: the square audiobook cover (Apple Books / Audible) instead, once found.
  const [tall, setTall] = useState(false);
  const square = useSquareCover(book?.kind === 'text' ? null : book, tall);
  const { src, failed: proxyFailed } = useImage(square || cardCover(book?.cover || ''));
  // A tall (or wide) cover is shown whole — not cropped to the square — on a blur of itself.
  const [ratio, setRatio] = useState(0);
  const [failed, setFailed] = useState(!book?.cover);
  useEffect(() => setFailed(!book?.cover || proxyFailed), [book?.cover, proxyFailed]);
  const hue = hashHue(book?.title || '');
  const [frame, setFrame] = useState(null);
  // A different book (or picture) here: start over (tall/whole, the trimmed frame).
  useEffect(() => (setTall(false), setRatio(0)), [book?.uid]);
  useEffect(() => {
    setFrame(null);
    if (!src) return;
    let alive = true;
    coverFrame(src).then((f) => alive && setFrame(f));
    return () => (alive = false);
  }, [src]);
  const whole = frame ? frameTall(frame) : ratio > 0 && (ratio < 0.88 || ratio > 1.14);
  useEffect(() => {
    if (whole && !square) setTall(true);
  }, [whole, square]);
  return (
    <div class={'cover ' + cls + (whole ? ' whole' : '')} style={{ '--h': hue, ...(whole && src ? { '--cover-img': `url("${src}")` } : {}) }}>
      <div class="cover-fallback">
        <span class="cover-title">{String(book?.title || '').replace(/^[\s\-–—_.,:;]+/, '')}</span>
        <span class="cover-author">{book?.author}</span>
      </div>
      {!failed && src && (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          style={frameStyle(frame)}
          onError={() => setFailed(true)}
          onLoad={(e) => {
            // Open Library returns a 1x1 gif for missing covers.
            const im = e.currentTarget;
            if (im.naturalWidth < 10) return setFailed(true);
            setRatio(im.naturalWidth / im.naturalHeight);
            im.classList.add('loaded');
          }}
        />
      )}
    </div>
  );
}

/** A book's cover with whatever was found for it (its phone file's cover, a looked-up one). */
export function BookCover({ book, class: cls = '' }) {
  const localCover = useLocalCover(book);
  const b = localCover ? { ...book, cover: localCover } : book;
  return <Cover book={withMeta(b, useMeta(b))} class={cls} />;
}

// Paper & Ink: where a book lives, in plain words, instead of each provider's name and colour.
const PLAIN = { abs: 'Server', tb: 'Cloud', rd: 'Cloud', loc: 'Local' };

export function SourceBadge({ uid, book }) {
  const key = sourceOf(uid || '');
  const plain = isInk(activePalette(useStore(settings))) && PLAIN[key];
  if (plain) return <span class="badge">{plain}</span>;
  // Books from places without a source entry (e.g. direct ebook links) get a plain badge.
  const s = SOURCES[key] || { short: book?.addon || (book?.kind === 'text' ? 'Ebook' : 'Book'), hue: 210 };
  const label = key === 'addon' ? book?.addonName || s.short : book?.via === 'lv' ? 'LibriVox' : s.short;
  return (
    <span class="badge" style={{ '--h': key === 'ia' && book?.via === 'lv' ? SOURCES.lv.hue : s.hue }}>
      {label}
    </span>
  );
}

// Debrid/addon items borrow cover + tidy title/author from metadata providers.
export function withMeta(book, meta) {
  if (!meta) return book;
  if (meta.fixed) return { ...book, cover: meta.cover || book.cover || '', title: meta.title || book.title, author: meta.author || book.author || '' };
  const cloudItem = book.source === 'tb' || book.source === 'rd' || book.source === 'loc';
  return {
    ...book,
    cover: book.cover || meta.cover || '',
    title: cloudItem && meta.title ? meta.title : book.title,
    author: (cloudItem && meta.author) || book.author || meta.author || '',
    rating: book.rating || meta.rating || 0,
    ratings: book.rating ? book.ratings : meta.ratings || 0,
  };
}

const fmtCount = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));

/**
 * Keeps one broken piece (a book with odd data, a screen that fails) from taking
 * the whole app down: shows `fallback(error, retry)` instead.
 */
export class Guard extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  componentDidCatch(error) {
    console.error(error);
    this.setState({ error });
  }
  render({ children, fallback }, { error }) {
    if (!error) return children;
    return fallback ? fallback(error, () => this.setState({ error: null })) : null;
  }
}

// Ebooks read in the app from TorBox / Real-Debrid / a direct link open straight in the reader.
const isReaderEbook = (b) => b?.kind === 'text' && /#ebook$/.test(b?.uid || '');

const str = (v) => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(', ') : typeof v === 'object' ? String(v.name || v.title || '') : String(v));

/** A book card that can't break its grid: bad data shows a plain placeholder. */
function SafeCard({ book, wide, rec }) {
  return (
    <Guard
      fallback={() => (
        <div class="book-card broken">
          <div class="book-card-cover">
            <div class="cover" />
          </div>
          <div class="book-card-title">{str(book?.title) || 'Untitled'}</div>
        </div>
      )}
    >
      <BookCard book={book} wide={wide} rec={rec} />
    </Guard>
  );
}

/** Small lines under the author: file format · length (e.g. "M4B · 11h 10m"), then the narrator. */
function CardFacts({ book, meta }) {
  const secs = Number(book.duration) || Number(meta?.runtime) || 0;
  const narrator = str(book.narrator || meta?.narrator).split(',')[0].trim();
  const format = str(book.format).toUpperCase() || (Array.isArray(book.files) ? audioFormat(book.files) : ''); // phone books scanned before formats were noted
  const line = [format, secs ? fmtDuration(secs) : ''].filter(Boolean).join(' · ');
  if (!line && !narrator) return null;
  return (
    <>
      {line && <div class="book-card-facts">{line}</div>}
      {narrator && (
        <div class="book-card-facts">
          <Icon name="mic" size={10} /> {narrator}
        </div>
      )}
    </>
  );
}

// Memoized, and it listens to its own book's progress only: saving the position of
// the book that's playing (every few seconds) no longer re-renders every card.
export const BookCard = memo(function BookCard({ book: raw, wide, rec = false }) {
  const localCover = useLocalCover(raw);
  const meta = useMeta(localCover ? { ...raw, cover: localCover } : raw);
  const merged = withMeta(localCover ? { ...raw, cover: localCover } : raw, meta);
  // Data from many sources: make sure what we print is plain text / numbers.
  const book = { ...merged, title: str(merged.title), author: str(merged.author), rating: Number(merged.rating) || 0, ratings: Number(merged.ratings) || 0 };
  const prog = useStoreKey(progressStore, book.uid);
  // Same careful lookup everywhere (your Audible store, else Goodreads), not whatever rating a listing carried.
  const rt = useTileRating(book);
  const ss = useStoryShots(book);
  const pct = prog ? Math.round((prog.percent || 0) * 100) : 0;
  // Press and hold: the book's actions (play, download, tag, finished…).
  const hold = useMemo(() => longPress(() => bookRef.current), []);
  const bookRef = useRef(book);
  bookRef.current = book;
  return (
    <button class={'book-card' + (wide ? ' wide' : '')} {...hold} onClick={() => (isReaderEbook(book) ? nav.push('reader', { book }) : nav.push('book', { book }))}>
      <div class="book-card-cover">
        <Cover book={book} />
        {book.rank > 0 && <span class="rank-badge">#{book.rank}</span>}
        {book.copies > 1 && <span class="copies-badge">{book.copies} copies</span>}
        {!(book.rank > 0) && book.match > 0 && <span class={'match-badge' + (book.match >= 80 ? ' hi' : '')}>{book.match}% match</span>}
        {rec && (
          <span
            class="not-btn"
            role="button"
            aria-label="Not interested"
            title="Not interested — show less like this"
            onClick={(e) => {
              e.stopPropagation();
              markNotInterested(book);
              toast('Hidden — you’ll see less like this (undo in Settings → AI)');
            }}
          >
            ✕
          </span>
        )}
        {book.fetching != null && <span class="fetch-badge">{Math.round((book.fetching || 0) * 100)}%</span>}
      </div>
      {/* How far you are: a thin line under the cover, not on it. */}
      {pct > 0 && (
        <div class="progress-under">
          <div style={{ width: pct + '%' }} />
        </div>
      )}
      <div class="book-card-title">{String(book.title || '').replace(/^[\s\-–—_.,:;]+/, '')}</div>
      <div class="book-card-author">{book.author || ' '}</div>
      {(rt || ss) && (
        <div class="book-card-badges">
          {rt && (
            <span
              class="card-rating"
              role="link"
              title={`${rt.from}: ${rt.rating.toFixed(1)} from ${rt.count.toLocaleString()} ratings — tap for reviews`}
              onClick={(e) => {
                e.stopPropagation();
                if (rt.url) openExternal(rt.url);
              }}
            >
              <Icon name="star" size={10} fill /> {rt.rating.toFixed(1)}
              {rt.count > 0 && <small> ({fmtCount(rt.count)})</small>}
            </span>
          )}
          {ss && (
            <span
              class={'card-ss' + (ss.ep ? '' : ' outline')}
              role="link"
              title={ss.ep ? 'StoryShots audio summary — plays here' : 'Summary in StoryShots — tap for options'}
              onClick={(e) => {
                e.stopPropagation();
                chooseStoryShots(book, ss);
              }}
            >
              S
            </span>
          )}
        </div>
      )}
      <CardFacts book={book} meta={meta} />
    </button>
  );
});

// Last contents of slow rows (your cloud, your server), shown at once on the next open.
const rowCache = persisted('rowCache', {}, { delay: 1500 });
/** The last list a cached row showed (e.g. Home's recommendations), or []. */
export const cachedRow = (key) => rowCache.get()[key] || [];
const ROW_KEEP = ['uid', 'source', 'kind', 'title', 'author', 'narrator', 'cover', 'year', 'duration', 'addedAt', 'hash', 'format', 'fetching', 'genres', 'why', 'match'];
const slim = (b) => Object.fromEntries(ROW_KEEP.filter((k) => b?.[k] !== undefined).map((k) => [k, b[k]]));

export function Row({ title, subtitle, load, items: given, icon, onMore, deps = [], showErrors = false, emptyText = '', cacheKey = '', shuffle = false, rec = false }) {
  const hidden = useStore(notInterested);
  const scroller = useRef(null);
  const [items, setItems] = useState(() => given || (cacheKey && rowCache.get()[cacheKey]) || null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (given) return setItems(given);
    let alive = true;
    const last = cacheKey && rowCache.get()[cacheKey];
    setItems(last || null);
    setError(null);
    load()
      .then((r) => {
        if (!alive) return;
        setItems(r);
        if (cacheKey && Array.isArray(r)) rowCache.set((c) => ({ ...c, [cacheKey]: r.slice(0, 24).map(slim) }));
      })
      .catch((e) => alive && !last && setError(e)); // keep showing the last list if a refresh fails
    return () => (alive = false);
  }, deps);
  // Integration rows (your server, cloud, shelves) show what went wrong instead of vanishing.
  if (showErrors && (error || (items && !items.length && emptyText))) {
    return (
      <section class="row">
        <header class="row-head">
          <div>
            <h2>
              {icon && <Icon name={icon} size={18} />} {title}
            </h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </header>
        <p class={'row-note' + (error ? ' bad' : '')}>{error ? `Couldn't load: ${error.message || error}` : typeof emptyText === 'function' ? emptyText() : emptyText}</p>
      </section>
    );
  }
  if (error || (items && !items.length)) return null;
  return (
    <section class="row">
      <header class={'row-head' + (onMore ? ' tappable' : '')} onClick={onMore}>
        <div>
          <h2>
            {icon && <Icon name={icon} size={18} />} {title}
            {/* How many books this source / shelf has (with "See all"). */}
            {onMore && items?.length > 0 && <span class="row-count">{items.length}</span>}
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {shuffle && items?.length > 2 && (
          <button
            class="icon-btn row-shuffle"
            aria-label={`Shuffle ${title}`}
            onClick={(e) => {
              e.stopPropagation();
              const next = [...items];
              for (let i = next.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [next[i], next[j]] = [next[j], next[i]];
              }
              setItems(next);
              if (scroller.current) scroller.current.scrollLeft = 0;
            }}
          >
            <Icon name="shuffle" size={18} />
          </button>
        )}
        {onMore && (
          <span class="link-btn see-all">
            See all ›
          </span>
        )}
      </header>
      <div class="row-scroll" ref={scroller}>
        {items ? items.filter((b) => !rec || !isNotInterested(b, hidden)).map((b) => <SafeCard key={b.uid} book={b} rec={rec} />) : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} />)}
      </div>
    </section>
  );
}

/** Book grid that renders a screenful first and adds more as you scroll (big libraries open instantly). */
export function Grid({ items, step = 36 }) {
  const [count, setCount] = useState(step);
  const more = useRef(null);
  useEffect(() => {
    const el = more.current;
    if (!el || count >= items.length) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setCount((c) => c + step), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [count, items.length]);
  return (
    <>
      <div class="grid">
        {items.slice(0, count).map((b) => (
          <SafeCard key={b.uid} book={b} />
        ))}
      </div>
      {count < items.length && <div ref={more} class="grid-more" />}
    </>
  );
}

export function Skeleton() {
  return (
    <div class="book-card skeleton">
      <div class="book-card-cover shimmer" />
      <div class="line shimmer" />
      <div class="line short shimmer" />
    </div>
  );
}

/** ✨ Ask AI, in the top corner of every screen: about this book, or about all your books. */
export function AskButton({ book = null, cls = 'icon-btn ask-btn glass' }) {
  return (
    <button
      class={cls}
      aria-label={book ? 'Ask AI about this book' : 'Ask AI about your books'}
      onClick={() => nav.push('ask', book ? { book, description: book.description || '' } : {})}
    >
      <Icon name="ai" size={cls.includes('hdr-btn') ? 18 : 20} />
    </button>
  );
}

export function TopBar({ title, back = true, right, transparent, ask = true }) {
  return (
    <header class={'topbar' + (transparent ? ' transparent' : '')}>
      {back ? (
        <button class="icon-btn" onClick={() => nav.back()} aria-label="Back">
          <Icon name="back" />
        </button>
      ) : (
        <span />
      )}
      <h1>{title}</h1>
      <div class="topbar-right">
        {right}
        {ask && <AskButton />}
      </div>
    </header>
  );
}

export function Empty({ icon = 'sparkle', title, children }) {
  return (
    <div class="empty">
      <div class="empty-icon">
        <Icon name={icon} size={34} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

let toastSet;
export function Toaster() {
  const [msg, setMsg] = useState(null);
  toastSet = setMsg;
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div class="toast">{msg.text || msg}</div> : null;
}
export const toast = (text) => toastSet?.({ text, t: Date.now() });
