// How far back to start when you carry on after a break (seconds): 5 s after a call or a
// notification paused the book, 30 s after a pause of a couple of hours or more, else none.
// Settings → Playback → "Back a little when you carry on" (resumeRewind).
export function catchUpFor(p, now = Date.now(), cfg = {}) {
  if (!p || cfg.resumeRewind === false) return 0;
  const away = now - p.at;
  if (away < 1500) return 0;
  if (away >= (cfg.resumeLongH || 2) * 3600e3) return 30;
  if (p.call) return 5;
  return 0;
}
