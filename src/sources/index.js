import * as se from './standardebooks.js';
import * as ia from './archive.js';
import * as lv from './librivox.js';
import * as gb from './gutenberg.js';
import * as ol from './openlibrary.js';
import * as absSrc from './audiobookshelf.js';
import * as addonSrc from './addons.js';
import * as cloud from './debrid.js';
import * as localSrc from './local.js';
import * as hc from './hardcover.js';
import * as gr from './goodreads.js';
import * as pods from './podcasts.js';
import * as ttsb from './ttsbooks.js';
import { audible, googleBooks } from './catalogs.js';
import { settings } from '../lib/store.js';
import { matches, mainTitle, words, otherBook } from '../lib/match.js';
import { lookup, wantsMeta, fixFor, metaNow } from '../lib/meta.js';
import { applyLocal, isDownloaded } from '../lib/downloads.js';
import { translit, hasDevanagari } from '../lib/translit.js';

export const SOURCES = {
  ia: { name: 'Internet Archive', short: 'Archive', hue: 28, kind: 'Listen', blurb: 'LibriVox mirror, old-time radio & spoken word', impl: ia, hidden: true, free: true },
  lv: { name: 'LibriVox', short: 'LibriVox', hue: 350, kind: 'Listen', blurb: '20,000+ volunteer-read public-domain audiobooks', impl: lv, hidden: true, free: true },
  se: { name: 'Standard Ebooks', short: 'Standard Ebooks', hue: 205, kind: 'Read', blurb: 'Beautifully made free classics — read in-app or send to Kindle', impl: se, hidden: true, free: true },
  gb: { name: 'Project Gutenberg', short: 'Gutenberg', hue: 150, kind: 'Read', blurb: '75,000+ free classic ebooks, read in-app', impl: gb, hidden: true, free: true },
  ol: { name: 'Open Library', short: 'Open Library', hue: 210, kind: 'Discover', blurb: 'Trending books, rich descriptions & covers', impl: ol, hidden: true, free: true },
  au: { name: 'Audible catalog', short: 'Audible', hue: 32, kind: 'Discover', blurb: 'Audiobook listings with narrators, series & covers', impl: audible },
  gbk: { name: 'Google Books', short: 'Google Books', hue: 220, kind: 'Discover', blurb: 'Listings for almost every book in print', impl: googleBooks },
  loc: { name: 'On this phone', short: 'Phone', hue: 160, kind: 'Listen', blurb: 'Audiobook files already on your phone', impl: localSrc },
  abs: { name: 'Audiobookshelf', short: 'My Server', hue: 265, kind: 'Listen', blurb: 'Your self-hosted audiobook server', impl: absSrc },
  tb: { name: 'TorBox', short: 'TorBox', hue: 130, kind: 'Cloud', blurb: 'Stream audiobooks from your TorBox cloud', impl: cloud },
  rd: { name: 'Real-Debrid', short: 'Real-Debrid', hue: 45, kind: 'Cloud', blurb: 'Stream audiobooks from your Real-Debrid cloud', impl: cloud },
  addon: { name: 'Addons', short: 'Addon', hue: 185, kind: 'Listen', blurb: 'Community catalog addons', impl: addonSrc },
  hc: { name: 'Hardcover', short: 'Hardcover', hue: 255, kind: 'Shelves', blurb: 'Your reading shelves, synced both ways', impl: hc },
  pod: { name: 'Podcasts', short: 'Podcast', hue: 280, kind: 'Listen', blurb: 'Podcast episodes', impl: pods, hidden: true },
  tts: { name: 'Voice narration', short: 'Free voice', hue: 300, kind: 'Listen', blurb: 'Ebooks read aloud by a free voice', impl: ttsb, hidden: true },
  hi: { name: 'हिंदी (Hindi)', short: 'Hindi', hue: 25, kind: 'Listings', blurb: 'Hindi section: Audible India listings and free Hindi audio — few playable sources, so off by default', impl: audible },
  gr: { name: 'Goodreads', short: 'Goodreads', hue: 35, kind: 'Shelves', blurb: 'Shelves imported from your Goodreads export', impl: gr },
};

// Free public-domain catalogues (LibriVox, Internet Archive, Gutenberg, Standard Ebooks,
// Open Library) are switched off for good.
const enabled = (k) => !SOURCES[k]?.free && settings.get().sources[k === 'addon' ? 'addons' : k] !== false;

// Your own services first, then listings, then free catalogues — until the user rearranges them.
const DEFAULT_ORDER = ['loc', 'abs', 'tb', 'rd', 'hc', 'gr', 'addon', 'au', 'gbk', 'ia', 'lv', 'gb', 'se', 'ol', 'hi'];
/** Source keys in the user's chosen order (Settings → Sources). */
export function sourceOrder() {
  const saved = (settings.get().sourceOrder || []).filter((k) => SOURCES[k] && !SOURCES[k].hidden);
  const rest = DEFAULT_ORDER.filter((k) => !saved.includes(k) && !SOURCES[k]?.hidden);
  // Keep newly added sources near their default neighbours.
  for (const k of rest) {
    const i = DEFAULT_ORDER.indexOf(k);
    const after = DEFAULT_ORDER.slice(0, i).reverse().find((x) => saved.includes(x));
    saved.splice(after ? saved.indexOf(after) + 1 : 0, 0, k);
  }
  return saved;
}
export const sourceRank = (k) => {
  const i = sourceOrder().indexOf(k);
  return i < 0 ? 99 : i;
};

export function sourceOf(uid) {
  const p = uid.split(':')[0];
  return p === 'addon' ? 'addon' : p;
}

/**
 * Everything needed to show and play a book. `fast` (pressing play): don't wait for the
 * online details lookup — use what's already known, so playback starts sooner.
 */
export async function getDetails(book, { fast = false } = {}) {
  // A pasted link (direct MP3 / M4B…): the link is in its id, so Continue can reopen it.
  if ((book.uid || '').startsWith('url:') && book.kind !== 'text') {
    const url = decodeURIComponent(book.uid.slice(4));
    return applyLocal({ ...book, tracks: book.tracks?.length ? book.tracks : [{ title: book.title, url, index: 0 }] });
  }
  const src = SOURCES[sourceOf(book.uid || '')];
  // No source to ask (e.g. a direct ebook link): show what we already know.
  if (!src?.impl?.details) return applyLocal({ ...book });
  let d;
  let meta;
  try {
    [d, meta] = await Promise.all([src.impl.details(book), !wantsMeta(book) ? null : fast ? metaNow(book) : lookup(book).catch(() => null)]);
  } catch (e) {
    // Offline but downloaded: play from the phone anyway.
    if (isDownloaded(book.uid)) return applyLocal({ ...book, tracks: [] });
    throw e;
  }
  d = applyLocal(d);
  // Details you picked yourself win.
  const fix = fixFor(book.uid);
  if (fix)
    return {
      ...d,
      title: fix.title || d.title,
      author: fix.author || d.author,
      cover: fix.cover || d.cover || '',
      description: fix.description || d.description,
      narrator: d.narrator || fix.narrator || '',
      year: d.year || fix.year || '',
      genres: d.genres?.length ? d.genres : fix.genres || [],
      metaSource: fix.source,
      fixed: true,
    };
  if (!meta) return d;
  const cloudItem = d.source === 'tb' || d.source === 'rd';
  return {
    ...d,
    title: cloudItem && meta.title ? meta.title : d.title,
    author: (cloudItem && meta.author) || d.author || meta.author || '',
    cover: d.cover || meta.cover || '',
    description: d.description && !/audio files? in your/i.test(d.description) ? d.description : meta.description || d.description,
    narrator: d.narrator || meta.narrator || '',
    series: d.series || meta.series || '',
    year: d.year || meta.year || '',
    duration: d.duration || meta.runtime || 0,
    metaSource: meta.source,
  };
}

// Search every enabled source in parallel; results stream in per source.
export function searchAll(term, onResult) {
  const jobs = [
    ['abs', () => absSrc.search(term), absSrc.connected()],
    ['tb', () => cloud.search(term).then((r) => r.filter((b) => b.source === 'tb')), cloud.tbConnected()],
    ['rd', () => cloud.search(term).then((r) => r.filter((b) => b.source === 'rd')), cloud.rdConnected()],
    ['addon', () => addonSrc.search(term), true],
    ['ia', () => ia.search(term), true],
    ['lv', () => lv.search(term), true],
    ['gb', () => gb.search(term), true],
    ['se', () => se.search(term), true],
    // Hindi (Devanagari) searches go to Audible India, which carries the Hindi catalogue.
    ['au', () => (/[\u0900-\u097F]/.test(term) ? audible.hindi(term) : audible.search(term)), true],
    ['gbk', () => googleBooks.search(term), true],
    ['ol', () => ol.search(term), true],
  ].filter(([k, , ok]) => ok && enabled(k));
  return Promise.all(
    jobs.map(([k, fn]) =>
      fn()
        .then((items) => onResult(k, items, null))
        .catch((err) => onResult(k, [], err))
    )
  );
}

// Find listenable / readable copies of a book discovered elsewhere (Open Library,
// Hardcover, Goodreads) across every connected source.
export async function findEditions(book) {
  // Hindi titles are searched in Latin letters too ("गोदान" → "godan"): most sources list them that way.
  const t = mainTitle(hasDevanagari(book.title) ? translit(book.title) : book.title);
  const author = translit((book.author || '').split(',')[0].trim());
  const surname = author.split(' ').pop();
  const safe = (p) => p.catch(() => []);
  // A short title ("Civilization", "Dune") is in many other books' names too: then the
  // author has to match as well — or, for a copy with no author given, the title exactly.
  const tw = words(t);
  const sn = words(String(book.author || '').split(/,|&|\band\b/)[0]).slice(-1)[0] || '';
  const sameTitle = (b) => words(mainTitle(b.title || '')).join(' ') === tw.join(' ');
  const byTitle = (list) =>
    list.filter((b) => {
      if (!matches(t, `${b.title} ${b.rawName || ''}`)) return false;
      if (otherBook(b.rawName || b.title, t, book.author || '')) return false; // "The Greatest Secret" for "The Secret"
      if (tw.length >= 3 || !sn) return true;
      const text = words(`${b.author || ''} ${b.narrator || ''} ${b.title} ${b.rawName || ''}`);
      return text.includes(sn) || (!b.author && sameTitle(b));
    });
  const plain = t.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const [audio, text, server, cloudHits, addonHits, addonHits2] = await Promise.all([
    enabled('ia') ? safe(ia.query(`title:(${plain})${surname ? ` AND creator:(${surname})` : ''}`, { rows: 8 })) : [],
    enabled('gb') ? safe(gb.search(`${plain} ${surname}`.trim())) : [],
    enabled('abs') && absSrc.connected() ? safe(absSrc.search(plain)) : [],
    (enabled('tb') && cloud.tbConnected()) || (enabled('rd') && cloud.rdConnected()) ? safe(cloud.search(plain)) : [],
    enabled('addon') ? safe(addonSrc.search(plain)) : [],
    enabled('addon') && surname ? safe(addonSrc.search(`${plain} ${surname}`)) : [],
  ]);
  const seen = new Set();
  const addons = [...addonHits, ...addonHits2].filter((b) => !seen.has(b.uid) && seen.add(b.uid));
  return {
    server: byTitle(server),
    cloud: byTitle(cloudHits),
    addons: addons.slice(0, 12),
    audio,
    text: text.slice(0, 8),
    searched: [
      absSrc.connected() && enabled('abs') && 'your Audiobookshelf',
      cloud.tbConnected() && enabled('tb') && 'your TorBox files',
      cloud.rdConnected() && enabled('rd') && 'your Real-Debrid files',
      enabled('addon') && addonSrc.count() > 0 && `${addonSrc.count()} addon${addonSrc.count() > 1 ? 's' : ''}`,
      enabled('ia') && 'LibriVox/Internet Archive',
      enabled('gb') && 'Project Gutenberg',
    ].filter(Boolean),
  };
}

/**
 * Copies of a book you already have elsewhere (your Audiobookshelf, your TorBox /
 * Real-Debrid files) — for the book page's "Available" row. Only your own services
 * are searched, so it's quick.
 */
export async function findOwned(book) {
  const t = mainTitle(hasDevanagari(book.title) ? translit(book.title) : book.title);
  const plain = t.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!plain) return { server: [], cloud: [] };
  const safe = (p) => p.catch(() => []);
  // A short title ("Civilization", "Dune") is in many other books' names too: then the
  // author has to match as well — or, for a copy with no author given, the title exactly.
  const tw = words(t);
  const sn = words(String(book.author || '').split(/,|&|\band\b/)[0]).slice(-1)[0] || '';
  const sameTitle = (b) => words(mainTitle(b.title || '')).join(' ') === tw.join(' ');
  const byTitle = (list) =>
    list.filter((b) => {
      if (!matches(t, `${b.title} ${b.rawName || ''}`)) return false;
      if (otherBook(b.rawName || b.title, t, book.author || '')) return false; // "The Greatest Secret" for "The Secret"
      if (tw.length >= 3 || !sn) return true;
      const text = words(`${b.author || ''} ${b.narrator || ''} ${b.title} ${b.rawName || ''}`);
      return text.includes(sn) || (!b.author && sameTitle(b));
    });
  const [server, cloudHits] = await Promise.all([
    enabled('abs') && absSrc.connected() ? safe(absSrc.search(plain)) : [],
    (enabled('tb') && cloud.tbConnected()) || (enabled('rd') && cloud.rdConnected()) ? safe(cloud.search(plain)) : [],
  ]);
  return { server: byTitle(server), cloud: byTitle(cloudHits) };
}

export { ia, lv, gb, ol, absSrc, addonSrc, cloud, localSrc, hc, gr, enabled };
