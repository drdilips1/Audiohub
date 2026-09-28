import { useEffect, useMemo, useState } from 'preact/hooks';
import { TopBar, Grid, Skeleton, Empty } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { words } from '../lib/match.js';

const SORTS = [
  ['recent', 'Recent'],
  ['title', 'A–Z'],
  ['author', 'Author'],
];

/** Full-screen grid for a whole library/shelf (TorBox, Real-Debrid, ABS, Hardcover…). */
export function Shelf({ title, subtitle, load }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('recent');

  useEffect(() => {
    let alive = true;
    load()
      .then((r) => alive && setItems(r))
      .catch((e) => alive && setError(e));
    return () => (alive = false);
  }, []);

  const shown = useMemo(() => {
    if (!items) return null;
    const q = words(filter);
    let list = q.length ? items.filter((b) => q.every((w) => words(`${b.title} ${b.author} ${b.rawName || ''}`).some((x) => x.startsWith(w)))) : items.slice();
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'author') list.sort((a, b) => (a.author || '~').localeCompare(b.author || '~') || a.title.localeCompare(b.title));
    return list;
  }, [items, filter, sort]);

  return (
    <div class="screen shelf">
      <TopBar title={title} />
      {subtitle && <p class="muted pad shelf-sub">{subtitle}{items ? ` · ${items.length} titles` : ''}</p>}
      <div class="search-box small">
        <Icon name="search" size={18} />
        <input value={filter} placeholder={`Filter ${title}…`} onInput={(e) => setFilter(e.currentTarget.value)} />
      </div>
      <div class="segmented">
        {SORTS.map(([k, label]) => (
          <button class={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
            {label}
          </button>
        ))}
      </div>
      {error ? (
        <p class="row-note bad">Couldn't load: {error.message}</p>
      ) : !shown ? (
        <div class="grid">{Array.from({ length: 9 }, () => <Skeleton />)}</div>
      ) : shown.length ? (
        <Grid items={shown} />
      ) : (
        <Empty icon="library" title={filter ? 'No matches' : 'Nothing here yet'}>
          {filter ? 'Try a different filter.' : ''}
        </Empty>
      )}
      <div class="footer-space" />
    </div>
  );
}
