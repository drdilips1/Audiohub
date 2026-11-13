// Book check for multipart audiobooks (phone folders, TorBox / Real-Debrid): parts played in
// the order of their numbers (not the file dates), duplicate copies of a part skipped, and
// parts missing from the numbering noticed — so a gap is said, not jumped silently.

const AUDIO_EXT = /\.(mp3|m4b|m4a|aac|ogg|oga|opus|flac|wav|wma|mka)$/i;
// "Part 03 (1).mp3", "Part 11 copy.mp3", "03 - Chapter-1.mp3" (a second download of a file).
const COPY_MARK = /(\s*\(\d\)|\s*[-_ ]copy(\s*\d+)?|\s*-\s*\d{1,2}(?=$))$/i;

const nameOf = (t) => String(t?.name || t?.title || '').replace(AUDIO_EXT, '').trim();
/** A name without what a second download adds: "Part 03 (1)" → "part 03". */
const baseName = (n) => n.replace(COPY_MARK, '').replace(/\s+/g, ' ').trim().toLowerCase();
const hasCopyMark = (n) => /\(\d\)$|[-_ ]copy(\s*\d+)?$/i.test(n);

/**
 * The part number of each name, when the names are numbered: the number in the same place in
 * every name that changes from file to file (03 in "Book Title 03", 7 in "CD1 - Track 7").
 * Returns numbers (or null for every name when there's no clear numbering).
 */
export function partNumbers(names) {
  const groups = names.map((n) => (n.match(/\d+/g) || []).map(Number));
  if (names.length < 3 || groups.some((g) => !g.length)) return names.map(() => null);
  // Try each place from the end (the part number is usually last), then from the start.
  const tries = [];
  const maxLen = Math.max(...groups.map((g) => g.length));
  for (let k = 1; k <= maxLen; k++) tries.push((g) => g[g.length - k]);
  for (let k = 0; k < maxLen; k++) tries.push((g) => g[k]);
  for (const pick of tries) {
    const nums = groups.map(pick);
    if (nums.some((x) => x == null || x > 2000)) continue;
    const distinct = new Set(nums).size;
    // Mostly different (a duplicate or two allowed), and not all the same.
    if (distinct >= Math.max(3, Math.ceil(names.length * 0.75))) return nums;
  }
  return names.map(() => null);
}

/**
 * Check a book's parts: { tracks, note } — tracks in order with duplicates left out (indexes
 * renumbered), note = { missing: [numbers], dupes: [names], reordered, gapBefore: { index: [numbers] } }
 * or null when there was nothing to say. `keep`: leave the order and every part as they are
 * (a book you're in the middle of: its saved place is a part number) — only report.
 */
export function checkParts(tracks, { keep = false } = {}) {
  if (!Array.isArray(tracks) || tracks.length < 3) return { tracks, note: null };
  const names = tracks.map(nameOf);
  // Numbers read from the names without a copy's mark ("Part 06 (1)" is part 6).
  const nums = partNumbers(names.map(baseName));
  const numbered = nums.every((n) => n != null);
  const items = tracks.map((t, i) => ({ t, i, name: names[i], base: baseName(names[i]), n: nums[i] }));

  // Duplicates: a copy-marked name whose plain name is here too, or the same number and size.
  const dupes = new Set();
  const byBase = new Map();
  for (const it of items) if (!hasCopyMark(it.name)) byBase.set(it.base, it);
  for (const it of items) {
    const orig = hasCopyMark(it.name) && byBase.get(it.base);
    if (orig && orig !== it) dupes.add(it.i);
  }
  if (numbered) {
    const seen = new Map();
    for (const it of items) {
      if (dupes.has(it.i)) continue;
      const prev = seen.get(it.n);
      const sameSize = prev && prev.t.size && it.t.size && Math.abs(prev.t.size - it.t.size) < 1024;
      const sameLen = prev && prev.t.duration && it.t.duration && Math.abs(prev.t.duration - it.t.duration) < 1.5;
      if (prev && (sameSize || sameLen)) dupes.add(it.i);
      else if (!prev) seen.set(it.n, it);
    }
  }

  let kept = items.filter((it) => !dupes.has(it.i));
  let reordered = false;
  if (numbered) {
    const sorted = [...kept].sort((a, b) => a.n - b.n || a.i - b.i);
    reordered = sorted.some((it, k) => it !== kept[k]);
    if (!keep) kept = sorted;
  }

  // Missing: holes in the numbering (small ones — a big jump is more likely another scheme).
  const missing = [];
  const gapBefore = {};
  if (numbered) {
    const order = [...kept].sort((a, b) => a.n - b.n);
    const first = order[0].n;
    if (first === 2) missing.push(1);
    for (let k = 1; k < order.length; k++) {
      const gap = order[k].n - order[k - 1].n;
      if (gap > 1 && gap <= 6) {
        const hole = [];
        for (let x = order[k - 1].n + 1; x < order[k].n; x++) hole.push(x);
        missing.push(...hole);
        gapBefore[order[k].i] = hole;
      }
    }
  }
  const out = keep ? tracks : kept.map((it, k) => ({ ...it.t, index: k }));
  // Where each gap now falls (the part after it, by its new place in the list).
  const gapAt = {};
  for (const [origIdx, hole] of Object.entries(gapBefore)) {
    const k = keep ? Number(origIdx) : kept.findIndex((it) => it.i === Number(origIdx));
    if (k >= 0) gapAt[k] = hole;
  }
  const dupeNames = [...dupes].map((i) => names[i]);
  const note = missing.length || dupeNames.length || reordered ? { missing, dupes: keep ? [] : dupeNames, dupesFound: dupeNames, reordered: reordered && !keep, outOfOrder: reordered, gapBefore: gapAt, kept: keep } : null;
  return { tracks: out, note };
}
