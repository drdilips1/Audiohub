// The Up next list: on Home (when there's something in it) and in the player (More → Up next).
import { Icon } from './icons.jsx';
import { Cover } from './common.jsx';
import { useStore } from '../lib/store.js';
import { upNext, removeUpNext, moveUpNext, playUpNext } from '../lib/upnext.js';
import { fmtTime } from '../lib/format.js';

export function UpNextList({ onPlay }) {
  const list = useStore(upNext);
  if (!list.length)
    return <p class="muted small pad-s">Nothing lined up. Press and hold a book → Add to Up next, or press and hold a bookmark to queue that passage — it plays when the current book ends.</p>;
  return (
    <ol class="upnext-list">
      {list.map((x, i) => (
        <li key={x.id}>
          <button class="upnext-main" onClick={() => (playUpNext(x), onPlay?.())}>
            <Cover book={x.book} />
            <span>
              <b>{x.book.title}</b>
              <small>{x.at != null ? `“${x.label || 'Saved passage'}” · ${fmtTime(x.at)}` : x.book.author || ''}</small>
            </span>
          </button>
          {i > 0 && (
            <button class="icon-btn" aria-label="Move up" onClick={() => moveUpNext(x.id, -1)}>
              <Icon name="up" size={16} />
            </button>
          )}
          <button class="icon-btn" aria-label="Remove from Up next" onClick={() => removeUpNext(x.id)}>
            <Icon name="close" size={16} />
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Home: the queue, when it has something. */
export function UpNextRow() {
  const list = useStore(upNext);
  if (!list.length) return null;
  return (
    <section class="row upnext-row">
      <header class="row-head">
        <div>
          <h2>
            <Icon name="list" size={18} /> Up next <span class="row-count">{list.length}</span>
          </h2>
          <p>Plays when the current book ends</p>
        </div>
        <button class="link-btn see-all" onClick={() => playUpNext()}>
          Play now ›
        </button>
      </header>
      <div class="pad">
        <UpNextList />
      </div>
    </section>
  );
}
