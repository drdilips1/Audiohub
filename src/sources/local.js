// Audiobooks already on the phone. You pick a folder once (Android asks for that
// folder only); every book folder inside becomes a book and plays in place —
// "CD1 / Disc 2" style subfolders count as part of their book, and loose audio
// files at the top become one book each.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { persisted, useStore } from '../lib/store.js';
import { cleanTitle, splitAuthor, audioFormat } from './debrid.js';

export const Native = registerPlugin('InkwellLocal');
export const available = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellLocal');

export const localCfg = persisted('localBooks', { folders: [], books: [], scannedAt: 0 });
export const connected = () => available && localCfg.get().folders.length > 0;

const AUDIO = /\.(mp3|m4b|m4a|aac|flac|ogg|oga|opus|wav|wma|mka)$/i;
const EBOOK = /\.(epub|pdf)$/i;

/**
 * A phone file as the web view can fetch it. Relative, so the request goes to the
 * app's own file server (an absolute localhost URL would be sent to the network).
 */
export const localUrl = (uri) => Capacitor.convertFileSrc(uri).replace(/^https?:\/\/[^/]+/, '');
const DISC = /^(cd|disc|disk|part|vol(ume)?|teil)[\s._-]*\d+/i;
const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** Choose a folder (e.g. "Audiobooks") and list the books in it. */
export async function addFolder() {
  if (!available) throw new Error('Books on this phone work in the Android app');
  const f = await Native.pickFolder();
  localCfg.set((c) => ({ ...c, folders: [...c.folders.filter((x) => x.uri !== f.uri), { uri: f.uri, name: f.name || 'Folder' }] }));
  return rescan();
}
export function removeFolder(uri) {
  localCfg.set((c) => ({ ...c, folders: c.folders.filter((x) => x.uri !== uri), books: c.books.filter((b) => b.folder !== uri) }));
}

/** Read the folders again (new books, removed books). */
export async function rescan() {
  const books = [];
  const errors = [];
  const before = new Map(localCfg.get().books.map((b) => [b.uid, b]));
  for (const folder of localCfg.get().folders) {
    try {
      const { files = [], covers = [] } = await Native.scan({ uri: folder.uri });
      // Keep covers already made for books that are still there.
      books.push(...group(folder, files, covers).map((b) => ({ ...b, cover: before.get(b.uid)?.cover || '' })));
    } catch (e) {
      errors.push(`${folder.name}: ${e.message}`);
    }
  }
  localCfg.set((c) => ({ ...c, books: [...books, ...(c.imported || [])], scannedAt: Date.now(), v: 2 }));
  if (errors.length && !books.length) throw new Error(errors.join(' · '));
  makeCovers();
  return books;
}

// Covers: the folder's cover image, else the art inside the first audio file;
// ebooks: the cover inside the EPUB, or a PDF's first page — made one book at a
// time in the background (books without any get a cover from the online lookup).
let coversRunning = false;
const toBase64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
async function ebookCover(b) {
  if (b.ebookFormat === 'PDF') return { pdf: b.path || b.ebookUri || '' };
  const { epubCover } = await import('../lib/epub.js');
  const bytes = new Uint8Array(await (await fetch(b.ebookUrl)).arrayBuffer());
  const img = await epubCover(bytes);
  return img ? { data: toBase64(img) } : {};
}
async function makeCovers() {
  if (coversRunning) return;
  coversRunning = true;
  try {
    for (const b of localCfg.get().books) {
      if (b.cover || b.noCover) continue;
      let path = '';
      try {
        const from = b.kind === 'text' ? await ebookCover(b) : { image: b.coverImage || '', audio: b.files?.[0]?.uri || '' };
        ({ path } = await Native.cover({ key: b.uid.replace(/[:#]/g, '_'), ...from }));
      } catch {}
      setCover(b.uid, path ? Capacitor.convertFileSrc(path) : '', !path);
    }
  } finally {
    coversRunning = false;
  }
}

/** Set a phone book's cover (made here, or picked with Find cover & details); kept across rescans. */
export function setCover(uid, cover, noCover = false) {
  const put = (list) => (list || []).map((x) => (x.uid === uid ? { ...x, cover, noCover } : x));
  localCfg.set((c) => ({ ...c, books: put(c.books), imported: put(c.imported) }));
}
if (available) setTimeout(makeCovers, 4000); // books scanned before covers existed
// Folders scanned before ebooks were found: look again once, so EPUB / PDF files show up.
if (available && connected() && (localCfg.get().v || 1) < 2) setTimeout(() => rescan().catch(() => {}), 2500);

function group(folder, files, covers = []) {
  const coverIn = new Map();
  for (const c of covers) if (!coverIn.has(c.dir || '')) coverIn.set(c.dir || '', c.uri);
  const byDir = new Map();
  for (const f of files) {
    if (!AUDIO.test(f.name)) continue;
    const parts = (f.dir || '').split('/').filter(Boolean);
    // "Book/CD1/01.mp3" belongs to "Book".
    while (parts.length && DISC.test(parts[parts.length - 1])) parts.pop();
    const key = parts.length ? parts.join('/') : `file:${f.uri}`; // loose files: one book each
    if (!byDir.has(key)) byDir.set(key, { parts, files: [] });
    byDir.get(key).files.push(f);
  }
  const out = [];
  // Ebooks (EPUB, PDF): each file is a book, read in the app's reader.
  for (const f of files) {
    if (!EBOOK.test(f.name)) continue;
    const parts = (f.dir || '').split('/').filter(Boolean);
    let { author, title } = splitAuthor(cleanTitle(f.name.replace(EBOOK, '')));
    // "Author/Book.epub" (or Calibre's "Author/Title (12)/Title - Author.epub").
    if (!author && parts.length) author = cleanTitle(parts[parts.length >= 2 && /\(\d+\)$/.test(parts[parts.length - 1]) ? parts.length - 2 : parts.length - 1]);
    const format = EBOOK.exec(f.name)[1].toUpperCase();
    out.push({
      uid: `loc:${hash(folder.uri + '|' + f.uri)}#ebook`,
      source: 'loc',
      kind: 'text',
      title,
      author,
      cover: '',
      format,
      size: Number(f.size) || 0,
      folder: folder.uri,
      ebookName: f.name,
      ebookFormat: format,
      ebookUri: f.uri,
      ebookUrl: localUrl(f.uri),
      addedAt: Date.now(),
    });
  }
  for (const [key, { parts, files: list }] of byDir) {
    list.sort((a, b) => (a.dir || '').localeCompare(b.dir || '', undefined, { numeric: true }) || natural(a, b));
    const name = parts.length ? parts[parts.length - 1] : list[0].name.replace(AUDIO, '');
    let { author, title } = splitAuthor(cleanTitle(name));
    // "Author/Title/" folders: the parent folder is the author.
    if (!author && parts.length >= 2) author = cleanTitle(parts[parts.length - 2]);
    out.push({
      uid: `loc:${hash(folder.uri + '|' + key)}`,
      source: 'loc',
      kind: 'audio',
      title,
      author,
      cover: '',
      parts: list.length,
      format: audioFormat(list),
      size: list.reduce((a, f) => a + (Number(f.size) || 0), 0),
      folder: folder.uri,
      // A cover image in the book's folder (or its CD1 / Disc 1 folder).
      coverImage: parts.length ? coverIn.get(parts.join('/')) || list.map((f) => coverIn.get(f.dir || '')).find(Boolean) || '' : '',
      files: list.map((f) => ({ uri: f.uri, name: f.name, size: Number(f.size) || 0 })),
      addedAt: Date.now(),
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** All books on this phone (scans the first time). */
export async function library() {
  if (!connected()) return [];
  const c = localCfg.get();
  if (!c.scannedAt) return rescan();
  return c.books;
}

export async function search(q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return (await library()).filter((b) => words.every((w) => `${b.title} ${b.author}`.toLowerCase().includes(w)));
}

/** Playable details: the files, in order, played straight from the phone. */
export async function details(book) {
  const b = localCfg.get().books.find((x) => x.uid === book.uid) || book;
  // An ebook: nothing to play, the book page offers Read.
  if (b.kind === 'text') return { ...book, ...b, offline: true };
  if (!b.files?.length) throw new Error('This book is no longer in your folder — rescan in Library → On this phone → Folders & files');
  return {
    ...book,
    ...b,
    offline: true,
    tracks: b.files.map((f, i) => ({ title: f.name.replace(AUDIO, ''), url: f.uri, size: f.size, index: i })),
  };
}

/** Hook for cards: a phone book's cover as soon as it has been made. */
export function useLocalCover(book) {
  const cfg = useStore(localCfg);
  if (book?.source !== 'loc') return '';
  return cfg.books.find((b) => b.uid === book.uid)?.cover || '';
}

// ---- ebooks opened with / shared to Audiohub from other apps -----------------
// Android hands over the file; the app keeps its own copy (files/books) and lists it
// under Library → Ebooks → On this phone.
let openHandler = null;
/** What to do with a book that just arrived (app.jsx opens it in the reader). */
export const onIncoming = (fn) => (openHandler = fn);
function receive(f) {
  if (!f?.path) return f?.error && openHandler?.(null, f.error);
  const { author, title } = splitAuthor(cleanTitle(String(f.name || 'Book').replace(EBOOK, '')));
  const book = {
    uid: `loc:f-${hash(f.path)}#ebook`,
    source: 'loc',
    kind: 'text',
    title,
    author,
    cover: '',
    format: f.format,
    size: Number(f.size) || 0,
    ebookName: f.name,
    ebookFormat: f.format,
    ebookUrl: localUrl('file://' + f.path),
    path: f.path,
    imported: true,
    addedAt: Date.now(),
  };
  localCfg.set((c) => ({
    ...c,
    imported: [book, ...(c.imported || []).filter((b) => b.uid !== book.uid)],
    books: [book, ...(c.books || []).filter((b) => b.uid !== book.uid)],
  }));
  setTimeout(makeCovers, 1500);
  openHandler?.(book);
  return book;
}
if (available) {
  Native.addListener('incoming', receive);
  setTimeout(() => Native.incoming().then(receive).catch(() => {}), 800);
}

/** Pick EPUB / PDF files from the phone to add (Library → On this phone → Add files). */
export async function pickBooks(opts = {}) {
  if (!available) throw new Error('Adding ebook files works in the Android app');
  const r = await Native.pickBook();
  const list = (r?.books || []).filter((f) => f?.path);
  const keep = openHandler;
  openHandler = null; // several files: add them all, don't open each
  let added = [];
  try {
    added = list.map(receive).filter(Boolean);
  } finally {
    openHandler = keep;
  }
  return opts.books ? added : added.length;
}

/** Remove a book that was opened with / shared to Audiohub (its copy too). */
export async function removeImported(uid) {
  const b = (localCfg.get().imported || []).find((x) => x.uid === uid);
  if (!b) return false;
  await Native.removeIncoming({ path: b.path }).catch(() => {});
  localCfg.set((c) => ({ ...c, imported: (c.imported || []).filter((x) => x.uid !== uid), books: (c.books || []).filter((x) => x.uid !== uid) }));
  return true;
}
