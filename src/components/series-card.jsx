import { useEffect, useMemo, useState } from 'preact/hooks';
import { Cover } from './common.jsx';
import { useStore, library, progress } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { mainTitle, matches } from '../lib/match.js';
import { seriesOf, seriesBooks, statusIn, nextIn } from '../lib/series.js';

const LABEL = { finished: '✓ Finished', have: 'You have it', reading: '' };

/**
 * The book's series on its page: "Book 2 of The Stormlight Archive", every book in
 * order with where you are, and what's next. Missing volumes are easy to spot.
 */
export function SeriesCard({ book }) {
  const s = seriesOf(book);
  const [books, setBooks] = useState(null);
  useStore(progress);
  useStore(library);
  useEffect(() => {
    setBooks(null);
    if (!s?.name) return;
    let alive = true;
    seriesBooks(s.name, book.author)
      .then((b) => alive && setBooks(b))
      .catch(() => alive && setBooks([]));
    return () => (alive = false);
  }, [s?.name, book.author]);
  const list = useMemo(() => (books ? statusIn(books) : []), [books]);
  if (!s?.name || (books && books.length < 2)) return null;
  const here = list.findIndex((x) => matches(mainTitle(book.title), x.book.title));
  const next = nextIn(list);
  const done = list.filter((x) => x.state === 'finished').length;
  return (
    <section class="series-card">
      <div class="series-head">
        <div>
          <span class="available-label">Series</span>
          <b>
            {s.n != null ? `Book ${s.n} of ` : ''}
            {s.name}
          </b>
          <small>
            {books ? `${list.length} books` : 'Looking up the series…'}
            {done ? ` · ${done} finished` : ''}
          </small>
        </div>
        {next && next.book.uid !== list[here]?.book.uid && (
          <button class="pill small" onClick={() => nav.push('book', { book: next.book })}>
            Next: {next.book.seriesN != null ? `#${next.book.seriesN} ` : ''}
            {mainTitle(next.book.title).slice(0, 28)}
          </button>
        )}
      </div>
      {list.length > 0 && (
        <div class="series-row">
          {list.map((x, i) => (
            <button class={'series-item' + (i === here ? ' here' : '') + (x.state ? ' ' + x.state : '')} onClick={() => i !== here && nav.push('book', { book: x.book })}>
              <Cover book={x.book} />
              <span class="series-num">{x.book.seriesN != null ? `#${x.book.seriesN}` : '·'}</span>
              <small>{x.state === 'reading' ? `${x.pct}%` : i === here ? 'This book' : LABEL[x.state] || 'Not yet'}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
