import { useEffect, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { Component } from 'preact';
import { hashHue } from '../lib/format.js';
import { SOURCES, sourceOf } from '../sources/index.js';
import { Icon } from './icons.jsx';
import { nav } from '../lib/nav.js';
import { progress as progressStore, useStoreKey, persisted } from '../lib/store.js';
import { useImage } from '../lib/image.js';
import { useMeta } from '../lib/meta.js';
import { useTileRating } from '../lib/ratings.js';
import { openExternal } from '../sources/summaries.js';

export function Cover({ book, class: cls = '', eager }) {
  const { src, failed: proxyFailed } = useImage(book?.cover || '');
  const [failed, setFailed] = useState(!book?.cover);
  useEffect(() => setFailed(!book?.cover || proxyFailed), [book?.cover, proxyFailed]);
  const hue = hashHue(book?.title || '');
  return (
    <div class={'cover ' + cls} style={{ '--h': hue }}>
      <div class="cover-fallback">
        <span class="cover-title">{book?.title}</span>
        <span class="cover-author">{book?.author}</span>
      </div>
      {!failed && src && (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
          onLoad={(e) => {
            // Open Library returns a 1x1 gif for missing covers.
            if (e.currentTarget.naturalWidth < 10) setFailed(true);
            else e.currentTarget.classList.add('loaded');
          }}
        />
      )}
    </div>
  );
}

export function SourceBadge({ uid, book }) {
  const key = sourceOf(uid || '');
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
  const cloudItem = book.source === 'tb' || book.source === 'rd';
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
function SafeCard({ book, wide }) {
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
      <BookCard book={book} wide={wide} />
    </Guard>
  );
}

// Memoized, and it listens to its own book's progress only: saving the position of
// the book that's playing (every few seconds) no longer re-renders every card.
export const BookCard = memo(function BookCard({ book: raw, wide }) {
  const meta = useMeta(raw);
  const merged = withMeta(raw, meta);
  // Data from many sources: make sure what we print is plain text / numbers.
  const book = { ...merged, title: str(merged.title), author: str(merged.author), rating: Number(merged.rating) || 0, ratings: Number(merged.ratings) || 0 };
  const prog = useStoreKey(progressStore, book.uid);
  // Same careful lookup everywhere (your Audible store, else Goodreads), not whatever rating a listing carried.
  const rt = useTileRating(book);
  const pct = prog ? Math.round((prog.percent || 0) * 100) : 0;
  return (
    <button class={'book-card' + (wide ? ' wide' : '')} onClick={() => (isReaderEbook(book) ? nav.push('reader', { book }) : nav.push('book', { book }))}>
      <div class="book-card-cover">
        <Cover book={book} />
        <span class="kind-dot" title={book.kind}>
          <Icon name={book.kind === 'text' ? 'book' : book.kind === 'discover' ? 'sparkle' : 'headphones'} size={13} />
        </span>
        {book.rank > 0 && <span class="rank-badge">#{book.rank}</span>}
        {!(book.rank > 0) && book.match > 0 && <span class={'match-badge' + (book.match >= 80 ? ' hi' : '')}>{book.match}% match</span>}
        {rt && (
          <span
            class="rating-badge"
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
        {book.fetching != null && <span class="fetch-badge">{Math.round((book.fetching || 0) * 100)}%</span>}
        {pct > 0 && (
          <div class="progress-mini">
            <div style={{ width: pct + '%' }} />
          </div>
        )}
      </div>
      <div class="book-card-title">{book.title}</div>
      <div class="book-card-author">{book.author || ' '}</div>
      {typeof book.why === 'string' && book.why && <div class="book-card-why">{book.why}</div>}
    </button>
  );
});

// Last contents of slow rows (your cloud, your server), shown at once on the next open.
const rowCache = persisted('rowCache', {});
const ROW_KEEP = ['uid', 'source', 'kind', 'title', 'author', 'narrator', 'cover', 'year', 'duration', 'addedAt', 'hash', 'format', 'fetching', 'genres'];
const slim = (b) => Object.fromEntries(ROW_KEEP.filter((k) => b?.[k] !== undefined).map((k) => [k, b[k]]));

export function Row({ title, subtitle, load, items: given, icon, onMore, deps = [], showErrors = false, emptyText = '', cacheKey = '' }) {
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
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {onMore && (
          <span class="link-btn see-all">
            See all{items ? ` ${items.length}` : ''} ›
          </span>
        )}
      </header>
      <div class="row-scroll">
        {items ? items.map((b) => <SafeCard key={b.uid} book={b} />) : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} />)}
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

export function TopBar({ title, back = true, right, transparent }) {
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
      <div class="topbar-right">{right}</div>
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
