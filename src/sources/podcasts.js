// Podcasts, in the spirit of AntennaPod: find shows (Apple Podcasts directory
// or any RSS feed / OPML), subscribe, see new episodes, keep an Up Next queue,
// and play through the app's own player (speed, sleep timer, resume, downloads).
import { getJson, getText, qs } from '../lib/http.js';
import { persisted, progress } from '../lib/store.js';
import { stripHtml } from '../lib/format.js';

// Synced: what you follow, your queue and what you've finished.
export const podcasts = persisted('podcasts', { subs: [], queue: [], played: {} });
// Local cache of episode lists (refreshed from the feeds).
const feedsCache = persisted('podcastFeeds', {});

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
  const entry = { t: Date.now(), podcast, episodes: episodes.slice(0, 150) };
  feedsCache.set((c) => ({ ...c, [feedUrl]: entry }));
  return entry;
}

// ---------------------------------------------------------------- subscriptions
export const isSubscribed = (feedUrl) => podcasts.get().subs.some((s) => s.feedUrl === feedUrl);

export async function subscribe(input) {
  const feedUrl = typeof input === 'string' ? input.trim() : input.feedUrl;
  if (!/^https?:\/\//i.test(feedUrl)) throw new Error('Paste a podcast feed address (https://…)');
  const { podcast } = await loadFeed(feedUrl, { fresh: true });
  podcasts.set((p) => ({ ...p, subs: [...p.subs.filter((s) => s.feedUrl !== feedUrl), { ...podcast, addedAt: Date.now() }] }));
  return podcast.title;
}

export function unsubscribe(feedUrl) {
  podcasts.set((p) => ({ ...p, subs: p.subs.filter((s) => s.feedUrl !== feedUrl), queue: p.queue.filter((q) => q.feedUrl !== feedUrl) }));
}

/** Refresh every subscription (a few at a time); resolves the newest episodes across them. */
export async function refreshAll({ fresh = false } = {}) {
  const subs = podcasts.get().subs;
  const out = [];
  for (let i = 0; i < subs.length; i += 4) {
    const batch = await Promise.all(subs.slice(i, i + 4).map((s) => loadFeed(s.feedUrl, { fresh }).catch(() => feedsCache.get()[s.feedUrl] || null)));
    for (const f of batch) if (f) out.push(...f.episodes.slice(0, 15).map((e) => ({ ...e, podcast: f.podcast })));
  }
  return out.sort((a, b) => b.date - a.date);
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
    cover: ep.image || podcast?.cover || ep.podcast?.cover || '',
    description: ep.notes || '',
    duration: ep.duration || 0,
    feedUrl: ep.feedUrl,
    tracks: [{ title: ep.title, url: ep.url, duration: ep.duration || 0, index: 0 }],
  };
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
player.onFinished((book) => {
  if (book?.source !== 'pod') return;
  markPlayed({ uid: book.uid });
  const next = podcasts.get().queue.find((q) => q.uid !== book.uid);
  if (next) player.playBook(asBook(next));
});
