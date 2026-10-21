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
  localCfg.set((c) => ({ ...c, books, scannedAt: Date.now() }));
  if (errors.length && !books.length) throw new Error(errors.join(' · '));
  makeCovers();
  return books;
}

// Covers: the folder's cover image, else the art inside the first audio file —
// made one book at a time in the background (books without either get a cover
// from the online lookup, like other books).
let coversRunning = false;
async function makeCovers() {
  if (coversRunning) return;
  coversRunning = true;
  try {
    for (const b of localCfg.get().books) {
      if (b.cover || b.noCover) continue;
      let path = '';
      try {
        ({ path } = await Native.cover({ key: b.uid.replace(':', '_'), image: b.coverImage || '', audio: b.files?.[0]?.uri || '' }));
      } catch {}
      const cover = path ? Capacitor.convertFileSrc(path) : '';
      localCfg.set((c) => ({ ...c, books: c.books.map((x) => (x.uid === b.uid ? { ...x, cover, noCover: !cover } : x)) }));
    }
  } finally {
    coversRunning = false;
  }
}
if (available) setTimeout(makeCovers, 4000); // books scanned before covers existed

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
  if (!b.files?.length) throw new Error('This book is no longer in your folder — rescan in Library → On this phone → Folders');
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
