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

/**
 * A title fit to search with, from a file or folder name: "The Selfish Gene Unabridged 2_005"
 * → "The Selfish Gene". Drops release words, part / disc numbers and numbered-file endings,
 * but keeps numbers that are the title ("Catch-22", "1984", "11.22.63").
 */
export function searchTitle(t) {
  const raw = String(t || '');
  const out = raw
    .replace(/\.(m4b|m4a|mp3|flac|aac|ogg|opus|epub|pdf|mobi|azw3?)$/i, '')
    .replace(/[\[{][^\]}]*[\]}]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b(part|pt|disc|disk|cd|track|file)\s*\d+\b.*$/i, ' ')
    .replace(/\b(unabridged|abridged|audiobook|audio ?book|retail|\d{2,3} ?kbps|mp3|m4b|aac|flac)\b/gi, ' ')
    .replace(/(\s\d+)?\s0\d+\s*$/, ' ') // "… 2 005", "… 01"
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–]+|[\s\-–,]+$/g, '')
    .trim();
  return mainTitle(out || raw);
}

// Degrees, titles and suffixes that end an author's name but aren't it ("Bruce H. Lipton PhD").
const NOT_SURNAME = /^(phd|ph|d|md|m\.?d|dr|prof|professor|jr|sr|ii|iii|iv|mba|msc|ma|bsc|dphil|psyd|edd|rn|esq|obe|cbe|frs|mrs|mr|ms)$/i;
/** An author's surname: the first author's last real name word (lower case), '' if none. */
export function surname(author) {
  const first = String(author || '').split(/,|&|;|\/|\band\b/)[0] || '';
  const w = first.replace(/[().]/g, ' ').split(/\s+/).filter(Boolean).filter((x) => !NOT_SURNAME.test(x.replace(/\.$/, '')));
  return (w[w.length - 1] || '').toLowerCase();
}

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


/**
 * A phone book that is this book: its title (or folder name, after an author name in front)
 * starts with this book's main title — "12 Rules for Life An Antidote to Chaos" for
 * "12 Rules for Life", but not "Beyond Order: 12 More Rules for Life" — and the author fits.
 */
export function samePhoneBook(book, c) {
  const t = words(mainTitle(searchTitle(book.title)));
  if (!t.length) return false;
  const aw = new Set(words(`${book.author || ''} ${c.author || ''}`));
  const starts = (text) => {
    const x = words(searchTitle(text));
    while (x.length && aw.has(x[0]) && x[0] !== t[0]) x.shift();
    return t.every((w, i) => x[i] === w);
  };
  if (!starts(c.title) && !starts(c.rawName || '')) return false;
  const s = surname(book.author);
  return !s || !c.author || words(`${c.author} ${c.rawName || ''}`).includes(s);
}

/**
 * Unrated copycats ("12 Rules for Life In English" by someone else) go below the real, rated
 * book whose title they borrow. New releases without ratings keep their place.
 */
const normTitle = (t) => String(t || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();
export function sinkCopycats(list) {
  const rated = list.filter((b) => b.rating > 0).map((b) => ({ t: normTitle(b.title), a: String(b.author || '').toLowerCase() }));
  const copy = (b) => !(b.rating > 0) && rated.some((r) => r.t.length > 3 && ` ${normTitle(b.title)} `.includes(` ${r.t} `) && !String(b.author || '').toLowerCase().includes(r.a.split(',')[0].trim()));
  return [...list.filter((b) => !copy(b)), ...list.filter(copy)];
}
