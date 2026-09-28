import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';

const THRESHOLD = 72;

/** Pull down from the top of the page to refresh. Calls onRefresh() (may return a promise). */
export function PullToRefresh({ onRefresh, enabled = true }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    const down = (e) => {
      if (busy || window.scrollY > 2 || e.touches.length !== 1) return (start.current = null);
      if (e.target.closest('.full-player,.sheet,.reader,input,textarea,select,.row-scroll')) return (start.current = null);
      start.current = e.touches[0].clientY;
    };
    const move = (e) => {
      if (start.current == null) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0 || window.scrollY > 2) return setPull(0);
      setPull(Math.min(120, dy * 0.5));
    };
    const up = async () => {
      if (start.current == null) return;
      start.current = null;
      setPull((p) => {
        if (p >= THRESHOLD) {
          setBusy(true);
          Promise.resolve(onRefresh())
            .catch(() => {})
            .finally(() => setTimeout(() => setBusy(false), 500));
        }
        return 0;
      });
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', up);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', up);
    };
  }, [enabled, busy, onRefresh]);

  if (!pull && !busy) return null;
  const ready = pull >= THRESHOLD;
  return (
    <div class="ptr" style={{ transform: `translate(-50%, ${busy ? 64 : Math.max(0, pull - 20)}px)` }}>
      <div class={'ptr-dot' + (ready || busy ? ' ready' : '')} style={busy ? null : { transform: `rotate(${pull * 3}deg)` }}>
        {busy ? <span class="spinner small" /> : <Icon name="down" size={18} />}
      </div>
    </div>
  );
}
