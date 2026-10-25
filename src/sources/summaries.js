// Book summaries: key ideas in the style of Tanga / Blinkist — a short intro, then
// 6–10 ideas you can read in a few minutes or listen to with the read-aloud voices.
// Written by your AI service (Settings → AI) and kept on the phone.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { words, mainTitle } from '../lib/match.js';
import { persisted } from '../lib/store.js';
import { askAi, parseJson, aiReady, ai } from '../lib/ai.js';
import { goodreads, goodreadsPage } from '../lib/ratings.js';

const Web = registerPlugin('InkwellWeb');
const inAppWeb = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');

/** Open a link in the app that owns it, or the browser. */
export async function openExternal(url) {
  if (inAppWeb) return Web.openExternal({ url }).catch(() => Browser.open({ url }));
  if (Capacitor.isNativePlatform()) return Browser.open({ url });
  window.open(url, '_blank');
}

/** Open a page inside the app (sign-ins are remembered); external browser only as a fallback. */
export async function openUrl(url, title = '') {
  if (inAppWeb) return Web.open({ url, title });
  if (Capacitor.isNativePlatform()) return Browser.open({ url });
  window.open(url, '_blank');
}

const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const keyFor = (book) => `${words(mainTitle(book.title)).join(' ')}|${words(String(book.author || '').split(/,|&| and /)[0]).join(' ')}`;

// Summaries made so far (the newest 60).
const store = persisted('bookSummaries', {});

export { aiReady };

/** The saved summary for a book, if one was made. */
export const savedSummary = (book) => store.get()[keyFor(book)]?.data || null;

/**
 * Key ideas for a book: { tagline, about, forWho, ideas: [{ title, text }], quote, takeaway, minutes }.
 * Made once and saved; throws when the AI doesn't know the book well enough.
 */
export async function keyIdeas(book, { fresh = false, description = '' } = {}) {
  const key = keyFor(book);
  const hit = store.get()[key];
  if (hit && !fresh) return hit.data;
  const title = mainTitle(book.title);
  const author = book.author || '';
  let about = String(description || book.description || '').replace(/\s+/g, ' ').trim();
  // A short blurb (or none): the full description from Goodreads gives the AI much more to go on.
  if (about.length < 400) {
    const g = await goodreads(book).catch(() => null);
    const page = g?.url ? await goodreadsPage(g.url).catch(() => null) : null;
    if (page?.description && page.description.length > about.length) about = page.description.replace(/\s+/g, ' ').trim();
  }
  about = about.slice(0, 3000);
  const shape = `Reply with JSON only:
{"known": true|false, "basis": "knowledge" | "description", "tagline": "one line hook", "about": "2-3 sentences on what the book is about", "forWho": "who should read it, one sentence",
 "ideas": [{"title": "short idea title", "text": "120-180 words explaining the idea"}],
 "quote": "a short memorable line from or about the book", "takeaway": "the one thing to remember, 1-2 sentences"}`;
  const prompt = `Write a book summary of "${title}"${author ? ` by ${author}` : ''} in the style of Blinkist (short "blinks", each one key idea).
${about ? `The publisher's description:\n"""${about}"""\n` : ''}${shape}
Give 7 to 10 ideas, in the order the book presents them. Plain, warm, clear English. For fiction, summarise the story and its themes without inventing plot details.
If you know this book well, use what you know ("basis": "knowledge", with the book's own examples).
If you don't, but the description above says enough, give 4 to 6 ideas based only on the description and the book's subject ("basis": "description") — don't invent examples, quotes or chapters.
Only if neither is possible, reply {"known": false}.`;
  // Second try, on a different model: always write something useful from the description.
  const fallback = `Write 4 to 6 short "blinks" (key ideas) for the book "${title}"${author ? ` by ${author}` : ''}.
${about ? `Use this description:\n"""${about}"""\n` : 'Use what is generally known about the book and its subject.\n'}Stay close to what the description says; don't invent quotes, chapters or plot details. Set "basis" to "description" and "known" to true.
${shape}`;
  let data = normalize(parseJson(await askAi(prompt, { json: true })));
  if (!usable(data)) {
    const used = ai.get().last;
    data = normalize(parseJson(await askAi(fallback, { json: true, skip: used ? [used] : [] })));
  }
  if (!usable(data))
    throw new Error(about ? "The AI couldn't summarise this book right now — tap Get blinks to try again" : "The AI doesn't know this book, and there's no description to go on");
  const ideas = data.ideas.filter((i) => i && i.title && i.text).slice(0, 12);
  const wordsCount = [data.about, ...ideas.map((i) => i.text), data.takeaway].join(' ').split(/\s+/).length;
  const out = { fromDescription: data.basis === 'description', tagline: data.tagline || '', about: data.about || '', forWho: data.forWho || '', ideas, quote: data.quote || '', takeaway: data.takeaway || '', minutes: Math.max(3, Math.round(wordsCount / 220)) };
  store.set((all) => {
    const next = { ...all, [key]: { at: Date.now(), data: out } };
    const keys = Object.keys(next).sort((a, b) => next[b].at - next[a].at);
    for (const k of keys.slice(60)) delete next[k];
    return next;
  });
  return out;
}

// Models word their JSON differently: accept "blinks"/"key_ideas", and ideas given as plain strings.
function normalize(d) {
  if (!d || typeof d !== 'object') return d;
  let ideas = d.ideas || d.blinks || d.key_ideas || d.keyIdeas || [];
  if (!Array.isArray(ideas)) ideas = Object.values(ideas);
  ideas = ideas
    .map((i) => (typeof i === 'string' ? { title: i.split(/[:.–—-]\s/)[0].slice(0, 80), text: i } : i && { title: i.title || i.heading || i.name || '', text: i.text || i.explanation || i.description || i.body || '' }))
    .filter((i) => i && i.title && i.text);
  return { ...d, ideas };
}
const usable = (d) => d && d.known !== false && d.ideas?.length >= 3;

/** The summary as a "book" for the reader (Read / Listen with the read-aloud voices). */
export const summaryBook = (book) => ({
  uid: 'sum:' + keyFor(book),
  source: 'sum',
  kind: 'text',
  title: `${mainTitle(book.title)} · blinks`,
  author: book.author || '',
  cover: book.cover || '',
  sumOf: { title: book.title, author: book.author || '' },
});

/** Summary text for the in-app reader: { html, headings, title }. */
export async function loadSummary(book) {
  const s = await keyIdeas(book.sumOf || book);
  const title = mainTitle((book.sumOf || book).title);
  const parts = [`<h1 id="sum-top">${esc(title)}</h1>`];
  if (s.tagline) parts.push(`<p><em>${esc(s.tagline)}</em></p>`);
  parts.push(`<h2 id="sum-about">What it's about</h2>`, `<p>${esc(s.about)}</p>`);
  if (s.forWho) parts.push(`<p>${esc(s.forWho)}</p>`);
  s.ideas.forEach((i, k) => parts.push(`<h2 id="sum-${k}">${k + 1}. ${esc(i.title)}</h2>`, ...String(i.text).split(/\n{2,}/).map((t) => `<p>${esc(t.trim())}</p>`)));
  if (s.quote) parts.push(`<blockquote><p>${esc(s.quote)}</p></blockquote>`);
  if (s.takeaway) parts.push(`<h2 id="sum-end">Final takeaway</h2>`, `<p>${esc(s.takeaway)}</p>`);
  const headings = [
    { id: 'sum-about', text: "What it's about", level: 2 },
    ...s.ideas.map((i, k) => ({ id: `sum-${k}`, text: `${k + 1}. ${i.title}`, level: 2 })),
    ...(s.takeaway ? [{ id: 'sum-end', text: 'Final takeaway', level: 2 }] : []),
  ];
  return { html: parts.join('\n'), headings, title: `${title} · blinks` };
}
