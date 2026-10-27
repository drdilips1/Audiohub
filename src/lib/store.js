import { useEffect, useState } from 'preact/hooks';
import { emergencyTrim } from './storage-trim.js'; // runs first: trims oversized caches before stores load

// Tiny persistent reactive store backed by localStorage.
// Pending saves are written at once when the app is backgrounded or closed,
// so nothing (reading position, a book just opened) is lost if Android kills it.
const pending = new Map();
const flushAll = () => pending.forEach((write) => write());
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushAll());
}

export function persisted(key, initial, { delay = 150 } = {}) {
  let value = initial;
  try {
    const raw = localStorage.getItem('inkwell:' + key);
    if (raw) value = mergeDefaults(initial, JSON.parse(raw));
  } catch {}
  const subs = new Set();
  let saveTimer;
  const store = {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? next(value) : next;
      subs.forEach((f) => f(value));
      clearTimeout(saveTimer);
      const write = () => {
        clearTimeout(saveTimer);
        pending.delete(key);
        const text = JSON.stringify(value);
        try {
          localStorage.setItem('inkwell:' + key, text);
        } catch {
          // Storage full: make room in the caches and try once more (progress and settings must save).
          emergencyTrim();
          try {
            localStorage.setItem('inkwell:' + key, text);
          } catch {}
        }
      };
      if (!delay) return write(); // progress: saved at once, never left waiting on a timer
      pending.set(key, write);
      // Big caches are written less often (each write re-saves the whole thing).
      saveTimer = setTimeout(write, delay);
    },
    patch(part) {
      store.set((v) => ({ ...v, ...part }));
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
  return store;
}

function mergeDefaults(initial, saved) {
  if (initial && typeof initial === 'object' && !Array.isArray(initial) && saved && typeof saved === 'object') {
    const out = { ...initial, ...saved };
    for (const k of Object.keys(initial)) {
      const d = initial[k];
      if (d && typeof d === 'object' && !Array.isArray(d) && saved[k] && typeof saved[k] === 'object') out[k] = { ...d, ...saved[k] };
    }
    return out;
  }
  return saved;
}

export function useStore(store) {
  const [v, setV] = useState(store.get());
  useEffect(() => store.subscribe(setV), [store]);
  return v;
}

/**
 * One entry of a keyed store (e.g. one book's progress): the component only
 * re-renders when that entry changes, not on every save of any book.
 */
/**
 * Subscribe to a summary of a store (`select` returns a string or number): the screen
 * only redraws when that summary changes, not on every save (e.g. playback position).
 */
export function useSelect(store, select) {
  const [v, setV] = useState(() => select(store.get()));
  useEffect(() => {
    let cur = select(store.get());
    setV(cur);
    return store.subscribe((all) => {
      const next = select(all);
      if (next !== cur) setV((cur = next));
    });
  }, [store]);
  return v;
}

export function useStoreKey(store, key) {
  const [v, setV] = useState(() => store.get()[key]);
  useEffect(() => {
    setV(store.get()[key]);
    return store.subscribe((all) => setV(all[key]));
  }, [store, key]);
  return v;
}

export const settings = persisted('settings', {
  mode: 'system', // system | light | dark | amoled
  accent: 'brass',
  palette: 'paperink', // colour theme (see PALETTES in theme.js)
  playerBg: 'cover', // cover | living | plain | photo | wall:<name>
  playerDim: 0.45, // how much the player background is darkened (0–0.8)
  dynamicColor: true,
  skipBack: 15,
  skipForward: 30,
  speed: 1,
  sourceOrder: [], // user's preferred order of source keys (Settings → Sources)
  sources: { ia: true, lv: true, gb: true, ol: true, abs: true, addons: true, tb: true, rd: true, hc: true, gr: true, hi: false },
  readerSize: 19,
  readerTheme: 'night', // night | sepia | paper | amoled
  readerFont: 'serif',
  readerJustify: true,
  readerLine: 1.72,
  readerMargin: 24,
  skipFrontMatter: true,
  kindleEmail: '', // Send to Kindle by e-mail // Listen / Read aloud skip contents, index, copyright pages
  language: 'en',
  debridPreferred: 'torbox', // torbox | realdebrid
  downloadTarget: 'public', // public = Downloads/Inkwell, app = private app storage
  metaProviders: { audible: true, apple: true, google: true, openlibrary: true },
  metaOrder: ['audible', 'apple', 'google', 'openlibrary'],
});

export const library = persisted('library', {}); // uid -> book summary + addedAt
export const progress = persisted('progress', {}, { delay: 0 }); // uid -> { track, time, duration, percent, finished, updatedAt, book, kind }
export const bookmarks = persisted('bookmarks', {}); // uid -> [{ track, time, label, createdAt }]
export const addons = persisted('addons', []); // [{ url, manifest }]
export const abs = persisted('abs', { server: '', altServer: '', token: '', refreshToken: '', username: '', libraryId: '' });

export function summarize(book) {
  const { uid, source, kind, title, author, cover, year, duration, ebookUrl, ebookName, ebookFormat } = book;
  // Direct-link ebooks keep their link so Continue can reopen them.
  const direct = ebookUrl ? { ebookUrl, ebookName, ebookFormat } : {};
  return { uid, source, kind, title, author, cover, year, duration, ...direct };
}

export function toggleLibrary(book) {
  const had = !!library.get()[book.uid];
  if (had) markRemoved(book.uid, { lib: true });
  library.set((lib) => {
    const next = { ...lib };
    if (had) delete next[book.uid];
    else next[book.uid] = { ...summarize(book), addedAt: Date.now() };
    return next;
  });
}

// ---- removals & data hygiene -----------------------------------------------------
// Removed books are remembered (uid -> { lib, prog } times) and synced, so another
// device's copy doesn't bring them back. A newer save / reading session wins again.
export const removedBooks = persisted('removedBooks', {});

function markRemoved(uid, { lib = false, prog = false }) {
  const now = Date.now();
  removedBooks.set((r) => {
    const next = { ...r, [uid]: { ...(r[uid] || {}), ...(lib ? { lib: now } : {}), ...(prog ? { prog: now } : {}) } };
    const keys = Object.keys(next);
    if (keys.length > 500) keys.slice(0, keys.length - 500).forEach((k) => delete next[k]);
    return next;
  });
}

const validBook = (b) => !!b && typeof b === 'object' && typeof b.uid === 'string' && b.uid.length > 0;

/** Saved books without malformed entries (e.g. a null from an old sync) or removed ones. */
export function cleanLibrary(lib) {
  const gone = removedBooks.get();
  const out = {};
  for (const [k, b] of Object.entries(lib || {})) if (validBook(b) && !((gone[k]?.lib || 0) >= (b.addedAt || 0))) out[k] = b;
  return out;
}

/** Reading/listening history, cleaned the same way. */
export function cleanProgress(all) {
  const gone = removedBooks.get();
  const out = {};
  for (const [k, p] of Object.entries(all || {})) if (p && typeof p === 'object' && validBook(p.book) && !((gone[k]?.prog || 0) >= (p.updatedAt || 0))) out[k] = p;
  return out;
}

/** Remove a book from the library and its history (Library → Edit). */
/** Take books off Home's Continue row (the place is kept; listening or reading again brings them back). */
export function hideFromContinue(uids) {
  progress.set((all) => {
    const next = { ...all };
    for (const u of uids) if (next[u]) next[u] = { ...next[u], hidden: true };
    return next;
  });
}

/** Clear podcast listening history: where you were in episodes you haven't finished. */
export function clearPodcastHistory() {
  progress.set((all) => Object.fromEntries(Object.entries(all).filter(([, p]) => !(p?.book?.source === 'pod' && !p.finished))));
}

export function forgetBook(uid) {
  markRemoved(uid, { lib: true, prog: true });
  library.set((lib) => {
    const next = { ...lib };
    delete next[uid];
    return next;
  });
  progress.set((all) => {
    const next = { ...all };
    delete next[uid];
    return next;
  });
}

/** Merge per-book removal times, keeping the latest of each. */
export function mergeRemoved(local, remote) {
  const out = { ...local };
  for (const [k, v] of Object.entries(remote || {})) {
    if (!v || typeof v !== 'object') continue;
    const cur = out[k] || {};
    out[k] = { lib: Math.max(cur.lib || 0, v.lib || 0) || undefined, prog: Math.max(cur.prog || 0, v.prog || 0) || undefined };
  }
  return out;
}

// Backup = everything you'd miss on a new phone. Left out: caches (rebuilt on their own) and
// things tied to this phone (downloaded files, phone folders, sign-in sessions).
const NOT_BACKED_UP = new Set([
  'aiCache', 'aiRouterModels', 'bookSummaries', 'booksellerCache', 'heroCache', 'metaCache', 'podcastFeeds',
  'ratingsCache', 'rowCache', 'transcriptCache', 'knownCharacters', 'grPages', 'sourceCache', 'moodShelves',
  'syncStamps', 'update', 'updateRun', 'downloads', 'localBooks', 'qbitAutoLast', 'qbitLastCapture', 'askThreads',
]);
// Logins and API keys: in the backup unless you switch it off.
const KEYS = new Set(['debrid', 'ai', 'abs', 'hardcover', 'qbit', 'tracker', 'voice', 'account']);

export function exportBackup({ keys = true } = {}) {
  flushAll(); // include changes from the last moment
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const full = localStorage.key(i);
    if (!full?.startsWith('inkwell:')) continue;
    const k = full.slice(8);
    if (NOT_BACKED_UP.has(k) || (!keys && KEYS.has(k))) continue;
    try {
      let v = JSON.parse(localStorage.getItem(full));
      // Your sync server, but not the sign-in session (sign in again on the new phone).
      if (k === 'account' && v) v = { url: v.url || '', anonKey: v.anonKey || '', email: v.email || '' };
      data[k] = v;
    } catch {}
  }
  return JSON.stringify({ app: 'inkwell', version: 2, exportedAt: new Date().toISOString(), keys, data });
}

/** Restore a backup (this app's, or an older one), then reload so every screen uses it. */
export function importBackup(text) {
  let backup;
  try {
    backup = JSON.parse(String(text).trim());
  } catch {
    throw new Error('That isn’t an Audiohub backup (copy the whole text)');
  }
  if (backup?.app !== 'inkwell') throw new Error('That isn’t an Audiohub backup');
  // Older backups: a few stores, merged into what's here.
  const data = backup.data || {
    settings: { ...settings.get(), ...(backup.settings || {}) },
    library: { ...library.get(), ...(backup.library || {}) },
    progress: { ...progress.get(), ...(backup.progress || {}) },
    bookmarks: { ...bookmarks.get(), ...(backup.bookmarks || {}) },
    ...(Array.isArray(backup.addons) ? { addons: backup.addons } : {}),
  };
  pending.clear(); // unsaved changes must not overwrite the restored data on reload
  for (const [k, v] of Object.entries(data)) {
    if (NOT_BACKED_UP.has(k)) continue;
    try {
      localStorage.setItem('inkwell:' + k, JSON.stringify(v));
    } catch {}
  }
  setTimeout(() => {
    pending.clear();
    location.reload();
  }, 600);
}

export const debrid = persisted('debrid', { torbox: '', realdebrid: '' });
export const hardcover = persisted('hardcover', { token: '', username: '' });
export const goodreads = persisted('goodreads', { books: [], importedAt: 0 });
// Ebook highlights and notes: uid -> [{ id, parts: [{ a, t }], text, note, at, book }] (see highlights.js)
export const highlights = persisted('highlights', {});
// Ids of highlights you removed (id -> when), so a backup or another device doesn't bring them back.
export const highlightsGone = persisted('highlightsGone', {});

/** Highlights from two places (backup, another device): every one of both, by id. */
export function mergeHighlights(local, remote) {
  const out = { ...local };
  for (const [uid, list] of Object.entries(remote || {})) {
    if (!Array.isArray(list)) continue;
    const have = new Set((out[uid] || []).map((h) => h.id));
    const gone = highlightsGone.get();
    const more = list.filter((h) => h?.id && h.parts?.length && !have.has(h.id) && !gone[h.id]);
    if (more.length) out[uid] = [...(out[uid] || []), ...more].sort((x, y) => x.parts[0].a - y.parts[0].a);
  }
  return out;
}
