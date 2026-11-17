// Home: new books from the authors and narrators you follow (looked up once a day).
import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../lib/store.js';
import { following, newFromFollowed } from '../lib/people.js';
import { nav } from '../lib/nav.js';
import { Cover } from './common.jsx';
import { Icon } from './icons.jsx';

export function FollowRow() {
  const fol = useStore(following);
  const [items, setItems] = useState([]);
  useEffect(() => {
    let alive = true;
    newFromFollowed()
      .then((l) => alive && setItems(l))
      .catch(() => {});
    return () => (alive = false);
  }, [Object.keys(fol).join()]);
  if (!items.length) return null;
  return (
    <section class="follow-row">
      <div class="d-head home-head">
        <span class="d-ico">
          <Icon name="sparkle" size={20} />
        </span>
        <h3>New from people you follow</h3>
      </div>
      <div class="pp-row pad-x">
        {items.map(({ book, who, role }) => (
          <button class="pp-tile" onClick={() => nav.push('book', { book })}>
            <span class="pp-cv">
              <Cover book={book} />
              {book.released > Date.now() && <em class="pp-done soon">Coming</em>}
            </span>
            <b>{book.title}</b>
            <small>{role === 'narrator' ? `read by ${who}` : who}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
