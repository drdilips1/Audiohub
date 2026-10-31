// Ask AI about a book (or about your whole library): six modes with ready-made
// questions, a follow-up conversation kept per book, a quiz for "Remember", and
// "ask about what I'm hearing" using where you are in the book right now.
// Answers come from the book's own text when its ebook is on hand (the passages that
// fit the question, never past where you are with no-spoilers on), what you've heard
// (live transcript), and otherwise what the AI knows plus the description.
import { heardText } from './transcript.js';
import { askAi, parseJson } from './ai.js';
import { persisted, progress, settings } from './store.js';
import { mainTitle } from './match.js';
import { tasteProfile } from './bookseller.js';
import { fmtTime } from './format.js';
import * as player from './player.js';

// ---- the book's own text -------------------------------------------------------
const texts = new Map(); // uid -> Promise<tokens[] | null>
async function bookTokens(book) {
  if (!book?.uid) return null;
  if (!texts.has(book.uid)) {
    const load = (async () => {
      const bt = await import('./booktext.js');
      const eb = book.kind === 'text' ? book : bt.ebookFor(book);
      if (!eb) return null;
      return (await bt.textOfEbook(eb)).tokens;
    })().catch(() => null);
    texts.set(book.uid, Promise.race([load, new Promise((r) => setTimeout(() => r(null), 20000))]));
  }
  const t = await texts.get(book.uid);
  if (!t) texts.delete(book.uid); // try again next time (the ebook may be attached by then)
  return t;
}
const STOP = new Set('the a an and or of to in on at for with is are was were be been it its this that what who whom why how when where which does do did about from by as into than then there their they them he she his her you your i me my we our us book chapter tell explain say said'.split(' '));
const keyWords = (t) => [...new Set(String(t).toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))];
/** Passages of the book for this question: up to `max` words, in book order, within `upto` (0–1). */
function passages(tokens, question, upto = 1, max = 2000) {
  const SIZE = 260;
  const end = Math.max(SIZE, Math.floor(tokens.length * Math.min(1, upto)));
  const chunks = [];
  for (let i = 0; i < end; i += SIZE) chunks.push({ i, words: tokens.slice(i, Math.min(i + SIZE, end)) });
  const want = keyWords(question);
  let pick;
  if (want.length) {
    const score = (c) => {
      const low = c.words.join(' ').toLowerCase();
      return want.reduce((n, w) => n + (low.includes(w) ? 1 + (low.split(w).length - 2) * 0.2 : 0), 0);
    };
    pick = chunks.map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, Math.floor(max / SIZE)).map((x) => x.c);
  }
  // A general question (or nothing matched): passages spread across what's been read.
  if (!pick?.length) {
    const n = Math.min(chunks.length, Math.floor(max / SIZE));
    pick = Array.from({ length: n }, (_, k) => chunks[Math.floor((k * chunks.length) / n)]);
  }
  const total = tokens.length;
  return pick
    .sort((a, b) => a.i - b.i)
    .map((c) => `[about ${Math.round((c.i / total) * 100)}% into the book] ${c.words.join(' ')}`)
    .join('\n\n');
}

export const MODES = [
  {
    id: 'understand',
    icon: '🔍',
    label: 'Understand',
    asks: ['Explain the main concept simply', "Explain it like I'm 10", 'Give me a real-life example of the core idea', 'What are the difficult parts, explained?'],
  },
  {
    id: 'summarize',
    icon: '📝',
    label: 'Summarize',
    asks: ['A 30-second summary', 'A 5-minute summary', 'The whole book in 10 points', 'Summarize it chapter by chapter'],
  },
  {
    id: 'remember',
    icon: '🧠',
    label: 'Remember',
    asks: ['Quiz me (5 questions)', 'Make flashcards of the key concepts', 'Give me memorable analogies for the main ideas'],
  },
  {
    id: 'apply',
    icon: '🛠',
    label: 'Apply',
    asks: ['Turn this book into a 7-day plan for me', 'Give me a practical checklist', 'What should I actually do differently?'],
  },
  {
    id: 'challenge',
    icon: '⚖️',
    label: 'Challenge',
    asks: ['What are the weaknesses of this book?', 'What does research say about its main claims?', 'What are the strongest counterarguments?', 'Which claims are controversial?'],
  },
  {
    id: 'connect',
    icon: '🔗',
    label: 'Connect',
    asks: ["How does this connect to books I've read?", 'Which books say the opposite?', 'What should I read next after this?'],
  },
];

export const STARTERS = ['What is this book about?', 'What are the 5 most important ideas?', 'Is this book worth my time?', 'Give me a practical summary'];
// While listening: one tap asks about the part you're hearing (the player's companion row).
export const COMPANION = [
  ['explain', 'bulb', 'Explain', 'Explain what is being said at this point in simple words, with one real-life example.'],
  ['challenge', 'scale', 'Challenge', "Challenge what the author argues around this point: the claim, the evidence given, the strongest support, the strongest criticism, and what remains uncertain. Mention related research or books."],
  ['rabbit', 'compass', 'Rabbit hole', 'Take me down a short rabbit hole (about 2 minutes to listen, under 250 words) on the most interesting idea at this point: what is actually known, myths vs evidence, key thinkers, and 2–3 related books or documentaries.'],
  ['related', 'library', 'Related', 'Which other books (especially ones in my library) discuss the idea at this point, and how do they agree or disagree?'],
  ['recall', 'target', 'Recall', 'Help me remember what I have heard so far. Give 5 short recall questions (mix facts, ideas and one "why" question), each on its own line. Then a line "Answers:" with a one-line answer to each. Then "In short:" with the 3–4 key points to keep. Use only what was actually said so far when a transcript is given; do not reveal anything later.'],
];

// "Remember this": ideas you save while listening, kept as cards and searchable by Ask my books.
export const ideas = persisted('savedIdeas', []);
export async function rememberHere(book) {
  const where = hearing(book);
  let text = '';
  try {
    text = (await askAi(`${context(book, { description: book?.description || '' })}
The reader is listening at ${where?.label || 'the current point'} and wants to remember the idea being discussed there.
In one or two plain sentences, state that key idea so it is useful to re-read weeks later. If unsure of the exact passage, state the book's closest key idea and say "around here".`)).trim();
  } catch {
    text = '';
  }
  const card = { t: Date.now(), uid: book?.uid || '', title: mainTitle(book?.title || ''), author: book?.author || '', where: where?.label || '', text: text || `Saved at ${where?.label || 'this point'}` };
  ideas.set((list) => [card, ...(list || [])].slice(0, 300));
  return card;
}
export const forgetIdea = (t) => ideas.set((list) => (list || []).filter((c) => c.t !== t));

export const LIBRARY_ASKS = [
  'What ideas have I saved, grouped by theme?',
  'What common themes run through my books?',
  'Which books in my library disagree with each other?',
  'What should I read next, based on my books?',
  'Sum up what my books say about living well',
  'Debate: pick two of my books that disagree and give each side its strongest case',
  'Which idea comes up again and again across my books?',
];

// Conversations, per book (newest 30 books, last 30 messages each).
const threads = persisted('askThreads', {});
const keyOf = (book) => (book ? book.uid || mainTitle(book.title) : 'library');
export const threadFor = (book) => threads.get()[keyOf(book)]?.msgs || [];
function saveThread(book, msgs) {
  const k = keyOf(book);
  threads.set((all) => {
    const next = { ...all, [k]: { t: Date.now(), msgs: msgs.slice(-30) } };
    const keys = Object.keys(next);
    if (keys.length > 30) keys.sort((a, b) => next[a].t - next[b].t).slice(0, keys.length - 30).forEach((x) => delete next[x]);
    return next;
  });
}
export const clearThread = (book) => saveThread(book, []);

/** Where you are in this book, if it's the one playing: { chapter, time, label }. */
export function hearing(book) {
  const st = player.getState();
  if (!book || !st.book || st.book.uid !== book.uid) return null;
  const g = player.globalTime();
  const ch = player.chapters().find((c) => g >= c.start && g < (c.end || Infinity));
  // What was just said (from the live transcript, when it ran): the last few minutes.
  const heard = heardText(st.book.uid, st.index, st.time + 2, 3500).replace(/^…/, '').trim();
  return { chapter: ch?.title || '', time: g, label: `${ch?.title ? `${ch.title}, ` : ''}${fmtTime(g)}`, heard };
}

function savedIdeas() {
  const list = (ideas.get() || []).slice(0, 60);
  if (!list.length) return '';
  return `Ideas the reader saved while listening ("Remember this"):\n${list.map((c) => `- [${c.title}${c.where ? `, ${c.where}` : ''}] ${c.text}`).join('\n')}\n`;
}

function context(book, { description = '', genres = [], text = '' } = {}) {
  if (!book) {
    const taste = tasteProfile(60);
    return `You are a thoughtful reading companion who knows this reader's library well.
The reader's books (with how they felt, where known):
${taste.length ? taste.map((t) => '- ' + t).join('\n') : '- (no books yet)'}
${savedIdeas()}Answer about these books using what you know of them. Name the books you draw on. If a book isn't one you know, say so.`;
  }
  const title = mainTitle(book.title);
  const desc = String(description || book.description || '').replace(/\s+/g, ' ').trim().slice(0, 1800);
  return `You are a knowledgeable, honest reading companion for the book "${title}"${book.author ? ` by ${book.author}` : ''}.
${
    text
      ? `You have the book's own text: the passages below, chosen for this question from the reader's ebook. Answer from them first, quoting a few words where it helps; add what you know about the book where they don't cover it. Never invent quotes, page numbers or timestamps.
Passages from the book:
"""
${text}
"""
`
      : `Use what you know about this book and the description below. If you're unsure about a specific detail, say so. Never invent quotes, page numbers, chapter titles or timestamps.
`
  }${desc ? `Description: """${desc}"""\n` : ''}${genres.length ? `Genres: ${genres.slice(0, 6).join(', ')}\n` : ''}`;
}

/**
 * No spoilers (Settings → AI, on by default): answers stay within what you've heard
 * or read so far. Finished books have no limit.
 */
export const noSpoilers = () => settings.get().aiNoSpoilers !== false;
export function spoilerLimit(book) {
  if (!book || !noSpoilers()) return null;
  const uid = book.uid || '';
  const p = progress.get()[uid] || progress.get()[`${uid.replace(/#ebook$/, '')}#ebook`];
  if (p?.finished) return null;
  const pct = Math.round((p?.percent || 0) * 100);
  const where = hearing(book);
  return { pct, label: where?.chapter ? `${where.chapter} (about ${pct}% through)` : `about ${pct}% through` };
}
export function spoilerRule(book) {
  const lim = spoilerLimit(book);
  if (!lim) return '';
  return lim.pct <= 1
    ? 'NO SPOILERS: the reader has only just started this book. Do not reveal anything beyond its premise (the description): no plot developments, twists, deaths, endings or later revelations. If the question needs them, say it would be a spoiler and offer to tell them if they ask again.'
    : `NO SPOILERS: the reader has reached ${lim.label}. Do not reveal anything that happens after this point: no later plot developments, twists, deaths, endings or later revelations, and don't hint at them. If the question needs later events, say it would be a spoiler and offer to tell them if they ask again.`;
}

const STYLE = 'When something you say comes from outside the book itself (general knowledge, other sources, your interpretation), say so briefly, e.g. "Outside the book: …". Reply in the language the reader used (English, Hindi or Hinglish). Answer in clear, warm, plain language. Use short paragraphs, and bullet points ("- ") or numbered lists where they help. Use **bold** for key terms. Keep it under about 250 words unless the question asks for more.';

/**
 * Ask a question. `msgs` is the conversation so far ({ role: 'user'|'ai', text }).
 * Returns the answer text and saves the thread.
 */
export async function ask(book, question, { msgs = [], description = '', genres = [], mode = '', where = null, drive = false, voice = false } = {}) {
  const history = msgs
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Reader' : 'You'}: ${m.quiz ? '(a quiz)' : m.text}`)
    .join('\n');
  const extra = [];
  if (mode === 'connect' && book) {
    const taste = tasteProfile(40);
    if (taste.length) extra.push(`Books this reader owns, has read or is reading:\n${taste.map((t) => '- ' + t).join('\n')}\nConnect to these specifically where it makes sense.`);
  }
  const spoil = spoilerRule(book);
  if (spoil) extra.push(spoil);
  if (where && drive) extra.push(`The reader is listening right now at ${where.label}. If the question is about what they're hearing, answer about that part of the book as best you know it.`);
  else if (where) extra.push(`The reader is listening right now at ${where.label}. Answer about the part of the book around this point as best you know it; say if you can't be sure exactly what is said there.`);
  if (where?.heard)
    extra.push(`What the listener just heard (speech-recognised, a few words may be wrong; the last line is where they are now):\n"""${where.heard}"""\nAnswer from this passage first.`);
  // Spoken questions are recognised by the phone and can be misheard ("items" for "atoms").
  if (voice || drive) extra.push('The question was spoken and recognised by the phone, so a word may be misheard: if it makes little sense, answer what they most likely meant (especially a word from the passage above) and say so briefly.');
  // Driving: the answer is only heard, so keep it short and easy to follow by ear.
  if (drive) extra.push('The reader is driving and will only hear your answer read aloud: reply in 2–5 short spoken sentences (under 90 words), no lists, headings or symbols.');
  // The book's own words: passages for this question (up to where you are, with no spoilers).
  let passageText = '';
  const tokens = book ? await bookTokens(book) : null;
  if (tokens) {
    const lim = spoilerLimit(book);
    passageText = passages(tokens, `${question} ${msgs.slice(-2).map((m) => m.text || '').join(' ')}`, lim ? Math.max(0.03, lim.pct / 100) : 1, drive ? 1100 : 2000);
  }
  // Everything heard so far (live transcript), when there's no ebook.
  if (!passageText && book && player.getState().book?.uid === book.uid && !where?.heard) {
    const st = player.getState();
    const heard = heardText(book.uid, st.index, st.time + 2, 9000).trim();
    if (heard.length > 400) extra.push(`What the listener has heard of this book so far (speech-recognised, a few words may be wrong):\n"""${heard}"""\nUse it to answer.`);
  }
  // Where this answer came from (shown under it): the ebook, what was heard, or neither.
  const from = passageText ? 'ebook' : extra.some((x) => x.startsWith('What the listener')) ? 'heard' : '';
  const prompt = `${context(book, { description, genres, text: passageText })}
${extra.join('\n\n')}
${history ? `Conversation so far:\n${history}\n` : ''}
Reader's question: ${question}

${STYLE}`;
  const text = (await askAi(prompt)).trim();
  saveThread(book, [...msgs, { role: 'user', text: question }, { role: 'ai', text, from }]);
  lastFrom = from;
  return text;
}
let lastFrom = '';
/** Where the last answer came from: 'ebook', 'heard' or ''. */
export const answerSource = () => lastFrom;
/** Is this book's ebook on hand (Ask answers from its text)? */
export async function hasBookText(book) {
  if (!book) return false;
  if (book.kind === 'text') return true;
  const bt = await import('./booktext.js');
  return !!bt.ebookFor(book);
}
/** Keep an answer as a saved idea (Ask my books reads them too). */
export function keepAnswer(book, text) {
  const t = Date.now();
  ideas.set((list) => [{ t, text: String(text).slice(0, 1200), uid: book?.uid || '', title: book ? mainTitle(book.title) : 'My books', author: book?.author || '', where: 'Ask AI' }, ...(list || [])].slice(0, 300));
}

/** A multiple-choice quiz: [{ q, options: [4], answer: 0-3, why }]. */
export async function quiz(book, { msgs = [], description = '', genres = [] } = {}) {
  const prompt = `${context(book, { description, genres })}
Write a 5-question multiple-choice quiz that helps the reader remember the book's most important ideas (not trivia).
Reply with JSON only: {"questions": [{"q": "question", "options": ["A", "B", "C", "D"], "answer": 0, "why": "one-sentence explanation"}]}
"answer" is the index (0-3) of the correct option. Vary which position is correct.`;
  const data = parseJson(await askAi(prompt, { json: true }));
  const questions = (data?.questions || [])
    .filter((x) => x && x.q && Array.isArray(x.options) && x.options.length >= 2 && Number.isInteger(Number(x.answer)))
    .map((x) => ({ q: String(x.q), options: x.options.slice(0, 4).map(String), answer: Math.min(Number(x.answer), x.options.length - 1), why: String(x.why || '') }))
    .slice(0, 6);
  if (!questions.length) throw new Error("The AI couldn't make a quiz right now — try again");
  saveThread(book, [...msgs, { role: 'user', text: 'Quiz me' }, { role: 'ai', text: '', quiz: questions }]);
  return questions;
}
