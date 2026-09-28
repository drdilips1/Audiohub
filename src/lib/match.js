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
