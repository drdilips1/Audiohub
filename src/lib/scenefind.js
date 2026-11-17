// Finding a scene in the book's own words (its ebook), then the same moment in the audio.
// The AI names a few distinctive words of the scene ("Dumbledore", "House Cup", "points");
// the passage where they gather is the scene. The ebook's chapter headings, matched to the
// audiobook's chapter titles, tie a place in the text to a time in the audio.

const STOP = new Set('the a an and or of to in on at by for with from as is was were be been his her he she they them their it its that this then than but not no so up out into over who what when where which while had has have did do does said says will would could should'.split(' '));
const GENERIC = new Set(['chapter', 'part', 'track', 'disc', 'cd', 'book', 'section', 'volume', 'vol', 'unabridged', 'audiobook', 'mp3', 'm4b']);
const norm = (s) => String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'\s]/gu, ' ').split(/\s+/).filter(Boolean);

const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** 17 → ['seventeen'], 42 → ['forty', 'two'] (how a heading spells it out). */
function numberWords(n) {
  if (n < 20) return [ONES[n]];
  if (n < 100) return n % 10 ? [TENS[Math.floor(n / 10)], ONES[n % 10]] : [TENS[n / 10]];
  return [String(n)];
}

/** How a heading may give chapter n: "chapter 27", "chapter twenty seven", "chapter twenty-seven" (one word in the index). */
function numberHeads(n) {
  if (!(n > 0)) return [];
  const w = numberWords(n);
  const out = [['chapter', String(n)], ['chapter', ...w]];
  if (w.length > 1) out.push(['chapter', w.join('')]);
  return out;
}
const NUMBER_WORD = /^(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(one|two|three|four|five|six|seven|eight|nine)?)$/;

/** Every position where these words come one after another in the book. */
function phraseAt(keys, words) {
  const out = [];
  if (!words.length) return out;
  for (let i = 0; i + words.length <= keys.length; i++) {
    let ok = true;
    for (let k = 0; k < words.length && ok; k++) ok = keys[i + k] === words[k] || keys[i + k].replace(/-/g, '') === words[k];
    if (ok) out.push(i);
  }
  return out;
}

/** How the ebook might spell a chapter's heading: its own words, or "chapter 17" / "chapter seventeen". */
function headingVariants(title, bookTitle) {
  // "Harry Potter and the Philosopher's Stone - 04 - The Man with Two Faces": the part that
  // isn't the book's name or a number is the chapter's own title.
  const bookWords = new Set(norm(bookTitle));
  const parts = String(title).split(/\s+[-–—:|]\s+|_/).map((p) => norm(p).filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w)));
  const own = parts.filter((w) => w.length >= 2 && w.filter((x) => !bookWords.has(x)).length >= Math.ceil(w.length / 2)).pop();
  const out = [];
  if (own) out.push(own);
  const n = (String(title).match(/(\d+)(?!.*\d)/) || [])[1];
  if (n && +n < 200) out.push(...numberHeads(+n));
  return out;
}

/**
 * Places in the text tied to times in the audio: [{ tok, g }], in order. Contents pages list
 * every heading close together — those are skipped (a heading counts only when the next
 * chapter's heading comes well after it).
 */
export const STOPWORDS = STOP;
export function anchorsFor(bt, chapters, total, bookTitle, from = 0) {
  const keys = bt.keys;
  const occ = chapters.map((c) => [...new Set(headingVariants(c.title || '', bookTitle).flatMap((v) => phraseAt(keys, v)))].sort((a, b) => a - b));
  // `from`: where this book starts in the audio (a series in one audiobook: its own parts only).
  const anchors = [{ tok: 0, g: from }];
  let pos = 0;
  for (let i = 0; i < chapters.length; i++) {
    const next = occ.slice(i + 1).find((o) => o.length);
    const cands = occ[i].filter((t) => t > pos);
    let pick = null;
    if (!next) pick = cands[cands.length - 1] ?? null;
    else
      for (const t of cands) {
        const after = next.find((x) => x > t);
        if (after == null || after - t > 300) {
          pick = t;
          break;
        }
      }
    if (pick != null && chapters[i].start > anchors[anchors.length - 1].g) {
      anchors.push({ tok: pick, g: chapters[i].start });
      pos = pick;
    }
  }
  // Audio chapters with only numbers for names ("Track 01", "Part 3", "05") — their numbers
  // needn't be the book's (an opening-credits track shifts them all) — or few headings matched
  // by name: pair the ebook's own chapter headings with the audio's chapters in order, when
  // the counts agree (allowing an opening-credits part and an end-credits part in the audio).
  const bookWords = new Set(norm(bookTitle));
  const numbered = chapters.filter((c) => !norm(c.title).some((w) => !GENERIC.has(w) && !/^\d+$/.test(w) && !bookWords.has(w))).length >= chapters.length * 0.7;
  if (numbered || anchors.length - 1 < Math.max(2, Math.ceil(chapters.length * 0.3))) {
    const heads = headingsInText(bt).filter((t) => t >= (numbered ? 0 : anchors[anchors.length - 1]?.tok || 0));
    const diff = chapters.length - heads.length;
    if (heads.length >= 3 && diff >= 0 && diff <= 2) {
      const off = diff; // audio parts before the first heading (credits, intro)
      const paired = [{ tok: 0, g: from }];
      for (let i = 0; i < heads.length; i++) {
        const c = chapters[i + off];
        if (c && c.start > paired[paired.length - 1].g && heads[i] > paired[paired.length - 1].tok) paired.push({ tok: heads[i], g: c.start });
      }
      if (numbered ? paired.length >= heads.length : paired.length > anchors.length) {
        paired.push({ tok: storyEnd(keys, paired[paired.length - 1].tok), g: total });
        return paired;
      }
    }
  }
  anchors.push({ tok: storyEnd(keys, anchors[anchors.length - 1].tok), g: total });
  return anchors;
}

const NUMWORD = { test: (w) => NUMBER_WORD.test(w || '') || /^[ivxlc]+$/.test(w || '') };
/**
 * The ebook's real chapter headings in order ("Chapter 1", "Chapter Seven", "Prologue",
 * "Epilogue"), skipping the contents pages (where headings come one after another).
 */
export function headingsInText(bt) {
  const keys = bt.keys;
  const at = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const w = keys[i];
    if ((w === 'chapter' && NUMWORD.test(keys[i + 1])) || ((w === 'prologue' || w === 'epilogue') && (i === 0 || !/^(the|a|this|his|her|of)$/.test(keys[i - 1])))) at.push(i);
  }
  // A real heading has a good stretch of text before the next one.
  return at.filter((t, k) => (at[k + 1] ?? keys.length) - t > 250);
}

/**
 * Where a remembered line is in the book: the first run of `n` of its words (in order) found
 * in the text, longest run first. null when no run of at least 4 words is there.
 */
export function quoteAt(bt, quote, from = 0, to = Infinity) {
  const q = norm(quote);
  if (q.length < 6) return null;
  const keys = bt.keys;
  const hi = Math.min(keys.length, to);
  // Not the title pages and contents (a run like "Harry Potter and the …" is there too): from
  // the first real chapter heading, or past the first 2% of the book.
  const heads = headingsInText(bt);
  const start = Math.max(from, heads.length ? heads[0] : Math.floor(keys.length * 0.02));
  // At least six words in a row, three of them telling (a few common words match anywhere).
  for (let n = Math.min(10, q.length); n >= 6; n--)
    for (let s = 0; s + n <= q.length; s++) {
      const run = q.slice(s, s + n);
      if (run.filter((w) => !STOP.has(w)).length < 3) continue;
      for (let i = Math.max(0, start); i + n <= hi; i++) {
        let ok = true;
        for (let k = 0; k < n && ok; k++) ok = keys[i + k] === run[k];
        if (ok) return i;
      }
    }
  return null;
}

/** The audio time of a place in the text (between the nearest anchors, in proportion). */
export function timeOf(anchors, tok) {
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1];
    const b = anchors[i];
    if (tok <= b.tok) return a.g + ((tok - a.tok) / Math.max(1, b.tok - a.tok)) * (b.g - a.g);
  }
  return anchors[anchors.length - 1].g;
}

/**
 * Where the scene starts in the text (a word position), from its distinctive words — the
 * 300-word stretch where most of them gather (rare words count more). `range` [from, to]
 * (the chapter the AI named, when known) is preferred. null when the words aren't there.
 */
export function sceneInText(bt, keywords, range = null, { strict = false, target = null, details = null } = {}) {
  const keys = bt.keys;
  const want = [...new Set((keywords || []).flatMap((k) => norm(k)).filter((w) => w.length > 2 && !STOP.has(w)))];
  if (want.length < 2) return null;
  // How rare each word is, in the whole book (a name on every page tells little).
  const count = new Map(want.map((w) => [w, 0]));
  for (const k of keys) if (count.has(k)) count.set(k, count.get(k) + 1);
  const weight = new Map([...count].filter(([, c]) => c > 0).map(([w, c]) => [w, 1 / Math.log(2 + c)]));
  if (weight.size < 2) return null;
  const W = 300;
  // strict: only inside the range (the chapter the AI named).
  const lo = strict && range ? Math.max(0, range[0]) : 0;
  const hi = strict && range ? Math.min(keys.length, range[1]) : keys.length;
  const inWin = new Map();
  let score = 0;
  let distinct = 0;
  let best = null;
  const addTok = (w, d) => {
    if (!weight.has(w)) return;
    const n = (inWin.get(w) || 0) + d;
    inWin.set(w, n);
    if (d > 0 && n === 1) (score += weight.get(w)), distinct++;
    if (d < 0 && n === 0) (score -= weight.get(w)), distinct--;
  };
  for (let i = lo; i < hi; i++) {
    addTok(keys[i], 1);
    if (i - lo >= W) addTok(keys[i - W], -1);
    const start = Math.max(lo, i - W + 1);
    let s = score * (!strict && range && start >= range[0] && start < range[1] ? 1.25 : 1);
    // Where in the chapter the AI said it is: nearer counts a little more.
    if (target != null && range) s *= 1 + 0.35 * Math.max(0, 1 - Math.abs(start - target) / Math.max(1, range[1] - range[0]));
    if (distinct >= 2 && (!best || s > best.s + 1e-9)) best = { s, start, distinct };
  }
  if (!best || best.distinct < Math.min(2, weight.size)) return null;
  // Names of more than one word ("House Cup", "Mirror of Erised"): where they appear as a
  // phrase is a much surer sign — prefer the best stretch that holds one, when it's close.
  const phrases = (keywords || []).map((k) => norm(k).filter((w) => !STOP.has(w) || norm(k).length <= 3)).filter((p) => p.length >= 2);
  if (phrases.length) {
    let pBest = null;
    for (const ph of phrases)
      for (const at of phraseAt(keys, ph)) {
        if (at < lo || at >= hi) continue;
        // Score the stretch starting a little before the phrase.
        const st = Math.max(lo, at - 60);
        const seen = new Set();
        let sc = 0;
        for (let i = st; i < Math.min(hi, st + W); i++) if (weight.has(keys[i]) && !seen.has(keys[i])) (seen.add(keys[i]), (sc += weight.get(keys[i])));
        sc *= 1.6; // a phrase match is worth a lot
        if (target != null && range) sc *= 1 + 0.35 * Math.max(0, 1 - Math.abs(st - target) / Math.max(1, range[1] - range[0]));
        if (!pBest || sc > pBest.sc) pBest = { sc, at, distinct: seen.size };
      }
    if (pBest && pBest.distinct >= 2 && pBest.sc >= best.s * 0.9) {
      if (details) details.hit = { s: pBest.sc, distinct: pBest.distinct, phrase: true };
      return pBest.at;
    }
  }
  // Where in that 300-word stretch (about two minutes of audio) the scene is: the densest
  // 80 words of its telling words — not the first one that happens to appear, which put the
  // start up to a couple of minutes early.
  let tok = best.start;
  {
    const S = 80;
    const end = Math.min(keys.length, best.start + W);
    let bestS = -1;
    for (let i = best.start; i < end; i++) {
      if (!weight.has(keys[i])) continue;
      const seen = new Set();
      let sc = 0;
      for (let k = i; k < Math.min(end, i + S); k++) if (weight.has(keys[k]) && !seen.has(keys[k])) (seen.add(keys[k]), (sc += weight.get(keys[k])));
      if (sc > bestS + 1e-9) (bestS = sc), (tok = i);
    }
  }
  if (details) details.hit = { s: best.s, distinct: best.distinct };
  return tok;
}

/**
 * The chapter the AI named, found in the ebook by its heading ("Chapter Twelve", "12",
 * "The Mirror of Erised"): [start, end] word positions, or null. The contents pages list
 * every heading close together, so a heading counts only with real text after it.
 */
export function chapterRange(bt, chapter, chapterTitle) {
  const keys = bt.keys;
  const n = Number(chapter) || 0;
  const title = norm(chapterTitle).filter((w) => !GENERIC.has(w));
  const heads = (k, words) => {
    const at = [...new Set(numberHeads(k).flatMap((v) => phraseAt(keys, v)))];
    // A number heading with the title just after it is the surest; the title alone next.
    if (words.length >= 2) {
      const tAt = phraseAt(keys, words);
      const both = at.filter((p) => tAt.some((t) => t > p && t - p < 12));
      if (both.length) return both;
      if (!at.length) return tAt;
    }
    return at;
  };
  // Real headings: not followed by another chapter heading within a few hundred words (contents pages).
  const real = (p) => !keys.slice(p + 3, p + 300).some((w, i, a) => w === 'chapter' && /^(\d+|[a-z]+)$/.test(a[i + 1] || ''));
  const starts = heads(n, title).sort((a, b) => a - b).filter(real);
  if (!starts.length) return null;
  const start = starts[0];
  // The end: the next chapter's heading, else the next "Chapter …" after a good stretch.
  let end = keys.length;
  const next = n > 0 ? heads(n + 1, []).filter((p) => p > start + 300).sort((a, b) => a - b)[0] : null;
  if (next != null) end = next;
  else
    for (let i = start + 500; i < keys.length - 1; i++)
      if (keys[i] === 'chapter' && NUMBER_WORD.test(keys[i + 1])) {
        end = i;
        break;
      }
  // The last chapter: it ends where the back matter starts (acknowledgements, about the author,
  // also by…), not at the end of the file — else its end was stretched over the back pages.
  if (next == null) end = Math.min(end, backMatterAfter(keys, start + 500) ?? end);
  return [start, end];
}

/** Where the story's words end: the back pages after the last chapter, else the end of the text. */
const storyEnd = (keys, lastTok) => backMatterAfter(keys, lastTok + 500) ?? keys.length;

/** Where the book's back pages begin after `from` (word position), or null. */
export function backMatterAfter(keys, from) {
  const at = (i, ...w) => w.every((x, k) => keys[i + k] === x);
  for (let i = Math.max(0, from); i < keys.length - 2; i++) {
    const w = keys[i];
    if (w === 'acknowledgements' || w === 'acknowledgments' || w === 'afterword' || at(i, 'about', 'the', 'author') || at(i, 'also', 'by') || at(i, 'the', 'end') || at(i, 'reading', 'group', 'guide')) return i;
  }
  return null;
}

/** The chapter the AI named, as a stretch of the text (between its anchor and the next). */
export function rangeOf(anchors, chapters, ci) {
  if (ci < 0 || !chapters[ci]) return null;
  const a = anchors.find((x) => x.g === chapters[ci].start);
  if (!a) return null;
  const b = anchors.find((x) => x.tok > a.tok);
  return [a.tok, b ? b.tok : Infinity];
}

/** Where the chapter holding a place in the text begins (its heading), or null. */
export function chapterStartBefore(bt, tok) {
  const keys = bt.keys;
  const isNum = (w) => NUMBER_WORD.test(w || '');
  for (let i = Math.min(tok, keys.length - 2); i >= 0; i--) {
    if (keys[i] !== 'chapter' || !isNum(keys[i + 1])) continue;
    // Not the contents pages: a real heading has text after it, not another heading.
    if (!keys.slice(i + 3, i + 300).some((w, k, a) => w === 'chapter' && isNum(a[k + 1]))) return i;
  }
  return null;
}

/**
 * A stretch of the text cut into numbered passages of about `size` words, each starting at a
 * paragraph where it can (for the AI to read and say where a scene starts). A stretch longer
 * than `max` words is cut down around `near`.
 */
export function passagesOf(bt, range, { size = 90, max = 6500, near = null } = {}) {
  let [lo, hi] = range;
  hi = Math.min(bt.tokens.length, hi);
  lo = Math.max(0, lo);
  if (hi - lo > max) {
    const mid = near != null && near >= lo && near < hi ? near : (lo + hi) >> 1;
    lo = Math.max(lo, Math.min(hi - max, mid - (max >> 1)));
    hi = lo + max;
  }
  const paraStarts = new Set(bt.starts || []);
  const out = [];
  let i = lo;
  while (i < hi) {
    let end = Math.min(hi, i + size);
    // End at a paragraph start nearby (up to 40 words on), so passages read whole.
    for (let k = end; k < Math.min(hi, end + 40); k++)
      if (paraStarts.has(k)) {
        end = k;
        break;
      }
    out.push({ tok: i, text: bt.tokens.slice(i, end).join(' ') });
    i = end;
  }
  return out;
}
