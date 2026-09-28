import { useEffect, useState } from 'preact/hooks';

// Tiny persistent reactive store backed by localStorage.
// Pending saves are written at once when the app is backgrounded or closed,
// so nothing (reading position, a book just opened) is lost if Android kills it.
const pending = new Map();
const flushAll = () => pending.forEach((write) => write());
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushAll());
}

export function persisted(key, initial) {
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
        try {
          localStorage.setItem('inkwell:' + key, JSON.stringify(value));
        } catch {}
      };
      pending.set(key, write);
      saveTimer = setTimeout(write, 150);
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
export function useStoreKey(store, key) {
  const [v, setV] = useState(() => store.get()[key]);
  useEffect(() => {
    setV(store.get()[key]);
    return store.subscribe((all) => setV(all[key]));
  }, [store, key]);
  return v;
}

export const settings = persisted('settings', {
  mode: 'dark', // dark | light | amoled
  accent: 'audiohub',
  palette: 'default', // colour theme (see PALETTES in theme.js)
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
  skipFrontMatter: true,
  kindleEmail: '', // Send to Kindle by e-mail // Listen / Read aloud skip contents, index, copyright pages
  language: 'en',
  debridPreferred: 'torbox', // torbox | realdebrid
  downloadTarget: 'public', // public = Downloads/Inkwell, app = private app storage
  metaProviders: { audible: true, apple: true, google: true, openlibrary: true },
  metaOrder: ['audible', 'apple', 'google', 'openlibrary'],
});

export const library = persisted('library', {}); // uid -> book summary + addedAt
export const progress = persisted('progress', {}); // uid -> { track, time, duration, percent, finished, updatedAt, book, kind }
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

export function exportBackup() {
  return JSON.stringify(
    {
      app: 'inkwell',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: settings.get(),
      library: library.get(),
      progress: progress.get(),
      bookmarks: bookmarks.get(),
      addons: addons.get(),
    },
    null,
    2
  );
}

export function importBackup(text) {
  const data = JSON.parse(text);
  if (data.app !== 'inkwell') throw new Error('Not an Inkwell backup file');
  if (data.settings) settings.set({ ...settings.get(), ...data.settings });
  if (data.library) library.set({ ...library.get(), ...data.library });
  if (data.progress) progress.set({ ...progress.get(), ...data.progress });
  if (data.bookmarks) bookmarks.set({ ...bookmarks.get(), ...data.bookmarks });
  if (Array.isArray(data.addons)) addons.set(data.addons);
}

export const debrid = persisted('debrid', { torbox: '', realdebrid: '' });
export const hardcover = persisted('hardcover', { token: '', username: '' });
export const goodreads = persisted('goodreads', { books: [], importedAt: 0 });
