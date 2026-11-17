// Bookmarks that say what was happening ("Harry and Ron argue on the train", "Why habits
// beat goals"), not just "Chapter 3 · 12:43" or the first words of the line: named from the
// transcript (or the book's own text) around that moment — by your AI service when one is
// set up, else from the moment's most telling words.
import { heardLines, bookTextBefore } from './transcript.js';
import { aiReady, askAi } from './ai.js';
import * as player from './player.js';
import { bookmarks } from './store.js';

const STOP = new Set(
  'the a an and or but of to in on at by for with from as is was were be been being his her he she they them their it its that this these those then than not no so up out into over who what when where which while had has have did do does said says will would could should there here you your we our us i me my mine just very really also only even about after before again all any because can each few more most other some such own same too through until down off once both why how much many like one two three now well back still get got going way thing things'.split(
    ' '
  )
);

/** The moment's most telling words: names and words that come up more than once. */
export function tellingWords(text, n = 3) {
  const raw = String(text || '').match(/[\p{L}][\p{L}'’-]+/gu) || [];
  const count = new Map();
  const shown = new Map();
  raw.forEach((w, i) => {
    const k = w.toLowerCase().replace(/[’']s$/, '');
    if (k.length < 4 || STOP.has(k)) return;
    // A capital in the middle of a sentence is a name: worth more.
    const name = /^\p{Lu}/u.test(w) && i > 0 && !/[.!?]$/.test(raw[i - 1]);
    count.set(k, (count.get(k) || 0) + (name ? 2 : 1));
    if (!shown.has(k) || name) shown.set(k, name ? w.replace(/[’']s$/, '') : k);
  });
  return [...count.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => shown.get(k));
}

/** The words around a bookmark: what was heard, else the book's own text (ebook attached). */
function textAt(book, bm) {
  // Only what was heard right around the moment (the 2½ minutes before it, a little after):
  // not everything heard earlier in the book (a book heard only at its start was naming
  // later bookmarks from the opening credits).
  let text = heardLines(book.uid)
    .filter((l) => l.track === bm.track && l.start >= bm.time - 150 && l.start <= bm.time + 25)
    .sort((a, b) => a.start - b.start)
    .map((l) => l.text)
    .join(' ')
    .trim();
  if (text.split(/\s+/).length < 8 && bm.track === player.getState().index && player.getState().book?.uid === book.uid) text = bookTextBefore(bm.time + 20, 400) || text;
  return text.split(/\s+/).length < 8 ? '' : text;
}

const chapterOf = (bm) => {
  const t = player.getState().tracks?.[bm.track]?.title || '';
  return /^(track|part|chapter)?\s*\d+$/i.test(t.trim()) ? '' : t.slice(0, 40);
};

async function aiName(book, text, chapter) {
  const prompt = `A listener bookmarked a moment in the audiobook "${book.title}"${book.author ? ` by ${book.author}` : ''}${chapter ? `, in "${chapter}"` : ''}. This is what was being read around that moment:
"""${text.slice(-1400)}"""
Give the bookmark a name of 3 to 7 words that says what is happening or the idea being made at that moment — like a chapter title someone would write in the margin ("Harry and Ron argue on the train", "Why habits beat goals", "The beggar sitting on a box"). Do not copy the opening words of the text; summarise. Reply with the name only, no quotes, no full stop.`;
  const once = async () =>
    (await askAi(prompt))
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)[0]
      ?.replace(/^(name|bookmark)\s*:\s*/i, '')
      .replace(/^["'“”*\s]+|["'“”*.\s]+$/g, '')
      .slice(0, 70) || '';
  try {
    return await once();
  } catch (e) {
    // One more try a little later (a busy service), then say what went wrong in Report a problem.
    await new Promise((r) => setTimeout(r, 4000));
    try {
      return await once();
    } catch (e2) {
      import('./report.js').then((r) => r.logError('Bookmark name', `${book.title}: ${e2.message || e.message}`)).catch(() => {});
      return '';
    }
  }
}

/** Name the bookmark just made (bm from addBookmark), in the background. */
export async function nameBookmark(book, bm) {
  if (!book || !bm) return;
  const text = textAt(book, bm);
  if (!text) return; // nothing heard yet: keep the chapter name
  const chapter = chapterOf(bm);
  let label = aiReady() ? await aiName(book, text, chapter) : '';
  // No AI (or it failed): the chapter and the moment's telling words, not the line's first words.
  if (!label) {
    const tw = tellingWords(text.slice(-1200));
    label = tw.length ? [chapter, tw.join(', ')].filter(Boolean).join(' · ') : '';
  }
  if (!label) return;
  player.renameBookmark(book.uid, bm.createdAt, label);
  return label;
}

// Old names that were only the start of a line ("“And then he said that the…”") or the part's
// title: named again when the book's bookmarks are shown (a few at a time, in the background).
const looksPlain = (bm, book) => !bm.quote && !bm.note && (/^“.*…”$/.test(bm.label || '') || (bm.label || '') === (player.getState().tracks?.[bm.track]?.title || '\u0000') || /^bookmark$/i.test(bm.label || ''));
const tried = new Set();
export async function renamePlain(book) {
  if (!book?.uid || !aiReady()) return;
  const list = (bookmarks.get()[book.uid] || []).filter((bm) => looksPlain(bm, book) && !tried.has(`${book.uid}|${bm.createdAt}`)).slice(0, 5);
  for (const bm of list) {
    tried.add(`${book.uid}|${bm.createdAt}`);
    const text = textAt(book, bm);
    if (!text) continue;
    const label = await aiName(book, text, chapterOf(bm));
    if (label) player.renameBookmark(book.uid, bm.createdAt, label);
  }
}
