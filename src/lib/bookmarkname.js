// Bookmarks that say what was happening ("Harry and Ron argue on the train"), not just
// "Chapter 3 · 12:43": named from the transcript around that moment — by your AI service
// when one is set up, else from the words themselves.
import { heardText } from './transcript.js';
import { aiReady, askAi } from './ai.js';
import * as player from './player.js';

const words = (s, n) => s.split(/\s+/).filter(Boolean).slice(0, n).join(' ');

/** Name the bookmark just made (bm from addBookmark), in the background. */
export async function nameBookmark(book, bm) {
  if (!book || !bm) return;
  const text = heardText(book.uid, bm.track, bm.time + 5, 1500).replace(/^…/, '').trim();
  if (text.split(/\s+/).length < 8) return; // nothing heard yet: keep the chapter name
  const tail = text.slice(-700);
  let label = '';
  if (aiReady()) {
    try {
      label = (await askAi(`From the audiobook "${book.title}". Here is what was just said:\n"""${tail}"""\nName this moment for a bookmark in 3 to 7 words (like "Harry and Ron argue on the train" or "Checklist for a marketing plan"). Reply with the name only, no quotes.`))
        .split('\n')[0]
        .replace(/^["'*\s]+|["'*.\s]+$/g, '')
        .slice(0, 70);
    } catch {}
  }
  // No AI: the start of the last sentence heard.
  if (!label) {
    const last = tail.split(/(?<=[.!?])\s+/).filter((s) => s.split(/\s+/).length >= 4).pop() || tail;
    label = '“' + words(last, 8) + '…”';
  }
  player.renameBookmark(book.uid, bm.createdAt, label);
  return label;
}
