// Icons that move: play ⇄ pause (one shape turning into the other) and download (a ring
// filling with the parts saved, then the arrow turns into a tick).

/** Play and pause as one shape: two halves that meet in a triangle or part into two bars. */
const PLAY = 'M7 4.5 L13 8.25 L13 15.75 L7 19.5 Z M13 8.25 L19 12 L19 12 L13 15.75 Z';
const PAUSE = 'M6 4.5 L10 4.5 L10 19.5 L6 19.5 Z M14 4.5 L18 4.5 L18 19.5 L14 19.5 Z';
export function PlayPauseIcon({ playing, size = 24 }) {
  return (
    <svg class="mo-pp" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={playing ? PAUSE : PLAY} style={{ d: `path("${playing ? PAUSE : PLAY}")` }} fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
    </svg>
  );
}

/** Download: arrow; while saving, a ring fills with the parts done; once saved, a tick draws itself. */
export function DownloadIcon({ dl, size = 20 }) {
  const status = dl?.status;
  const pct = status === 'done' ? 1 : dl?.total ? Math.min(1, (dl.done || 0) / dl.total) : 0.08;
  return (
    <span class={'mo-dl' + (status === 'downloading' ? ' going' : '') + (status === 'done' ? ' done' : '')} style={{ width: size + 8, height: size + 8 }}>
      {status === 'downloading' && (
        <svg class="mo-dl-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="16" class="bg" />
          <circle cx="18" cy="18" r="16" class="on" style={{ strokeDashoffset: 100.5 * (1 - pct) }} />
        </svg>
      )}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        {status === 'done' ? <path class="mo-tick" d="M5.5 12.5l4.2 4.2L18.5 8" /> : <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />}
      </svg>
    </span>
  );
}
