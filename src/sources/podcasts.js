// Podcasts, in the spirit of AntennaPod: find shows (Apple Podcasts directory
// or any RSS feed / OPML), subscribe, see new episodes, keep an Up Next queue,
// and play through the app's own player (speed, sleep timer, resume, downloads).
import { getJson, getText, qs } from '../lib/http.js';
import { persisted, progress } from '../lib/store.js';
import { stripHtml } from '../lib/format.js';

// Synced: what you follow, your queue and what you've finished.
export const podcasts = persisted('podcasts', { subs: [], queue: [], played: {} });
// Per-show settings: feedUrl -> { speed, intro, outro } (seconds to skip).
export const showPrefs = persisted('podcastShowPrefs', {});
export const prefsFor = (feedUrl) => (feedUrl && showPrefs.get()[feedUrl]) || null;
export function setShowPref(feedUrl, patch) {
  showPrefs.set((all) => {
    const next = { ...(all[feedUrl] || {}), ...patch };
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    const out = { ...all, [feedUrl]: next };
    if (!Object.keys(next).length) delete out[feedUrl];
    return out;
  });
}
// Local cache of episode lists (refreshed from the feeds).
const feedsCache = persisted('podcastFeeds', {}, { delay: 2000 });
// Saved copies from before the size limit: trim once, so they fit in storage again.
try {
  const c = feedsCache.get();
  if (Object.values(c).some((f) => f?.episodes?.length > 120 || f?.episodes?.slice(20).some((e) => e.notes?.length > 301))) {
    const out = {};
    for (const [k, f] of Object.entries(c)) if (f?.episodes) out[k] = { ...f, episodes: f.episodes.slice(0, 120).map((e, i) => (i < 20 || !e.notes || e.notes.length <= 300 ? e : { ...e, notes: e.notes.slice(0, 300) + '…' })) };
    feedsCache.set(out);
  }
} catch {}

// Podcast art is often a huge original (1–3 MB, up to 3000 px): lists load a small copy.
// Apple's art comes in any size; other hosts go through a free resizing service, and
// the original is used if that fails.
export function thumbUrl(url, size = 200) {
  if (!url || !/^https?:\/\//i.test(url)) return url || '';
  if (/mzstatic\.com/.test(url)) return url.replace(/\/\d+x\d+[a-z]*\.(jpg|jpeg|png|webp)(\?.*)?$/i, `/${size}x${size}bb.jpg`);
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${size}&h=${size}&fit=cover&output=jpg&q=78`;
}
// ---------------------------------------------------------------- directory
const fromItunes = (r) => ({
  feedUrl: r.feedUrl,
  title: r.collectionName || r.trackName,
  author: r.artistName || '',
  cover: (r.artworkUrl600 || r.artworkUrl100 || '').replace(/^http:/, 'https:'),
  genre: r.primaryGenreName || '',
});

export async function search(term) {
  if (!term.trim()) return [];
  const d = await getJson('https://itunes.apple.com/search?' + qs({ media: 'podcast', entity: 'podcast', term, limit: 30 }), { timeout: 15000 });
  return (d.results || []).filter((r) => r.feedUrl).map(fromItunes);
}

/** Apple's top podcasts (country from the device language, US as fallback). */
export async function top(country = (navigator.language || 'en-US').split('-')[1]?.toLowerCase() || 'us') {
  const load = async (cc) => {
    const d = await getJson(`https://rss.applemarketingtools.com/api/v2/${cc}/podcasts/top/25/podcasts.json`, { timeout: 15000 });
    const ids = (d.feed?.results || []).map((r) => r.id);
    if (!ids.length) return [];
    const l = await getJson('https://itunes.apple.com/lookup?' + qs({ id: ids.join(','), entity: 'podcast' }), { timeout: 15000 });
    return (l.results || []).filter((r) => r.feedUrl).map(fromItunes);
  };
  try {
    const r = await load(country);
    if (r.length) return r;
  } catch {}
  return load('us');
}

// ---------------------------------------------------------------- feeds
const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
const txt = (el, sel) => el.querySelector(sel)?.textContent?.trim() || '';
const byTag = (el, tag) => [...el.children].find((c) => c.tagName.toLowerCase() === tag.toLowerCase());

function seconds(v) {
  if (!v) return 0;
  if (/^\d+$/.test(v)) return +v;
  return v.split(':').reduce((a, n) => a * 60 + (+n || 0), 0);
}

/** Parse an RSS / Atom podcast feed. */
export function parseFeed(xml, feedUrl) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error("That address isn't a podcast feed");
  const ch = doc.querySelector('channel') || doc.querySelector('feed');
  if (!ch) throw new Error("That address isn't a podcast feed");
  const itunesImage = [...ch.children].find((c) => c.tagName === 'itunes:image')?.getAttribute('href');
  const cover = (itunesImage || txt(ch, 'image > url') || '').replace(/^http:/, 'https:');
  const podcast = {
    feedUrl,
    title: byTag(ch, 'title')?.textContent?.trim() || 'Podcast',
    author: [...ch.children].find((c) => c.tagName === 'itunes:author')?.textContent?.trim() || '',
    cover,
    description: stripHtml(byTag(ch, 'description')?.textContent || [...ch.children].find((c) => c.tagName === 'itunes:summary')?.textContent || ''),
    link: byTag(ch, 'link')?.textContent?.trim() || '',
  };
  const items = [...doc.querySelectorAll('item, entry')];
  const episodes = items
    .map((it) => {
      const enc = it.querySelector('enclosure');
      const url = enc?.getAttribute('url') || [...it.querySelectorAll('link')].find((l) => /audio|video/.test(l.getAttribute('type') || ''))?.getAttribute('href') || '';
      if (!url) return null;
      const guid = txt(it, 'guid') || url;
      const img = [...it.children].find((c) => c.tagName === 'itunes:image')?.getAttribute('href');
      const dur = [...it.children].find((c) => c.tagName === 'itunes:duration')?.textContent?.trim();
      const notes = [...it.children].find((c) => c.tagName === 'content:encoded')?.textContent || txt(it, 'description') || [...it.children].find((c) => c.tagName === 'itunes:summary')?.textContent || '';
      // Podcasting 2.0: the publisher's own transcript and chapters.
      const kids = [...it.children];
      const rank = (t) => (/json/.test(t) ? 0 : /vtt/.test(t) ? 1 : /srt|subrip/.test(t) ? 2 : /html/.test(t) ? 3 : 4);
      const tr = kids
        .filter((c) => c.tagName === 'podcast:transcript' && c.getAttribute('url'))
        .map((c) => ({ url: c.getAttribute('url'), type: (c.getAttribute('type') || '').toLowerCase() }))
        .sort((a, b) => rank(a.type) - rank(b.type))[0];
      const chaptersUrl = kids.find((c) => c.tagName === 'podcast:chapters')?.getAttribute('url') || '';
      return {
        uid: 'pe:' + hash(feedUrl + '|' + guid),
        feedUrl,
        title: txt(it, 'title') || 'Episode',
        url: url.replace(/^http:/, 'https:'),
        type: enc?.getAttribute('type') || '',
        size: +(enc?.getAttribute('length') || 0),
        date: Date.parse(txt(it, 'pubDate') || txt(it, 'published') || txt(it, 'updated')) || 0,
        duration: seconds(dur),
        image: (img || '').replace(/^http:/, 'https:'),
        notes: stripHtml(notes).slice(0, 4000),
        ...(tr ? { transcript: { url: tr.url.replace(/^http:/, 'https:'), type: tr.type } } : {}),
        ...(chaptersUrl ? { chaptersUrl: chaptersUrl.replace(/^http:/, 'https:') } : {}),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.date - a.date);
  return { podcast, episodes };
}

export async function loadFeed(feedUrl, { fresh = false } = {}) {
  const cached = feedsCache.get()[feedUrl];
  if (!fresh && cached && Date.now() - cached.t < 30 * 60e3) return cached;
  const xml = await getText(feedUrl, { timeout: 30000, feed: true, headers: { Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.5' } });
  const { podcast, episodes } = parseFeed(xml, feedUrl);
  // Keep the saved copy small (phone storage is limited to a few MB for everything):
  // full show notes for the newest episodes, a short preview for older ones.
  const entry = { t: Date.now(), podcast, episodes: episodes.slice(0, 120).map((e, i) => (i < 20 || !e.notes || e.notes.length <= 300 ? e : { ...e, notes: e.notes.slice(0, 300) + '…' })) };
  feedsCache.set((c) => ({ ...c, [feedUrl]: entry }));
  return entry;
}

// ---------------------------------------------------------------- subscriptions
export const isSubscribed = (feedUrl) => podcasts.get().subs.some((s) => s.feedUrl === feedUrl);

export async function subscribe(input) {
  const feedUrl = typeof input === 'string' ? input.trim() : input.feedUrl;
  if (!/^https?:\/\//i.test(feedUrl)) throw new Error('Paste a podcast feed address (https://…)');
  const { podcast } = await loadFeed(feedUrl, { fresh: true });
  // Keep Apple's artwork when following from search: it comes in small sizes (the feed's own is often huge).
  const cover = (typeof input === 'object' && input.cover) || podcast.cover;
  podcasts.set((p) => ({ ...p, subs: [...p.subs.filter((s) => s.feedUrl !== feedUrl), { ...podcast, cover, addedAt: Date.now() }] }));
  return podcast.title;
}

export function unsubscribe(feedUrl) {
  podcasts.set((p) => ({ ...p, subs: p.subs.filter((s) => s.feedUrl !== feedUrl), queue: p.queue.filter((q) => q.feedUrl !== feedUrl) }));
}

const newest = (feeds) => {
  const out = [];
  for (const f of feeds) if (f) out.push(...f.episodes.slice(0, 15).map((e) => ({ ...e, podcast: f.podcast })));
  return out.sort((a, b) => b.date - a.date);
};

/** The newest episodes from the saved feeds, without going online (instant). */
export const cachedLatest = () => newest(podcasts.get().subs.map((s) => feedsCache.get()[s.feedUrl]));

/** Refresh every subscription (six at a time); resolves the newest episodes across them. */
export async function refreshAll({ fresh = false } = {}) {
  const subs = podcasts.get().subs;
  const feeds = new Array(subs.length);
  let next = 0;
  const worker = async () => {
    while (next < subs.length) {
      const i = next++;
      feeds[i] = await loadFeed(subs[i].feedUrl, { fresh }).catch(() => feedsCache.get()[subs[i].feedUrl] || null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, subs.length) }, worker));
  return newest(feeds);
}

// ---------------------------------------------------------------- episodes
export const isPlayed = (ep) => !!podcasts.get().played[ep.uid] || !!progress.get()[ep.uid]?.finished;

export function markPlayed(ep, on = true) {
  podcasts.set((p) => {
    const played = { ...p.played };
    if (on) played[ep.uid] = Date.now();
    else delete played[ep.uid];
    // Keep the synced list small.
    const keys = Object.keys(played);
    if (keys.length > 3000) keys.sort((a, b) => played[a] - played[b]).slice(0, keys.length - 3000).forEach((k) => delete played[k]);
    return { ...p, played, queue: on ? p.queue.filter((q) => q.uid !== ep.uid) : p.queue };
  });
}

const slim = (ep, podcast) => ({ uid: ep.uid, feedUrl: ep.feedUrl, title: ep.title, url: ep.url, duration: ep.duration, date: ep.date, image: ep.image || podcast?.cover || '', show: podcast?.title || ep.show || '' });

export function enqueue(ep, podcast, { next = false } = {}) {
  podcasts.set((p) => {
    const rest = p.queue.filter((q) => q.uid !== ep.uid);
    return { ...p, queue: next ? [slim(ep, podcast), ...rest] : [...rest, slim(ep, podcast)] };
  });
}
export const dequeue = (uid) => podcasts.set((p) => ({ ...p, queue: p.queue.filter((q) => q.uid !== uid) }));
export const inQueue = (uid) => podcasts.get().queue.some((q) => q.uid === uid);

/** An episode as a playable "book" for the player (and downloads). */
export function asBook(ep, podcast) {
  const show = podcast?.title || ep.show || ep.podcast?.title || 'Podcast';
  return {
    uid: ep.uid,
    source: 'pod',
    kind: 'audio',
    title: ep.title,
    author: show,
    cover: thumbUrl(ep.image || podcast?.cover || ep.podcast?.cover || '', 600),
    description: ep.notes || '',
    duration: ep.duration || 0,
    feedUrl: ep.feedUrl,
    ...(ep.transcript ? { transcript: ep.transcript } : {}),
    ...(ep.chaptersUrl ? { chaptersUrl: ep.chaptersUrl } : {}),
    tracks: [{ title: ep.title, url: ep.url, duration: ep.duration || 0, index: 0 }],
  };
}

/** The publisher's chapters (Podcasting 2.0 JSON): [{ title, start, end }] in seconds (tapping one seeks there). */
export async function loadChapters(url, duration = 0) {
  const j = await getJson(url, { timeout: 15000 });
  const list = (Array.isArray(j?.chapters) ? j.chapters : [])
    .filter((c) => c && typeof c.startTime === 'number' && c.toc !== false)
    .sort((a, b) => a.startTime - b.startTime);
  return list.map((c, i) => ({
    title: String(c.title || `Chapter ${i + 1}`),
    start: c.startTime,
    end: list[i + 1]?.startTime ?? (c.endTime || duration || c.startTime),
  }));
}
export const details = async (book) => book;

// ---------------------------------------------------------------- OPML
export function exportOpml() {
  const esc = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  const body = podcasts
    .get()
    .subs.map((s) => `    <outline type="rss" text="${esc(s.title)}" title="${esc(s.title)}" xmlUrl="${esc(s.feedUrl)}"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Audiohub podcasts</title></head>\n  <body>\n${body}\n  </body>\n</opml>\n`;
}

export async function importOpml(text, onProgress) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const urls = [...doc.querySelectorAll('outline[xmlUrl], outline[xmlurl]')].map((o) => o.getAttribute('xmlUrl') || o.getAttribute('xmlurl')).filter(Boolean);
  if (!urls.length) throw new Error('No podcasts found in that OPML file');
  let ok = 0;
  for (const [i, u] of urls.entries()) {
    try {
      if (!isSubscribed(u)) await subscribe(u);
      ok++;
    } catch {}
    onProgress?.(i + 1, urls.length);
  }
  return `${ok} of ${urls.length} podcasts added`;
}

// When an episode finishes: mark it played and continue with Up Next.
import * as player from '../lib/player.js';

// Per-show speed / intro / outro, applied by the player.
player.setShowPrefsSource(
  (book) => (book?.source === 'pod' ? prefsFor(book.feedUrl) : null),
  (book, patch) => setShowPref(book.feedUrl, patch),
);

// Episodes with the publisher's chapters: fetch them once the episode is playing.
let chaptersFor = '';
player.subscribe((ps) => {
  const b = ps.book;
  if (!b?.chaptersUrl || b.chaptersMeta || chaptersFor === b.uid) return;
  chaptersFor = b.uid;
  loadChapters(b.chaptersUrl, b.duration || ps.duration)
    .then((list) => list.length > 1 && player.patchBook(b.uid, { chaptersMeta: list }))
    .catch(() => {});
});
player.onFinished((book) => {
  if (book?.source !== 'pod') return;
  markPlayed({ uid: book.uid });
  const next = podcasts.get().queue.find((q) => q.uid !== book.uid);
  if (next) player.playBook(asBook(next));
});

// ---------------------------------------------------------------- your taste in episodes
// 👍 / 👎 and "Not interested" per episode (uid -> 1 | -1 | 'no'). Not interested hides it.
export const episodeVotes = persisted('episodeVotes', {});
export function voteEpisode(ep, v) {
  episodeVotes.set((all) => {
    const next = { ...all };
    if (v == null || next[ep.uid] === v) delete next[ep.uid];
    else next[ep.uid] = v;
    return next;
  });
}
export const isHidden = (ep) => episodeVotes.get()[ep.uid] === 'no';

const words = (t) => String(t || '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [];
/**
 * Recommended episodes: unplayed new ones, from shows you like and finish, about what the
 * episodes you liked were about; shows and topics you said no to count against.
 */
export function recommendedEpisodes(latest, prog = progress.get()) {
  const votes = episodeVotes.get();
  const known = new Map(); // uid -> episode (to read titles of ones you voted on)
  for (const e of latest || []) known.set(e.uid, e);
  for (const q of podcasts.get().queue) known.set(q.uid, q);
  const show = new Map();
  const liked = new Map();
  const bump = (m, k, n) => k && m.set(k, (m.get(k) || 0) + n);
  for (const [uid, v] of Object.entries(votes)) {
    const e = known.get(uid);
    const n = v === 1 ? 2 : v === -1 ? -2 : -1;
    bump(show, e?.feedUrl, n);
    for (const w of words(e?.title)) bump(liked, w, n > 0 ? 1 : -0.5);
  }
  // Episodes you finished say you like the show.
  for (const p of Object.values(prog || {})) if (p?.finished && p.book?.source === 'pod') bump(show, p.book.feedUrl, 0.5);
  return (latest || [])
    .filter((e) => !isPlayed(e) && !votes[e.uid])
    .map((e) => ({ e, s: (show.get(e.feedUrl) || 0) + words(e.title).reduce((a, w) => a + (liked.get(w) || 0), 0) + (Date.now() - e.date < 7 * 864e5 ? 0.5 : 0) }))
    .filter((x) => x.s > 0.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map((x) => x.e);
}
