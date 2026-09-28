// "Talk to a bookseller": natural-language requests answered by a free AI
// service, using what's in your library as taste, then matched to real Audible
// listings (so results have covers, narrators and lengths and open as normal
// book pages). Without AI (no key, or every service busy) it answers from the
// Audible catalogue: "listeners also enjoyed" and keyword matches.
import { aiReady, askAi, parseJson } from './ai.js';
import { library, progress, persisted } from './store.js';
import { audible, googleBooks } from '../sources/catalogs.js';
import { matches, mainTitle } from './match.js';
import { myRatings } from './taste.js';

const recCache = persisted('booksellerCache', {}); // key -> { t, v }

/** Books the listener has saved, is listening to, or finished — the taste profile. */
export function tasteProfile(limit = 40) {
  const seen = new Set();
  const out = [];
  const add = (b, note) => {
    if (!b?.title || typeof b.title !== 'string') return;
    const author = typeof b.author === 'string' ? b.author : Array.isArray(b.author) ? b.author.join(', ') : '';
    const k = mainTitle(b.title).toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(`${mainTitle(b.title)}${author ? ` — ${author.split(',')[0]}` : ''}${note ? ` (${note})` : ''}`);
  };
  // Your own verdicts first: the strongest signal of what you do and don't want.
  const NOTE = { love: 'loved it', like: 'liked it', ok: 'it was OK', dislike: 'disliked it', dnf: "didn't finish it" };
  const verdictNote = (r) => {
    const bits = [NOTE[r.verdict]];
    if (r.story) bits.push(`story ${r.story}`);
    if (r.narration) bits.push(`narration ${r.narration}`);
    if (r.reasons?.length) bits.push(`because: ${r.reasons.join(', ').toLowerCase()}`);
    return bits.filter(Boolean).join('; ');
  };
  Object.values(myRatings.get())
    .filter((r) => r?.verdict)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .forEach((r) => add(r, verdictNote(r)));
  const prog = Object.values(progress.get()).filter((p) => p?.book).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  prog.forEach((p) => add(p.book, p.finished ? 'finished' : 'listening'));
  Object.values(library.get())
    .filter(Boolean)
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
    .forEach((b) => add(b, 'saved'));
  return out.slice(0, limit);
}

const PROMPT = (request, taste, count) => `You are a warm, deeply read independent bookseller who specialises in audiobooks.
A customer asks: "${request}"

What they already own or have listened to (use this to understand their taste; do NOT recommend these):
${taste.length ? taste.map((t) => '- ' + t).join('\n') : '- (nothing yet)'}

Lean towards what they loved; steer clear of books like the ones they disliked or didn't finish (note their reasons), and of narrators whose narration they rated weak.
Recommend ${count} real, published books that best fit the request. Respect every constraint in the request (length, mood, genre, era, "like X", etc.). Audiobook length means the unabridged audiobook's runtime in hours (estimate if unsure). Prefer highly regarded, well-reviewed books. Mix well-known picks with a couple of lesser-known gems.

Reply as JSON only:
{"intro": "one or two friendly sentences, like a bookseller talking", "books": [{"title": "...", "author": "...", "why": "one sentence on why it fits this request", "hours": 10.5}]}`;

async function resolve(rec) {
  const q = `${mainTitle(rec.title)} ${rec.author || ''}`.trim();
  try {
    const hits = await audible.search(q);
    const hit = hits.find((b) => matches(mainTitle(rec.title), b.title)) || null;
    if (hit) return { ...hit, why: rec.why, aiHours: rec.hours };
  } catch {}
  try {
    const hits = await googleBooks.search(q);
    const hit = hits.find((b) => matches(mainTitle(rec.title), b.title));
    if (hit) return { ...hit, why: rec.why, aiHours: rec.hours };
  } catch {}
  return null;
}

const LENGTH = /(?:under|less than|shorter than|max(?:imum)?|up to|below)\s*(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i;

function ownedSet() {
  const t = new Set();
  for (const b of Object.values(library.get())) if (b?.title) t.add(mainTitle(b.title).toLowerCase());
  for (const p of Object.values(progress.get())) if (p?.book?.title) t.add(mainTitle(p.book.title).toLowerCase());
  return t;
}

/** Audible "listeners also enjoyed" for a book (by title/author), with the book it came from. */
async function alsoEnjoyed(book) {
  let asin = book.uid?.startsWith('au:') ? book.uid.slice(3) : '';
  let from = book;
  if (!asin) {
    const hits = await audible.search(`${mainTitle(book.title)} ${(book.author || '').split(',')[0]}`.trim()).catch(() => []);
    from = hits.find((b) => matches(mainTitle(book.title), b.title)) || hits[0];
    asin = from?.uid?.slice(3) || '';
  }
  if (!asin) return [];
  const list = await audible.related(asin).catch(() => []);
  return list.map((b) => ({ ...b, why: `Listeners of ${mainTitle(from.title)} also enjoyed this` }));
}

const STOP = new Set(
  'a an the and or but with for to of in on at by from me my i want some something book books audiobook audiobooks listen read good great like that feels feel similar about is are be really very please recommend give find any more less than under over hours hour hrs hr long short'.split(
    ' ',
  ),
);

/** No AI: answer from the catalogue so the bookseller never comes back empty-handed. */
async function catalogueAnswer(request) {
  const owned = ownedSet();
  let books = [];
  const like = /(?:like|similar to|in the vein of|fans? of|feels? like)\s+["“]?([^"”,.;!?]+?)["”]?(?:\s+(?:but|and|with|under|less|shorter|for)\b|[,.;!?]|$)/i.exec(request);
  if (like) books = await alsoEnjoyed({ title: like[1].trim() });
  if (books.length < 4) {
    const words = request
      .replace(LENGTH, ' ')
      .toLowerCase()
      .split(/[^a-z0-9'-]+/)
      .filter((w) => w.length > 2 && !STOP.has(w));
    if (words.length) books = [...books, ...(await audible.search(words.join(' ')).catch(() => []))];
  }
  if (books.length < 4) {
    // Fall back to what the listener has been enjoying lately.
    const recent = Object.values(progress.get()).filter((p) => p?.book).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]?.book;
    if (recent) books = [...books, ...(await alsoEnjoyed(recent))];
  }
  const seen = new Set();
  books = books.filter((b) => {
    const k = mainTitle(b.title || '').toLowerCase();
    if (!k || owned.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const max = LENGTH.exec(request);
  if (max) books = books.filter((b) => !b.duration || b.duration <= +max[1] * 3600 * 1.05);
  return books.slice(0, 8);
}

async function ask(request, { count = 8, cacheFor = 0 } = {}) {
  const taste = tasteProfile();
  const key = `${request}|${count}|${taste.slice(0, 20).join(';')}`;
  const hit = recCache.get()[key];
  if (cacheFor && hit && Date.now() - hit.t < cacheFor) return hit.v;
  let data;
  try {
    if (!aiReady()) throw new Error('');
    data = parseJson(await askAi(PROMPT(request, taste, count), { json: true }));
  } catch (e) {
    const books = await catalogueAnswer(request);
    const intro = aiReady() ? `${e.message.replace(/ — try again.*$/, '')}, so here are close matches from the Audible catalogue.` : 'Close matches from the Audible catalogue. Add a free AI key in Settings → AI for smarter, more personal picks.';
    return { intro, books, fallback: true }; // not cached, so the AI is asked again next time
  }
  const owned = new Set(taste.map((t) => t.split(' — ')[0].toLowerCase()));
  const recs = (data.books || []).filter((b) => b?.title && !owned.has(mainTitle(b.title).toLowerCase())).slice(0, count);
  let books = (await Promise.all(recs.map(resolve))).filter(Boolean);
  // Hold the AI to a stated length limit using the real audiobook runtime.
  const max = LENGTH.exec(request);
  if (max) books = books.filter((b) => !b.duration || b.duration <= +max[1] * 3600 * 1.05);
  const v = { intro: data.intro || '', books };
  if (cacheFor)
    recCache.set((c) => {
      const next = { ...c, [key]: { t: Date.now(), v } };
      const keys = Object.keys(next);
      if (keys.length > 30)
        keys
          .sort((a, b) => next[a].t - next[b].t)
          .slice(0, keys.length - 30)
          .forEach((k) => delete next[k]);
      return next;
    });
  return v;
}

/** Answer a natural-language request, e.g. "atmospheric sci-fi under 12 hours like Project Hail Mary". */
export const askBookseller = (request) => ask(request, { count: 8, cacheFor: 6 * 3600e3 });

/** Highly rated picks for this listener, for the Home banner (cached for a day). */
export async function picksForYou() {
  if (tasteProfile().length < 2) return [];
  if (aiReady()) {
    const r = await ask('Surprise me: the most acclaimed, highly rated books I would love next, based on my taste.', { count: 10, cacheFor: 24 * 3600e3 }).catch(() => null);
    if (r && !r.fallback && r.books.length) return r.books;
  }
  // No AI: "listeners also enjoyed" for the three most recent books, best rated first.
  const hit = recCache.get().__alsoLiked;
  if (hit && Date.now() - hit.t < 24 * 3600e3) return hit.v;
  const recent = Object.values(progress.get())
    .filter((p) => p?.book)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((p) => p.book)
    .filter(Boolean)
    .slice(0, 3);
  const owned = ownedSet();
  const seen = new Set();
  const v = (await Promise.all(recent.map(alsoEnjoyed)))
    .flat()
    .filter((b) => {
      const k = mainTitle(b.title || '').toLowerCase();
      if (!k || owned.has(k) || seen.has(k)) return false;
      seen.add(k);
      return (b.rating || 0) >= 4.3;
    })
    .sort((a, b) => (b.rating || 0) * Math.log10((b.ratings || 0) + 10) - (a.rating || 0) * Math.log10((a.ratings || 0) + 10))
    .slice(0, 10);
  if (v.length) recCache.set((c) => ({ ...c, __alsoLiked: { t: Date.now(), v } }));
  return v;
}

export { aiReady };
