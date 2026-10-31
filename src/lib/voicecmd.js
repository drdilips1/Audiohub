// Voice command: "play when Harry first boards the Hogwarts Express". Your AI service
// works out the book and where the scene is (which chapter, how far in, a line from it);
// the book is found on your phone, in your downloads, books you've played, then your
// Audiobookshelf and TorBox / Real-Debrid; it starts 30 seconds before the scene.
import { askAi, parseJson } from './ai.js';
import { mainTitle, matches, words } from './match.js';
import { progress, settings } from './store.js';
import { downloads } from './downloads.js';
import { localCfg } from '../sources/local.js';
import { getDetails, findOwned } from '../sources/index.js';
import { heardLines } from './transcript.js';
import * as player from './player.js';
import { findOrder, placeOf } from './findorder.js';
import { STOPWORDS } from './scenefind.js';

const LEAD = 30; // seconds before the scene
const NOISE = new Set(['unabridged', 'abridged', 'audiobook', 'audio', 'book', 'a', 'novel', 'edition', 'mp3', 'm4b', 'by', 'read', 'narrated', 'the', 'and']);
const surname = (a) => String(a || '').split(',')[0].trim().split(/\s+/).pop()?.toLowerCase() || '';
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/** What was asked for: { title, author, scene, chapter, chapterTitle, at, quote } (title '' if not a book request). */
async function understand(said) {
  const now = player.getState().book;
  const playing =
    now && now.source !== 'pod'
      ? `\nThey are listening to "${now.title}"${now.author ? ` by ${now.author}` : ''}. Only when they describe a moment and name no book do they mean this one. If their words are, or sound like, a book's title ("12 rules of life" = "12 Rules for Life" by Jordan Peterson), it is that book, whatever is playing.`
      : '';
  const raw = await askAi(
    `Someone said to their audiobook app: "${said}"${playing}
It comes from speech recognition, so it may be misheard: Indian-accented English, Hindi or Hinglish, names written as they sounded ("dumble door" = Dumbledore, "harry potter ki pehli train" = Harry boarding the Hogwarts Express). Work out what they meant.
Work out which book they mean and where in it the moment they describe happens. The JSON is always in English, with names spelled as in the book.
First decide the action: "scene" (play a moment of a book), "play_book" (play a book itself), "find" (find or recommend books — "find a book on consciousness", "something short and funny"), "question" (they ask about a book or books — what, why, explain, summarise, "what are the 12 rules in 12 Rules for Life" — instead of asking to play; title: the book it's about, "" if it's about books in general), or a control of what's playing: "pause", "resume", "rewind", "forward" (with "seconds"), "next_chapter", "previous_chapter", "go_chapter" (with "chapter"), "speed" (with "speed", e.g. 1.25), "sleep" (with "minutes", or 0 to cancel, -1 for the end of the chapter), "bookmark"; else "unknown". "Play <a title>" is always "play_book" (even while another book is playing or paused); "resume" / "pause" only when no book is named. Questions (what, why, who, explain, summarise, the meaning of…) are always "question", never a control.
Return JSON: {"action":"scene","seconds":0,"speed":0,"minutes":0,"title":"the book's title","book":"","author":"","moment":true,"wholeChapter":false,"scene":"the moment, in under 12 words","chapter":0,"chapterTitle":"","at":0.0,"quote":"","keywords":[""]}
- wholeChapter: true when they ask for the chapter a moment is in ("play the chapter where Harry finds the mirror"), not the moment itself.
- moment: false when they only ask to play the book itself ("play The Secret by Rhonda Byrne") — then leave scene, chapter, quote and keywords empty.
- title: the single book the moment is in (in a series, that volume: "Harry Potter and the Philosopher's Stone", not "Harry Potter"); book: the same title as printed in the UK edition, if different.
- chapter: the chapter number in that book (0 if it's in a prologue or you don't know).
- chapterTitle: that chapter's title, if it has one.
- at: how far into that chapter the moment starts, from 0.0 (its start) to 1.0 (its end).
- quote: 6–12 words of the book's own text from the start of that moment, only if you're sure of them, else "".
- keywords: 6–10 words that appear in the book's own text right at that moment and rarely elsewhere — names, places, objects, unusual words (for "Dumbledore awards the House Cup": "Dumbledore", "House Cup", "points", "Neville", "Slytherin", "decorations"). Prefer the details that set this moment apart from similar ones elsewhere in the book (for "Hagrid tells who gave him the egg": "Hog's Head", "stranger", "hood", "cards", "Fluffy" — not just "dragon" and "egg"). Not common words.
- chapter: be careful — if the same subject comes up in more than one chapter, give the chapter of this exact moment.
For a control, only "action" and its number matter. If they don't name or describe a book you can identify, and it isn't a control, return {"action":"unknown","title":""}.`,
    { json: true }
  );
  return parseJson(raw);
}

/**
 * Your own copies of the book, in the order set in Settings (by default: TorBox / Real-Debrid
 * — your default one first — then the phone, Audiobookshelf, anything else you've played).
 * The book playing now always comes first (nothing to reopen).
 */
async function findCopies(want, onHand = false) {
  const t = mainTitle(want.title || '');
  const sn = surname(want.author);
  const audio = (b) => b && b.kind !== 'text' && !String(b.uid || '').endsWith('#ebook') && (!sn || !b.author || String(b.author).toLowerCase().includes(sn));
  // The book's own title: "The Secret" is not "The Secret History" — extra words are allowed
  // only when they're the author's name, a year or the usual noise ("Unabridged").
  const authorWords = new Set(words(want.author));
  const fits = (title) => {
    if (!title || !matches(t, title)) return false;
    const mine = new Set(words(t));
    return words(mainTitle(title)).every((w) => mine.has(w) || authorWords.has(w) || NOISE.has(w) || /^\d+$/.test(w));
  };
  const same = (b) => fits(b.title) || (!b.title && fits(b.rawName));
  // The whole series in one audiobook ("Harry Potter (Pottermore)" for "Harry Potter and the
  // Philosopher's Stone"): it has the book too, tried after copies of the book itself.
  const series = (b) => !!mainTitle(b.title || '') && matches(mainTitle(b.title || ''), t);
  const out = [];
  const add = (b, local = false) => audio(b) && (same(b) || series(b)) && !out.some((x) => x.b.uid === b.uid) && out.push({ b, local, loose: !same(b) });
  add(player.getState().book);
  for (const b of localCfg.get().books || []) add(b, true);
  for (const d of Object.values(downloads.get() || {})) if (d?.status === 'done') add(d.book, true);
  for (const p of Object.values(progress.get() || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) add(p.book);
  // On the phone, downloaded or played before: no need to search your services (slow) first.
  if (!onHand && !out.some((x) => !x.loose)) {
    try {
      const owned = await findOwned({ title: want.title, author: want.author || '' });
      for (const b of [...owned.cloud, ...owned.server]) add(b);
    } catch {}
  }
  const first = settings.get().debridPreferred === 'realdebrid' ? 'rd' : 'tb';
  const src = (b) => String(b.source || b.uid || '').split(':')[0];
  const order = findOrder('audio');
  const rank = ({ b, local, loose }) => {
    if (b.uid === player.getState().book?.uid) return -1;
    const place = placeOf(b, local);
    // Within TorBox / Real-Debrid: your default one first.
    return (loose ? 100 : 0) + order.indexOf(place) * 2 + (place === 'debrid' && src(b) !== first ? 1 : 0);
  };
  return out.sort((x, y) => rank(x) - rank(y)).map((x) => x.b);
}

/** Play the best audiobook torrent for this book from your source addons, or null. */
async function fromSources(want, step) {
  const cloud = await import('../sources/debrid.js');
  const provider = cloud.preferredProvider(settings.get().debridPreferred);
  if (!provider) return null;
  const { searchSources } = await import('../sources/sourceaddons.js');
  step(`Searching your sources for ${want.title}…`);
  const found = new Map();
  await Promise.race([
    searchSources({ title: want.title, author: want.author || '' }, (name, list) => found.set(name, list || [])),
    new Promise((r) => setTimeout(r, 25000)),
  ]);
  const ebookish = /\b(epub|pdf|mobi|azw3?|ebook)\b/i;
  const list = [...found.values()]
    .flat()
    .filter((r) => r && !r.loose && (r.magnet || r.hash) && r.contentType !== 'ebook' && !ebookish.test(`${r.title} ${r.format || ''}`));
  if (!list.length) return null;
  const ready = (r) => (provider === 'torbox' ? r.cache?.torbox : r.cache?.realdebrid) || false;
  list.sort((x, y) => Number(ready(y)) - Number(ready(x)) || (y.seeders || 0) - (x.seeders || 0));
  for (const r of list.slice(0, 3)) {
    try {
      step(`Getting ${want.title} from your ${provider === 'torbox' ? 'TorBox' : 'Real-Debrid'}…`);
      const stub = await cloud.prepareMagnet(provider, r, (text) => step(text));
      const details = await getDetails({ ...stub, title: want.title, author: want.author || r.author || stub.author });
      if (!details?.tracks?.length && !details?.resolveTracks) continue;
      player.playBook(details, { autoplay: true });
      if (await loaded(false)) return details;
    } catch (e) {
      if (e.pending) throw Object.assign(new Error(`${want.title} is downloading in your ${provider === 'torbox' ? 'TorBox' : 'Real-Debrid'} — play it from Search when it's ready`), { want });
    }
  }
  return null;
}

/** Asked for the chapter a moment is in, not the moment ("play the chapter where …")? */
const wholeChapter = (said, want) => want?.wholeChapter === true || /\b(the |that |which )?chapter (where|when|in which|that|with|jisme|jismein|jab)\b/i.test(said || '');

/** The chapter the AI named, in this audiobook's own chapter list. */
function pickChapter(chapters, want) {
  if (!chapters.length) return -1;
  const n = Number(want.chapter) || 0;
  const tt = norm(want.chapterTitle).filter((w) => w.length > 2);
  if (tt.length) {
    const scored = chapters.map((c, i) => [i, norm(c.title).filter((w) => tt.includes(w)).length / tt.length]).sort((a, b) => b[1] - a[1]);
    if (scored[0][1] >= 0.6) return scored[0][0];
  }
  if (n > 0) {
    // "Chapter 7", "7", "07 - …", "Chapter Seven" is rarer — numbers first.
    const re = new RegExp(`(^|\\D)0*${n}(\\D|$)`);
    const byNum = chapters.findIndex((c) => re.test(c.title || '') && !/part|disc|cd/i.test((c.title || '').replace(/chapter/i, '')));
    if (byNum >= 0) return byNum;
    // Opening credits / prologue before chapter 1 shift the count.
    const first = chapters.findIndex((c) => !/credit|intro|prolog|dedicat|title|opening|copyright/i.test(c.title || ''));
    return Math.min(chapters.length - 1, Math.max(0, first) + n - 1);
  }
  return /prolog/i.test(want.chapterTitle || '') ? Math.max(0, chapters.findIndex((c) => /prolog/i.test(c.title || ''))) : 0;
}

/** The moment in what you've heard with the transcript on (book seconds), if the quote is there. */
function findHeard(uid, quote, part) {
  // Only the quote's telling words count ("the", "and", "Harry" match anything); most must be there.
  const q = [...new Set(norm(quote).filter((w) => w.length > 3 && !STOPWORDS.has(w)))];
  if (q.length < 4) return null;
  const from = part[0]?.start ?? 0;
  const to = part[part.length - 1]?.end ?? Infinity;
  let best = null;
  for (const l of heardLines(uid)) {
    const g = player.trackOffset(l.track) + l.start;
    if (g < from || g > to) continue;
    const w = new Set(norm(l.text));
    const hit = q.filter((x) => w.has(x)).length / q.length;
    if (hit >= 0.8 && (!best || hit > best.hit)) best = { hit, g };
  }
  return best?.g ?? null;
}

/**
 * The parts of the audio that are this book. A series in one audiobook ("Harry Potter
 * (Pottermore)") holds several books: only the parts named after the one asked for.
 */
function volumeOf(chapters, book, want) {
  const names = [want.title, want.book].filter(Boolean);
  const isIt = (text) => names.some((n) => matches(mainTitle(n), text || ''));
  if (isIt(book.title) || !chapters.length) return chapters;
  const own = chapters.filter((c) => isIt(c.title));
  return own.length ? own : chapters;
}

// quiet: opened without playing (a scene is looked up first) — ready once it has loaded.
const loaded = (quiet = false) =>
  new Promise((resolve) => {
    let un = null;
    const done = (v) => (un && un(), resolve(v));
    un = player.subscribe((s) => {
      if (s.error) done(false);
      else if (!s.loading && s.tracks.length && (quiet || s.duration > 0 || s.playing)) done(true);
    });
    // A copy that hasn't started within 25 s: on to the next one.
    setTimeout(() => done(false), 25e3);
  });

/** The scene's time, found in the book's ebook (when there is one): { g, where } or null. */
async function inEbook(book, want, part) {
  const { ebookFor, ebookByTitle, autoFindEbook, textOfEbook } = await import('./booktext.js');
  const names = [want.title, want.book].filter(Boolean);
  const fits = (eb) => eb && names.some((n) => matches(mainTitle(n), `${eb.title || ''} ${eb.ebookName || ''}`));
  // The ebook of the book asked for — never another book of the same series.
  let eb = [ebookFor(book)].find(fits) || names.map((n) => ebookByTitle(n, want.author)).find(Boolean) || null;
  if (!eb && names.some((n) => matches(mainTitle(n), book.title || ''))) eb = await Promise.race([autoFindEbook(book), new Promise((r) => setTimeout(() => r(null), 40e3))]);
  if (!fits(eb)) return null;
  const bt = await textOfEbook(eb);
  const total = player.totalDuration();
  if (!total || !part.length) return null;
  const { anchorsFor, timeOf, sceneInText, rangeOf } = await import('./scenefind.js');
  const end = part[part.length - 1].end || total;
  const anchors = anchorsFor(bt, part, end, want.title, part[0].start);
  const ci = want.chapterTitle || want.chapter ? pickChapter(part, want) : -1;
  const words = [...(want.keywords || []), want.quote || ''];
  // The chapter the AI named, found in the ebook itself: the scene is looked for there
  // first (near how far in it said), the whole book only if it isn't there.
  const { chapterRange } = await import('./scenefind.js');
  const ch = chapterRange(bt, want.chapter, want.chapterTitle);
  const inCh = Math.min(0.95, Math.max(0, Number(want.at) || 0));
  const inside = {};
  const anywhere = {};
  let tok = ch ? sceneInText(bt, words, ch, { strict: true, target: ch[0] + inCh * (ch[1] - ch[0]), details: inside }) : null;
  // The whole book too: the AI can name the wrong chapter (the egg is talked about in two). If
  // somewhere else has clearly more of the scene's telling words, that's the scene.
  const all = sceneInText(bt, words, null, { details: anywhere });
  if (tok == null) tok = all ?? sceneInText(bt, words, rangeOf(anchors, part, ci));
  else if (all != null && anywhere.hit && inside.hit && (anywhere.hit.distinct > inside.hit.distinct + 1 || anywhere.hit.s > inside.hit.s * 1.4)) tok = all;
  if (tok == null) return null;
  const g = timeOf(anchors, tok);
  const at = part.findIndex((c) => g >= c.start && g < (c.end || Infinity));
  // The start of the chapter it's in (for "play the chapter where …").
  const { chapterStartBefore } = await import('./scenefind.js');
  const head = ch && tok >= ch[0] && tok < ch[1] ? ch[0] : chapterStartBefore(bt, tok);
  return { g, chapterG: head != null ? timeOf(anchors, head) : null, where: `${part[at]?.title || 'found'} · from the ebook` };
}

/**
 * Do it. `step(text)` reports progress. Resolves { book, scene, where } or throws
 * an Error whose `want` (when set) is the book to search the sources for.
 */
export async function playScene(said, step = () => {}, preset = null) {
  step('Working out the book and the scene…');
  const want = preset || (await understand(said));
  if (!want?.title) throw new Error(`Couldn't tell which book you meant — try "play when … in <book title>"`);
  const justBook = want.moment === false || (!want.scene && !(want.keywords || []).filter(Boolean).length && !want.chapter && !want.chapterTitle);
  step(`Looking for ${want.title}…`);
  // A copy can be gone (removed from TorBox, an old link): then the next one.
  let details = null;
  const copies = await findCopies(want);
  const now = player.getState();
  for (const book of copies) {
    // Already playing this book: just move to the scene, nothing to reopen.
    if (book.uid === now.book?.uid && now.tracks.length && !now.error) {
      details = now.book;
      break;
    }
    step(`Opening ${book.title}…`);
    try {
      details = await getDetails(book, { fast: true });
      if (details?.tracks?.length || details?.resolveTracks) {
        // Just the book: it plays at once. A scene: opened quietly, then played from the scene
        // (not loaded at your old place first and then again at the scene).
        player.playBook(details, { autoplay: justBook });
        if (await loaded(!justBook)) break;
      }
    } catch {}
    details = null;
  }
  // Not yours yet: just play it — the best torrent from your sources (instant in TorBox /
  // Real-Debrid first, then the most seeds), through your debrid service.
  if (!details && justBook) details = await fromSources(want, step).catch(() => null);
  if (!details) {
    const e = new Error(copies.length ? `Couldn't open your copy of ${want.title} — showing it in Search` : `${want.title} isn't in your library — showing it in Search`);
    e.want = want;
    throw e;
  }
  // Where: the line heard before (exact), else the scene found in the ebook's words,
  // else the chapter the AI named and how far into it.
  // Just the book, no moment asked for: it plays from where you left off.
  if (justBook) {
    if (!player.getState().playing) player.toggle();
    return { book: details, scene: details.title, where: 'from where you left off' };
  }
  let g = null;
  let where = '';
  const chapters = volumeOf(player.chapters(), details, want);
  step('Finding the scene in the book…');
  const hit = await inEbook(details, want, chapters).catch(() => null);
  let chapterG = null;
  if (hit) ({ g, where, chapterG } = hit);
  if (g == null) {
    g = findHeard(details.uid, want.quote, chapters);
    if (g != null) where = 'where you heard it';
  }
  if (g == null) {
    const ci = pickChapter(chapters, want);
    if (ci >= 0) {
      const c = chapters[ci];
      const len = Math.max(0, (c.end || c.start) - c.start);
      const at = Math.min(0.95, Math.max(0, Number(want.at) || 0));
      g = c.start + at * len;
      where = `${c.title || `Part ${ci + 1}`} · a guess (no ebook)`;
    }
  }
  // "Play the chapter where …": from the start of the chapter the scene is in.
  if (g != null && wholeChapter(said, want)) {
    const ci = chapters.findIndex((c) => g >= c.start && g < (c.end || Infinity));
    const own = chapters[ci];
    // The audiobook's own chapter start is exact when it's the same chapter as the book's.
    const start = own && (chapterG == null || Math.abs(own.start - chapterG) < 120) ? own.start : (chapterG ?? own?.start ?? g);
    player.playAt(start);
    return { book: details, scene: want.scene ? `The chapter: ${want.scene}` : '', where: `start of ${own?.title || 'the chapter'}${where.includes('ebook') ? ' · from the ebook' : ''}` };
  }
  if (g != null) player.playAt(g - LEAD);
  else {
    // Not found: say so, rather than quietly carrying on from where you were.
    if (!player.getState().playing) player.toggle();
    return { book: details, scene: `Couldn't find that scene${(want.keywords || []).length ? '' : ' (no ebook or chapter to go on)'} — playing from where you left off`, where: '' };
  }
  return { book: details, scene: want.scene || '', where };
}

// ---- Voice commands for what's playing ---------------------------------------------
// The everyday ones ("pause", "back 30 seconds", "next chapter", "speed 1.5") are worked out
// here at once, without the AI; anything else goes to the AI, which also finds books and scenes.
const NUMS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ek: 1, do: 2, teen: 3, char: 4, paanch: 5, das: 10, bees: 20, tees: 30 };
const num = (w) => (w == null ? null : /^\d+(\.\d+)?$/.test(w) ? +w : NUMS[w] ?? null);
const AMOUNT = /(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|ek|do|teen|char|paanch|das|bees|tees)\s*(seconds?|secs?|s|minutes?|mins?|m|minat|second)?\b/;

/** A command worked out without the AI: { action, seconds, chapter, speed, minutes } or null. */
function quick(said) {
  const t = String(said || '').toLowerCase().replace(/[^\p{L}\p{N}.\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!t || /\b(when|where|scene|part where)\b/.test(t)) return null;
  const amount = (def) => {
    const m = t.match(AMOUNT);
    const n = m ? num(m[1]) : null;
    if (n == null) return def;
    return /^m/.test(m[2] || '') ? n * 60 : n;
  };
  if (/^(pause|stop|hold on|wait|ruko|roko|rok do|band karo)\b/.test(t)) return { action: 'pause' };
  if (/^(resume|continue|carry on|unpause|keep (going|playing)|play|start|chalao|chalu karo|shuru karo)( (it|again|playing|the book|please|now))*$/.test(t)) return { action: 'resume' };
  if (/\b(next|agla|agle) (chapter|part|track)\b/.test(t) || /^skip (this |the )?(chapter|part)$/.test(t)) return { action: 'next_chapter' };
  if (/\b(previous|last|pichla|pichhle|pichle) (chapter|part|track)\b/.test(t)) return { action: 'previous_chapter' };
  const ch = t.match(/^(?:go to |play |start |jump to |skip to |open )?(?:chapter|part) (\d+|[a-z]+)$/);
  if (ch && num(ch[1])) return { action: 'go_chapter', chapter: num(ch[1]) };
  if (/\b(rewind|go back|back|skip back|peeche|pichhe|piche)\b/.test(t) && !/chapter|book/.test(t)) return { action: 'rewind', seconds: amount(30) };
  if (/\b(forward|fast forward|ahead|skip ahead|skip|aage)\b/.test(t) && !/chapter|book|to /.test(t)) return { action: 'forward', seconds: amount(30) };
  const sp = t.match(/\bspeed\b.*?(\d+(?:\.\d+)?)|(\d(?:\.\d+)?)\s*x\b/);
  if (sp) return { action: 'speed', speed: +(sp[1] || sp[2]) };
  if (/\b(faster|speed up|tez)\b/.test(t)) return { action: 'speed', speed: Math.min(3, (player.getState().rate || 1) + 0.25) };
  if (/\b(slower|slow down|dheere|dheeme)\b/.test(t)) return { action: 'speed', speed: Math.max(0.5, (player.getState().rate || 1) - 0.25) };
  if (/\bsleep\b/.test(t)) {
    if (/\b(cancel|off|stop|no)\b/.test(t)) return { action: 'sleep', minutes: 0 };
    if (/end of (the )?(chapter|part)/.test(t)) return { action: 'sleep', minutes: -1 };
    return { action: 'sleep', minutes: amount(0) ? Math.round(amount(0) / 60) || amount(0) : 30 };
  }
  if (/^(add (a )?)?bookmark( (this|it|here))?$|^mark (this|it|here)$|^save (this|the) (spot|place|moment)$/.test(t)) return { action: 'bookmark' };
  return null;
}

/** Sounds like a command for the player or a book/scene to play (not a question)? */
export const isCommand = (said) => !!quick(said) || /^(play|go to|jump to|take me to|skip to|start (from|at)|open|resume|continue|chalao|sunao)\b/i.test(String(said || '').trim());

const CONTROLS = new Set(['pause', 'resume', 'rewind', 'forward', 'next_chapter', 'previous_chapter', 'go_chapter', 'speed', 'sleep', 'bookmark']);
const mmss = (s) => (s >= 60 ? `${Math.round((s / 60) * 10) / 10} min` : `${Math.round(s)} s`);

/** Do a control on what's playing; resolves the message to show. */
async function control(c) {
  const s = player.getState();
  if (!s.book) throw new Error('Nothing is playing — say a book to play');
  const play = () => !player.getState().playing && player.toggle();
  switch (c.action) {
    case 'pause':
      player.pause();
      return '⏸ Paused';
    case 'resume':
      play();
      return '▶ Playing';
    case 'rewind': {
      const sec = Math.max(1, Number(c.seconds) || 30);
      player.playAt(player.globalTime() - sec);
      return `⏪ Back ${mmss(sec)}`;
    }
    case 'forward': {
      const sec = Math.max(1, Number(c.seconds) || 30);
      player.playAt(player.globalTime() + sec);
      return `⏩ Forward ${mmss(sec)}`;
    }
    case 'next_chapter':
    case 'previous_chapter':
    case 'go_chapter': {
      const chapters = player.chapters();
      const g = player.globalTime();
      let ci = chapters.findIndex((x) => g >= x.start && g < (x.end || Infinity));
      if (c.action === 'next_chapter') ci += 1;
      else if (c.action === 'previous_chapter') ci -= 1;
      else ci = pickChapter(chapters, { chapter: c.chapter });
      if (ci < 0 || ci >= chapters.length) throw new Error(c.action === 'go_chapter' ? `There's no chapter ${c.chapter}` : 'No more chapters that way');
      player.playAt(chapters[ci].start);
      return `▶ ${chapters[ci].title || `Part ${ci + 1}`}`;
    }
    case 'speed': {
      const r = Math.min(3, Math.max(0.5, Math.round((Number(c.speed) || 1) * 20) / 20));
      player.setRate(r);
      return `Speed ${r}×`;
    }
    case 'sleep': {
      const m = Number(c.minutes);
      if (!m) return player.setSleep(null), 'Sleep timer off';
      if (m < 0) return player.setSleep('track'), '🌙 Stops at the end of this chapter';
      player.setSleep(m);
      return `🌙 Stops in ${m} min`;
    }
    case 'bookmark': {
      const bm = player.addBookmark();
      import('./bookmarkname.js').then((x) => x.nameBookmark(s.book, bm)).catch(() => {});
      return '🔖 Bookmarked';
    }
  }
  throw new Error("Didn't catch that");
}

/**
 * Anything said to the app: a control of what's playing, a book to play, or a scene.
 * Resolves { message } for a control, else { book, scene, where }.
 */
export async function runCommand(said, step = () => {}, withAi = true) {
  const q = quick(said);
  if (q) return { message: await control(q), action: q.action };
  // "Play <a book you have>": straight away, no AI needed.
  const mine = await quickBook(said);
  if (mine) return playScene(said, step, mine);
  // "Find a book on consciousness", "recommend something short": the bookseller (Discover).
  if (/^(please\s+)?(find|search( for)?|look for|recommend|suggest|show me|get me|i want|i need|koi|mujhe)\b/i.test(said) && /\b(books?|audiobooks?|novels?|something|kitab|kuch|reads?|listens?)\b/i.test(said))
    return { find: true, query: said.trim() };
  if (!withAi) throw new Error('Commands like “back 30 seconds” work as they are; books, scenes and questions need an AI key (Settings → AI)');
  step('Working it out…');
  const want = await understand(said);
  const action = want?.action && want.action !== 'unknown' ? want.action : want?.title ? (want.moment === false ? 'play_book' : 'scene') : 'unknown';
  if (CONTROLS.has(action)) return { message: await control({ ...want, action }), action };
  if (action === 'question') return { question: true, ...questionBook(want) };
  if (action === 'find') return { find: true, query: said.trim() };
  // Anything else: a question for Ask AI (never "didn't catch that").
  if (action === 'unknown' || !want?.title) return { question: true, ...questionBook(want || {}) };
  // Jumping to a scene ("play when…", "the chapter where…") is switched off for now — it wasn't
  // reliable enough. Such a request goes to Ask AI as a question instead.
  // (Words of the title itself don't count: "play Where the Crawdads Sing" is a book.)
  const titleWords = new Set(words(want.title || ''));
  const rest = String(said).toLowerCase().split(/\s+/).filter((w) => !titleWords.has(w.replace(/[^\p{L}\p{N}']/gu, ''))).join(' ');
  const sceneish = /\b(where|when|scene|moment|jab|jahan|jisme)\b/i.test(rest);
  if (action === 'scene' || (action === 'play_book' && sceneish)) return { question: true, ...questionBook(want) };
  want.moment = false;
  return playScene(said, step, want);
}

/** The book a question is about: the one playing, one of yours, or just its title. */
function questionBook(want) {
  const now = player.getState().book;
  const t = mainTitle(want.title || want.book || '');
  if (!t) return { book: now && now.source !== 'pod' ? now : null, here: !!now };
  if (now && matches(t, now.title || '')) return { book: now, here: true };
  const mine = [...Object.values(progress.get() || {}).map((p) => p.book), ...(localCfg.get().books || [])].find((b) => b && matches(t, b.title || ''));
  return { book: mine || { uid: '', title: want.title, author: want.author || '' }, here: false };
}

/** "Play Sapiens", "resume The Secret by Rhonda Byrne": a book already on hand, by its title. */
async function quickBook(said) {
  const m = String(said || '').trim().match(/^(?:play|resume|start|open|continue|listen to|sunao|chalao)\s+(?:the book\s+)?(.+?)(?:\s+by\s+(.+))?$/i);
  // "when / where" can be part of a title (Where the Crawdads Sing): a copy you have decides.
  if (!m || /\b(chapter|scene|jab|jahan)\b/i.test(m[1])) return null;
  const want = { action: 'play_book', moment: false, title: m[1].trim(), author: (m[2] || '').trim() };
  const copies = await findCopies(want, true);
  return copies.length ? want : null;
}
