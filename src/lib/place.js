// Your place in a book, as plain arithmetic (no player state), so it can be tested:
// part lengths before they're known, the same point in another copy of the book, and
// the server's place in this copy's time. The player (lib/player.js) uses these.

/**
 * A part's length. Known once it has played; until then estimated from its file size at
 * the rate of the parts already played, else as their average — so "% of book" and
 * "time left" cover the whole book, not one file. 0 when nothing has played yet.
 */
export function estimateDuration(tracks, i) {
  const t = tracks[i];
  if (!t) return 0;
  if (t.duration > 0) return t.duration;
  const known = tracks.filter((x) => x.duration > 0);
  if (!known.length) return 0;
  const sized = known.filter((x) => x.size > 0);
  if (t.size > 0 && sized.length) return (t.size * sized.reduce((a, x) => a + x.duration, 0)) / sized.reduce((a, x) => a + x.size, 0);
  return known.reduce((a, x) => a + x.duration, 0) / known.length;
}

/**
 * Switched to another copy (another edition, another length): the same point by how far
 * through you were, never past its end. `g` is the saved place in seconds, `percent` how
 * far through (0–1), `whole` this copy's length. Returns the place to start from.
 */
export function copyPlace(g, percent, whole) {
  if (g != null && percent > 0 && whole > 0 && (g > whole - 30 || Math.abs(g / whole - percent) > 0.06)) return Math.min(percent, 0.995) * whole;
  return g;
}

/**
 * The parts' lengths aren't known yet (a cloud copy before it loads): the part to open and
 * how far into it (0–1), by how far through you were. By the files' sizes when every part
 * has one (a bigger part is a longer part), else as equal parts.
 */
export function partByPercent(percent, tracks) {
  const pc = Math.min(percent, 0.995);
  const sizes = tracks.map((x) => Number(x.size) || 0);
  const totalSize = sizes.reduce((a, b) => a + b, 0);
  if (sizes.every((x) => x > 0)) {
    let left = pc * totalSize;
    let k = 0;
    while (k < sizes.length - 1 && left >= sizes[k]) left -= sizes[k++];
    return { i: k, frac: left / sizes[k] };
  }
  const x = pc * tracks.length;
  const i = Math.min(tracks.length - 1, Math.floor(x));
  return { i, frac: x - i };
}

/** The server's place in this copy's time: the same when the lengths match, scaled when
 *  they're close (a few seconds of intro), null for another edition (too different). */
export function fitted(place, total) {
  if (!place || !(place.time >= 0)) return null;
  if (!place.duration || !total) return place.time;
  const k = total / place.duration;
  return Math.abs(1 - k) > 0.06 ? null : place.time * k;
}
