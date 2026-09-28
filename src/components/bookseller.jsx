import { useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { Cover } from './common.jsx';
import { nav } from '../lib/nav.js';
import { fmtDuration } from '../lib/format.js';
import { askBookseller, aiReady } from '../lib/bookseller.js';
import { useStore } from '../lib/store.js';

const EXAMPLES = ['Atmospheric sci-fi under 12 hours that feels like Project Hail Mary', 'A cosy mystery with a great narrator', 'Big-idea non-fiction like Sapiens, but shorter', 'Something funny for a long drive'];

/** Ask for books in plain words, like talking to a bookseller. */
// The last question and its answer stay while the app is open, so opening a pick and
// coming back shows the same list; a fresh start of the app starts clean. A request
// keeps going if you leave the screen.
function memoryStore(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? next(value) : next;
      subs.forEach((f) => f(value));
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}
const last = memoryStore({ q: '', res: null, err: '', busy: false });
try {
  localStorage.removeItem('inkwell:bookseller'); // the saved copy from the previous version
} catch {}

export function AskBookseller() {
  const { res, err, busy } = useStore(last);
  const [q, setQ] = useState(last.get().q);
  const ask = async (text) => {
    const t = (text ?? q).trim();
    if (!t) return;
    setQ(t);
    last.set({ q: t, res: null, err: '', busy: true });
    try {
      const r = await askBookseller(t);
      last.set({ q: t, res: r, err: '', busy: false });
    } catch (e) {
      last.set({ q: t, res: null, err: e.message, busy: false });
    }
  };
  return (
    <section class="bookseller">
      <div class="bookseller-head">
        <Icon name="sparkle" size={18} />
        <b>Ask the bookseller</b>
      </div>
      {!aiReady() && (
        <p class="muted small">
          Works now with the Audible catalogue. For smarter, more personal picks add a free AI key in{' '}
          <button class="link-btn" onClick={() => nav.tab('settings')}>
            Settings → AI
          </button>
          .
        </p>
      )}
      <>
        <form
          class="bookseller-form"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <textarea rows={2} value={q} placeholder="e.g. atmospheric sci-fi under 12 hours that feels like Project Hail Mary" onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), ask())} />
          <button class="btn primary" disabled={busy || !q.trim()} aria-label="Ask">
            {busy ? <span class="spinner" /> : <Icon name="sparkle" size={16} />}
          </button>
        </form>
        {!res && !busy && (
          <div class="chips bookseller-examples">
            {EXAMPLES.map((x) => (
              <button class="pill small" onClick={() => ask(x)}>
                {x}
              </button>
            ))}
          </div>
        )}
        {busy && <p class="muted">Thinking about what you'd love…</p>}
        {err && <p class="err">{err}</p>}
        {res && (
          <div class="bookseller-results">
            {res.intro && <p class="bookseller-intro">{res.intro}</p>}
            {res.books.length ? (
              res.books.map((b) => (
                <button class="bookseller-item" onClick={() => nav.push('book', { book: b })}>
                  <Cover book={b} />
                  <div>
                    <b>{b.title}</b>
                    <small>
                      {b.author}
                      {b.duration ? ` · ${fmtDuration(b.duration)}` : b.aiHours ? ` · ~${Math.round(b.aiHours)} h` : ''}
                      {b.rating ? ` · ★ ${Number(b.rating).toFixed(1)}` : ''}
                    </small>
                    {b.why && <p>{b.why}</p>}
                  </div>
                </button>
              ))
            ) : (
              <p class="muted">Couldn't find those in the catalogue — try asking differently.</p>
            )}
            <button
              class="link-btn bookseller-clear"
              onClick={() => {
                setQ('');
                last.set({ q: '', res: null, err: '', busy: false });
              }}
            >
              Clear
            </button>
          </div>
        )}
      </>
    </section>
  );
}
