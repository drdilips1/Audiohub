// Your own tags on a book (Psychology, Science, Spirituality…): added on the book page,
// filtered by in the Library. Kept per book in `bookTags`, synced and backed up.
import { useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { bookTags, useStore } from '../lib/store.js';

/** Every tag in use, most used first. */
export function allTags(tags = bookTags.get()) {
  const n = new Map();
  for (const list of Object.values(tags || {})) for (const t of list || []) n.set(t, (n.get(t) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 30);

function setTags(uid, list) {
  bookTags.set((all) => {
    const next = { ...all };
    if (list.length) next[uid] = list;
    else delete next[uid];
    return next;
  });
}

/** Book page: this book's tags, tap × to remove, "+ Tag" to add (with your other tags offered). */
export function BookTags({ book }) {
  const all = useStore(bookTags);
  const mine = all[book.uid] || [];
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const add = (t) => {
    const tag = clean(t);
    if (tag && !mine.some((x) => x.toLowerCase() === tag.toLowerCase())) setTags(book.uid, [...mine, tag]);
    setText('');
  };
  const others = allTags(all).filter((t) => !mine.includes(t) && (!text || t.toLowerCase().includes(text.toLowerCase())));
  return (
    <section class="pad book-tags">
      <div class="chips">
        <span class="book-tags-label">
          <Icon name="bookmark" size={14} /> Tags
        </span>
        {mine.map((t) => (
          <button class="pill small tag-chip" onClick={() => setTags(book.uid, mine.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>
            {t} <Icon name="close" size={12} />
          </button>
        ))}
        {!adding && (
          <button class="pill small ghost" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} /> Tag
          </button>
        )}
      </div>
      {adding && (
        <form
          class="book-tags-add"
          onSubmit={(e) => {
            e.preventDefault();
            add(text);
          }}
        >
          <input autoFocus value={text} maxLength={30} placeholder="e.g. Psychology" onInput={(e) => setText(e.currentTarget.value)} />
          <button class="btn primary" disabled={!clean(text)}>
            Add
          </button>
          <button type="button" class="btn secondary" onClick={() => (setAdding(false), setText(''))}>
            Done
          </button>
          {others.length > 0 && (
            <div class="chips">
              {others.slice(0, 12).map((t) => (
                <button type="button" class="pill small" onClick={() => add(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </form>
      )}
    </section>
  );
}
