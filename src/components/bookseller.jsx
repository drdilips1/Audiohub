import { Icon } from './icons.jsx';
import { Cover } from './common.jsx';
import { nav } from '../lib/nav.js';
import { fmtDuration } from '../lib/format.js';
import { askBookseller, aiReady } from '../lib/bookseller.js';
import { useStore } from '../lib/store.js';

// Examples shown as the search box's rotating hint.
export const EXAMPLES = ['Atmospheric sci-fi under 12 hours that feels like Project Hail Mary', 'A cosy mystery with a great narrator', 'Big-idea non-fiction like Sapiens, but shorter', 'Something funny for a long drive', "I'm exhausted: fascinating but not demanding", 'I have 40 minutes and want something that makes me think'];

/** Ask for books in plain words, like talking to a bookseller (from the Discover search box). */
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

/** True when the search text reads like a request ("funny, under 5 hours") rather than a title. */
export function looksLikeRequest(text) {
  const t = text.trim();
  const words = t.split(/\s+/).length;
  if (words < 3) return false;
  return words >= 5 || /\b(like|something|want|need|under|less than|hours?|books? (about|on|for)|recommend|similar|i'm|i am|feel|mood|short|long drive|for my)\b/i.test(t);
}

/** Ask the bookseller; the answer shows in <BooksellerAnswer>. */
export async function askNow(text) {
  const t = text.trim();
  if (!t || (last.get().q === t && (last.get().busy || last.get().res))) return;
  last.set({ q: t, res: null, err: '', busy: true });
  try {
    const r = await askBookseller(t);
    if (last.get().q === t) last.set({ q: t, res: r, err: '', busy: false });
  } catch (e) {
    if (last.get().q === t) last.set({ q: t, res: null, err: e.message, busy: false });
  }
}

/** Above search results: an offer to ask the bookseller, or its answer once asked. */
export function BooksellerAnswer({ q }) {
  const { q: asked, res, err, busy } = useStore(last);
  const t = q.trim();
  if (asked !== t)
    return (
      <button class="bookseller-bar" onClick={() => askNow(t)}>
        <Icon name="sparkle" size={18} />
        <span>
          <b>Ask the bookseller</b> “{t}”
        </span>
      </button>
    );
  return (
    <section class="bookseller">
      <div class="bookseller-head">
        <Icon name="sparkle" size={18} />
        <b>The bookseller</b>
      </div>
      {!aiReady() && !res && (
        <p class="muted small">
          Works now with the Audible catalogue. For smarter, more personal picks add a free AI key in{' '}
          <button class="link-btn" onClick={() => nav.tab('settings')}>
            Settings → AI
          </button>
          .
        </p>
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
        </div>
      )}
    </section>
  );
}
