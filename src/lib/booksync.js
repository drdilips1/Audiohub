// Following the book by the audio's time: the maths (no app state), so it can be tested.

/** Words a second, from the last few [time, word] points (kept to a speaking range). */
export const paceOf = (pts) => {
  const tail = pts.slice(-8);
  const dt = tail[tail.length - 1][0] - tail[0][0];
  const dw = tail[tail.length - 1][1] - tail[0][1];
  return Math.min(4.5, Math.max(1.2, dt > 0 ? dw / dt : 2.5));
};

/**
 * [time, word] points in time order, kept to the longest run that moves forward through the
 * book. One line matched to a repeated phrase far ahead (or behind) is dropped, instead of it
 * throwing away every correct line after it.
 */
export function forwardRun(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  const ends = []; // ends[k]: index of the smallest last word of a run of length k+1
  const prev = [];
  for (let j = 0; j < p.length; j++) {
    let lo = 0;
    let hi = ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (p[ends[mid]][1] <= p[j][1]) lo = mid + 1;
      else hi = mid;
    }
    prev[j] = lo > 0 ? ends[lo - 1] : -1;
    ends[lo] = j;
  }
  const out = [];
  for (let j = ends.length ? ends[ends.length - 1] : -1; j >= 0; j = prev[j]) out.push(p[j]);
  return out.reverse();
}

/** The book word at an audio time, from [time, word] points (exported for tests). */
export function wordAtTime(pts, time, total) {
  const pace = paceOf(pts);
  let w;
  if (time <= pts[0][0]) w = pts[0][1] - (pts[0][0] - time) * pace;
  else if (time >= pts[pts.length - 1][0]) w = pts[pts.length - 1][1] + (time - pts[pts.length - 1][0]) * pace;
  else {
    let i = 1;
    while (pts[i][0] < time) i++;
    const [t0, w0] = pts[i - 1];
    const [t1, w1] = pts[i];
    w = t1 > t0 ? w0 + ((time - t0) / (t1 - t0)) * (w1 - w0) : w0;
  }
  return Math.max(0, Math.min(total - 1, Math.round(w)));
}


// ---- opening credits and chapter headings the recogniser mishears ---------------------
// Before the ebook's own text starts (credits, title, "Chapter One") only what was heard is
// shown, and narrators' title readings come out oddly: "Body and the saucer is stone" for
// "Harry Potter and the Sorcerer's Stone", "Shop to one" for "Chapter One".

const pairs = (s) => {
  const t = String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const m = new Map();
  for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) || 0) + 1);
  return m;
};
/** How alike two bits of text are, by letter pairs (0–1). */
export function alike(a, b) {
  const A = pairs(a);
  const B = pairs(b);
  let both = 0;
  let na = 0;
  let nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [k, v] of A) both += Math.min(v, B.get(k) || 0);
  return na + nb ? (2 * both) / (na + nb) : 0;
}

const NUMS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
// Sound-alikes the recogniser writes for small numbers.
const HEARD_NUM = { won: 1, wan: 1, to: 2, too: 2, tu: 2, tree: 3, free: 3, for: 4, fore: 4, fife: 5, sex: 6, sicks: 6, ate: 8, nein: 9, tin: 10, ten: 10 };
const numberOf = (w) => {
  const x = String(w || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^\d{1,2}$/.test(x)) return +x;
  const i = NUMS.indexOf(x);
  return i >= 0 ? i + 1 : HEARD_NUM[x] || 0;
};
// Consonant sound: "sh"/"ch" alike, c/k/q alike, vowels dropped — "shop to" ≈ "chapter".
const sound = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/sh|ch/g, 'X')
    .replace(/ph/g, 'f')
    .replace(/[ckq]/g, 'K')
    .replace(/[aeiouyhw]/g, '')
    .replace(/(.)\1+/g, '$1');
const CHAPTER = sound('chapter'); // "Xptr"
const titleCase = (w) => w[0].toUpperCase() + w.slice(1);

/**
 * A heard line that's really the book's title or a chapter heading → the book's own words;
 * anything else unchanged. `titles`: the book's title(s) (audiobook and ebook names).
 * `credits`: the line is in the opening credits (first part, before the ebook's text starts) —
 * only there is a title-like line taken as the title ("Harry looked at the stone" isn't).
 */
export function fixCredit(text, titles = [], { credits = false } = {}) {
  const t = String(text || '').trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length) return text;
  // "Chapter One": a short line ending in a number, the rest sounding like "chapter".
  if (words.length >= 2 && words.length <= 4) {
    const n = numberOf(words[words.length - 1]);
    const rest = sound(words.slice(0, -1).join(''));
    if (n && rest.length >= 3 && CHAPTER.startsWith(rest.slice(0, 4)) && rest.length <= CHAPTER.length + 1) return `Chapter ${n <= 20 ? titleCase(NUMS[n - 1]) : n}`;
  }
  // The title: alike by letters, about as long, and ending the same way.
  if (!credits) return text;
  for (const full of titles) {
    const name = String(full || '').replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/[:,]\s.*$/, '').trim(); // "(Full-Cast Edition)", subtitles off
    const nw = name.split(/\s+/).filter(Boolean);
    if (nw.length < 2 || Math.abs(nw.length - words.length) > 2) continue;
    const last = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const endsSame = last(nw[nw.length - 1]) === last(words[words.length - 1]);
    if (alike(t, name) >= (endsSame ? 0.42 : 0.6)) return name;
  }
  return text;
}
