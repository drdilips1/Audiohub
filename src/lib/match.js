// Loose title matching: ignores punctuation, accents, case, small words and
// release noise, so "Rich Dad, Poor Dad" matches "Kiyosaki - Rich Dad Poor Dad (2017) [MP3]".
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'by', 'with', 'le', 'la', 'de', 'der', 'die', 'das']);

export function words(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w));
}

// Main title only: drop subtitles ("Dune: Deluxe Edition") and series tags ("(Dune #1)").
export const mainTitle = (t) => String(t || '').replace(/\s*[:(\[].*$/, '').trim() || String(t || '');

/** true when every significant word of `query` appears in `text`. */
export function matches(query, text) {
  const q = words(query);
  if (!q.length) return false;
  const hay = new Set(words(text));
  return q.every((w) => hay.has(w) || (w.length > 3 && [...hay].some((h) => h.startsWith(w))));
}

// Release details that say nothing about which book it is.
const NOISE = /^(\d+|\d+kbps|kbps|mp3|m4b|m4a|aac|flac|opus|epub|pdf|mobi|azw3|audiobook|audio|book|ebook|unabridged|abridged|retail|vbr|cbr|read|narrated|english|eng|web|dl|rip|cd|part|pt|vol|volume|edition|complete|series|full|cast)$/;

/**
 * Another book whose name contains this title ("The Greatest Secret" for "The Secret",
 * "Golden Son … Red Rising Trilogy" or "Morning Star (Red Rising #3)" for "Red Rising"):
 * the title's words aren't together, or other words come before them (besides the
 * author's name, a year or release details).
 */
export function otherBook(resultTitle, title, author) {
  const tw = new Set(words(mainTitle(title)));
  const authorWords = new Set(words(author));
  // Release details, numbers and the author's name don't count ("Harry Potter 6 - Half-Blood Prince").
  const tokens = words(resultTitle).filter((w) => !authorWords.has(w) && !NOISE.test(w) && !/^\d+$/.test(w));
  const want = [...tw].filter((w) => !NOISE.test(w) && !/^\d+$/.test(w));
  if (!want.length) return false;
  const same = (a, b) => a === b || (b.length > 3 && a.startsWith(b));
  for (let p = 0; p + want.length <= tokens.length; p++) {
    if (!want.every((w, k) => same(tokens[p + k], w))) continue;
    if (p > 0) return true;
    // A short title followed straight on by another word ("Dune Messiah", "The Secret Daily
    // Teachings"): another book. A subtitle comes after ":", "-", "(" (or "by" the author).
    if (want.length <= 2) {
      const flat = String(resultTitle).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(want.map((w) => esc(w) + '[a-z0-9]*').join('(?:[^a-z0-9]+(?:the|a|an|of|and|to|in))*[^a-z0-9]+')).exec(flat);
      if (m) {
        const rest = flat.slice(m.index + m[0].length);
        const next = /^\s+([a-z]+)/.exec(rest)?.[1];
        if (next && !authorWords.has(next) && !NOISE.test(next) && !/^(by|read|narrated|written|unabridged|abridged|audiobook|audio|book|ebook|epub|mp3|m4b|the|a|an|of|and|to|in|on|for|with|from)$/.test(next)) return true;
      }
    }
    return false;
  }
  return true; // the words are there, but not together: another title
}

