// StoryShots: does it have a summary of this book? A list built weekly on GitHub
// (scripts/storyshots-index.mjs, published with the web app) holds every summary on
// their website and every episode of their free podcast. Covers get an "S": filled
// when the narrated audio is free (plays here), outline when it's in StoryShots
// (their written summary here, or their app with your subscription).
import { useEffect, useState } from 'preact/hooks';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { getJson, getText } from '../lib/http.js';
import { words, mainTitle } from '../lib/match.js';
import { stripHtml } from '../lib/format.js';
import { persisted } from '../lib/store.js';
import { openExternal } from './summaries.js';
import { parseFeed } from './podcasts.js';

// ---- the podcast: one feed, indexed once a week -------------------------------
export const SS_FEED = 'https://feeds.megaphone.fm/PARSIDA7641695618';
const feedIndex = persisted('storyshotsFeed', { t: 0, cover: '', eps: [] });
const FEED_FOR = 7 * 86400e3;

// "Atomic Habits by James Clear Book Summary and Review | Free Audiobook",
// "Chip War Summary | Chris Miller", "Contagious Summary in 15 minutes | Jonah Berger",
// "Kama Sutra - Book Summary |  Vatsyayana" -> { book, author }
export function episodeBook(title) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  let m = /^(.*?) by (.+?)(?:\s*[-|:]\s*|\s+)(?:Book )?Summary\b/i.exec(t);
  if (m) return { book: m[1], author: m[2] };
  m = /^(.*?)\s*(?:-\s*)?(?:Book )?Summary\b[^|]*\|\s*(.+)$/i.exec(t);
  if (m) return { book: m[1], author: m[2] };
  m = /^(.*?)\s*(?:-\s*)?(?:Book )?Summary\b/i.exec(t);
  return m ? { book: m[1], author: '' } : null;
}

// The weekly list, published next to the web app.
const INDEX_URL = 'https://drdilips1.github.io/bytewatch-stremio-addon/storyshots.json';
const siteIndex = persisted('storyshotsSite', { t: 0, list: [] }); // [{ b, a, u, id }]

let feedLoad = null;
let triedAt = 0;
/** The episode index: [{ b: book title words, a: author's last name, uid, title, url, duration, image }]. */
export function storyShotsEpisodes() {
  const have = feedIndex.get();
  const fresh = (x) => x.t && Date.now() - x.t < FEED_FOR;
  // Up to date, or tried within the hour: use what's kept.
  if ((have.eps.length && fresh(have) && siteIndex.get().list.length && fresh(siteIndex.get())) || Date.now() - triedAt < 3600e3) return feedLoad || Promise.resolve(have.eps);
  triedAt = Date.now();
  feedLoad ||= getJson(INDEX_URL + '?w=' + Math.floor(Date.now() / FEED_FOR), { timeout: 30000 })
    .then((ix) => {
      const eps = (ix.pod || [])
        .map(([book, author, url, duration, title, guid, image]) => ({ b: words(mainTitle(book)).join(' '), a: lastName(author), uid: 'ssp:' + (guid || url), title, url, duration, image }))
        .filter((e) => e.b);
      const list = (ix.site || []).map(([book, author, u, id]) => ({ b: words(mainTitle(book)).join(' '), a: lastName(author), u, id })).filter((e) => e.b);
      if (list.length) siteIndex.set({ t: Date.now(), list });
      if (!eps.length) throw new Error('no episodes in the list');
      feedIndex.set({ t: Date.now(), cover: ix.cover || '', eps });
      return eps;
    })
    // No list (offline, or not published yet): read the podcast feed itself.
    .catch(() =>
      getText(SS_FEED, { timeout: 60000, feed: true, headers: { Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.5' } }).then((xml) => {
        const { podcast, episodes } = parseFeed(xml, SS_FEED);
        const eps = episodes
          .map((e) => {
            const eb = episodeBook(e.title);
            return eb ? { b: words(mainTitle(eb.book)).join(' '), a: lastName(eb.author), uid: e.uid, title: e.title, url: e.url, duration: e.duration, image: e.image } : null;
          })
          .filter((e) => e && e.b);
        if (eps.length) feedIndex.set({ t: Date.now(), cover: podcast.cover, eps });
        return eps.length ? eps : have.eps;
      }),
    )
    .catch(() => have.eps)
    .finally(() => (feedLoad = null));
  return feedLoad;
}

/** StoryShots' website summary for a book, from the weekly list: its page, or ''. */
function matchSite(book) {
  const hit = matchEpisode(book, siteIndex.get().list);
  return hit ? { u: hit.u, api: hit.id ? `${SS}/wp-json/wp/v2/posts/${hit.id}` : '' } : null;
}

/** StoryShots' episode for a book, from an index. */
export function matchEpisode(book, eps) {
  const t = words(mainTitle(book?.title)).join(' ');
  if (!t) return null;
  const au = lastName(book.author);
  const same = eps.filter((e) => e.b === t);
  return same.find((e) => !au || !e.a || e.a === au) || null;
}

/** The episode as a playable podcast "book". */
export function storyShotsEpisodeBook(ep) {
  return {
    uid: ep.uid,
    source: 'pod',
    kind: 'audio',
    title: ep.title,
    author: 'StoryShots',
    cover: ep.image || feedIndex.get().cover || '',
    description: '',
    duration: ep.duration || 0,
    feedUrl: SS_FEED,
    tracks: [{ title: ep.title, url: ep.url, duration: ep.duration || 0, index: 0 }],
  };
}

const SS = 'https://www.getstoryshots.com';
const BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
  Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
};

/** Settings → Appearance: show the badge on covers. */
export const ssBadges = persisted('storyshotsBadges', true);

// title|author -> { u: summary page ('' = none), t: when checked }
const found = persisted('storyshotsFound', {});
const FOUND_FOR = 30 * 86400e3;
const MISSING_FOR = 7 * 86400e3;

const lastName = (a) => words(String(a || '').split(/,|&|\band\b/)[0]).slice(-1)[0] || '';
const keyFor = (b) => `${words(mainTitle(b?.title)).join(' ')}|${lastName(b?.author)}`;

// The post is this book's summary: every word of the title is in it, and it either
// starts with the title or names the author ("Educated" alone is too common a word).
function sameBook(book, postTitle) {
  const t = words(mainTitle(book.title));
  const p = words(postTitle);
  if (!t.length || !t.every((w) => p.includes(w))) return false;
  const starts = t.every((w, i) => p[i] === w);
  const au = lastName(book.author);
  return starts || (au && p.includes(au));
}

/** The summary page already known for a book: url, '' (none), or undefined (not checked yet). */
export function knownStoryShots(book) {
  const hit = found.get()[keyFor(book)];
  if (!hit || Date.now() - hit.t > (hit.u ? FOUND_FOR : MISSING_FOR)) return undefined;
  return hit.u;
}

// A few lookups at a time, so a Home screen full of covers doesn't flood their site.
const inflight = new Map();
const queue = [];
let running = 0;
function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => {
      running--;
      pump();
    });
  }
}

/** Look the book up on StoryShots: resolves to the summary page, '' when there's none, or null when unreachable. */
export function checkStoryShots(book) {
  const k = keyFor(book);
  if (!k.split('|')[0]) return Promise.resolve('');
  const known = knownStoryShots(book);
  if (known !== undefined) return Promise.resolve(known);
  if (!inflight.has(k)) {
    const p = new Promise((resolve) => {
      queue.push(async () => {
        try {
          const hits = await getJson(`${SS}/wp-json/wp/v2/search?` + new URLSearchParams({ search: mainTitle(book.title), per_page: '10' }), { timeout: 15000, headers: BROWSER });
          const hit = (Array.isArray(hits) ? hits : []).find((x) => String(x.url || '').startsWith(SS) && sameBook(book, stripHtml(x.title || '')));
          const u = hit ? hit.url : '';
          const a = hit?._links?.self?.[0]?.href || '';
          found.set((all) => {
            const next = { ...all, [k]: { u, a, t: Date.now() } };
            const keys = Object.keys(next);
            // Keep the newest 1500 lookups.
            if (keys.length > 1500) keys.sort((a, b) => next[a].t - next[b].t).slice(0, keys.length - 1500).forEach((x) => delete next[x]);
            return next;
          });
          resolve(u);
        } catch {
          resolve(null);
        } finally {
          inflight.delete(k);
        }
      });
      pump();
    });
    inflight.set(k, p);
  }
  return inflight.get(k);
}

/**
 * Hook: what StoryShots has for a book — { ep, url } (podcast episode and/or summary
 * page), or null. Covers use the podcast index only; the book page also asks the website.
 */
export function useStoryShots(book, { always = false } = {}) {
  const on = always || ssBadges.get();
  const skip = !book?.title || ['pod', 'sum', 'ss'].includes(book.source);
  const pick = () => {
    if (!on || skip) return null;
    const ep = matchEpisode(book, feedIndex.get().eps);
    const url = matchSite(book)?.u || (always ? knownStoryShots(book) || '' : '');
    return ep || url ? { ep, url } : null;
  };
  const [v, setV] = useState(pick);
  useEffect(() => {
    if (!on || skip) return setV(null);
    let alive = true;
    setV(pick());
    storyShotsEpisodes().then(() => alive && setV(pick()));
    // Book page: if the weekly list doesn't have it, ask their website directly.
    if (always && !matchSite(book) && knownStoryShots(book) === undefined) checkStoryShots(book).then(() => alive && setV(pick()));
    return () => {
      alive = false;
    };
  }, [book?.uid, book?.title, on]);
  return v;
}

// Their website is blocked on some networks: open their app instead (Play Store if
// it isn't installed). The web app can only link to the store.
const SS_APP = 'com.storyshots.android';
const WebPlugin = registerPlugin('InkwellWeb');
export async function openStoryShots() {
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb')) {
    try {
      return await WebPlugin.openApp({ package: SS_APP, name: 'StoryShots' });
    } catch {}
  }
  return openExternal(`https://play.google.com/store/apps/details?id=${SS_APP}`);
}

// ---- "Listen here": their written summary in the reader, read by our voices -----
let chooserSet = null;
/** Tap on an S: ask whether to listen here or open StoryShots. */
export const chooseStoryShots = (book, ss) => (chooserSet ? chooserSet({ book, ...ss }) : openStoryShots(ss?.url));
export const registerChooser = (fn) => (chooserSet = fn);

/** A reader "book" for a book's StoryShots summary. */
export function storyShotsBook(book, url) {
  const hit = found.get()[keyFor(book)] || {};
  const listed = matchSite(book);
  return {
    uid: 'ss:' + url,
    source: 'ss',
    kind: 'text',
    title: `${mainTitle(book.title)} · StoryShots summary`,
    author: book.author || '',
    cover: book.cover || '',
    link: url,
    api: listed?.u === url ? listed.api : hit.u === url ? hit.a || '' : '',
  };
}

/** Summary text for the in-app reader: { html, headings, title }. */
export async function loadStoryShots(book) {
  let title = book.title;
  let body = '';
  if (book.api) {
    try {
      const post = await getJson(book.api + (book.api.includes('?') ? '&' : '?') + '_fields=title,content', { timeout: 20000, headers: BROWSER });
      title = stripHtml(post?.title?.rendered || title);
      body = post?.content?.rendered || '';
    } catch {}
  }
  if (!body) {
    const page = new DOMParser().parseFromString(await getText(book.link, { timeout: 25000, headers: BROWSER }), 'text/html');
    const main = page.querySelector('.entry-content, article .content, article, main') || page.body;
    body = main.innerHTML;
    title = page.querySelector('h1')?.textContent?.trim() || title;
  }
  const doc = new DOMParser().parseFromString(body, 'text/html');
  doc.querySelectorAll('script,style,link,meta,iframe,object,embed,form,button,input,noscript,svg,figure,audio,video,.wp-block-buttons,.sharedaddy').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'style' || n === 'class' || n === 'id' || n.startsWith('data-')) el.removeAttribute(a.name);
      if ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
    if (el.tagName === 'A') el.setAttribute('target', '_blank');
    if (el.tagName === 'IMG') el.remove();
  });
  const h1 = doc.createElement('h1');
  h1.textContent = stripHtml(title || book.title);
  doc.body.prepend(h1);
  const headings = [...doc.body.querySelectorAll('h1,h2,h3')]
    .map((h, i) => {
      h.id ||= 'ss-h-' + i;
      return { id: h.id, text: h.textContent.replace(/\s+/g, ' ').trim(), level: +h.tagName[1] };
    })
    .filter((h) => h.text && h.text.length < 120);
  if (!doc.body.textContent.trim()) throw new Error('StoryShots returned an empty summary — open it in StoryShots instead');
  return { html: doc.body.innerHTML, headings, title: h1.textContent };
}
