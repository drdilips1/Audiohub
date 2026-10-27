// Press and hold on a word, then slide without lifting: the selection follows the finger,
// word by word (like Kindle) — instead of the phone's own selection, which selects one
// word and makes you drag small handles. Near the top or bottom edge the page scrolls.

const WORD = /[\p{L}\p{N}\p{M}'’\-]/u;

/** The text position under a point (node, offset), or null. */
function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && p.offsetNode?.nodeType === 3 ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r && r.startContainer.nodeType === 3 ? { node: r.startContainer, offset: r.startOffset } : null;
}

/** The word around a text position: [start, end] as (node, offset). */
function wordAt({ node, offset }) {
  const t = node.nodeValue;
  let a = Math.min(offset, t.length);
  let b = a;
  // On a space or punctuation: the word just before it.
  if (!WORD.test(t[a] || '') && a > 0 && WORD.test(t[a - 1])) a = b = a - 1;
  while (a > 0 && WORD.test(t[a - 1])) a--;
  while (b < t.length && WORD.test(t[b])) b++;
  if (b === a) b = Math.min(t.length, a + 1);
  return { node, a, b };
}

const before = (w1, w2) => {
  if (w1.node === w2.node) return w2.a < w1.a;
  return !!(w1.node.compareDocumentPosition(w2.node) & Node.DOCUMENT_POSITION_PRECEDING);
};

/**
 * Turn on press-and-drag selecting in `scroller` for text inside `rootSel`.
 * `onDone()` runs when the finger lifts with words selected. Returns a cleanup function.
 */
export function dragSelect(scroller, rootSel, { onStart, onDone, hold = 380 } = {}) {
  let timer = null;
  let start = null; // { x, y } of the touch
  let anchor = null; // the first word
  let last = null; // the finger, while selecting
  let active = false;
  let raf = 0;

  const root = () => scroller.querySelector(rootSel);
  const extendTo = (x, y) => {
    const c = caretAt(x, y);
    if (!c || !root()?.contains(c.node)) return;
    const w = wordAt(c);
    const s = window.getSelection();
    if (before(anchor, w)) s.setBaseAndExtent(anchor.node, anchor.b, w.node, w.a);
    else s.setBaseAndExtent(anchor.node, anchor.a, w.node, w.b);
  };
  // Finger near the top / bottom edge: scroll, and keep selecting under it.
  const edgeScroll = () => {
    if (!active || !last) return;
    const box = scroller.getBoundingClientRect();
    const zone = 70;
    let dy = 0;
    if (last.y < box.top + zone) dy = -Math.ceil((box.top + zone - last.y) / 6);
    else if (last.y > box.bottom - zone) dy = Math.ceil((last.y - (box.bottom - zone)) / 6);
    if (dy) {
      scroller.scrollTop += dy;
      extendTo(last.x, last.y);
    }
    raf = requestAnimationFrame(edgeScroll);
  };

  const begin = () => {
    timer = null;
    const c = caretAt(start.x, start.y);
    if (!c || !root()?.contains(c.node) || !c.node.nodeValue.trim()) return;
    anchor = wordAt(c);
    active = true;
    last = start;
    window.getSelection().setBaseAndExtent(anchor.node, anchor.a, anchor.node, anchor.b);
    navigator.vibrate?.(12);
    onStart?.();
    raf = requestAnimationFrame(edgeScroll);
  };
  const onTouchStart = (e) => {
    if (e.touches.length !== 1 || e.target.closest?.('a, button, mark.hl')) return;
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY };
    clearTimeout(timer);
    timer = setTimeout(begin, hold);
  };
  const onTouchMove = (e) => {
    const t = e.touches[0];
    if (!active) {
      // Moved before the hold: it's a scroll.
      if (timer && start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) {
        clearTimeout(timer);
        timer = null;
      }
      return;
    }
    e.preventDefault(); // selecting, not scrolling
    last = { x: t.clientX, y: t.clientY };
    extendTo(last.x, last.y);
  };
  const finish = (e) => {
    clearTimeout(timer);
    timer = null;
    if (!active) return;
    active = false;
    cancelAnimationFrame(raf);
    e?.preventDefault?.(); // no click (page turn) after selecting
    onDone?.();
  };
  // The phone's own long-press selection: not here (this replaces it).
  const onContext = (e) => {
    if (root()?.contains(e.target)) e.preventDefault();
  };

  scroller.addEventListener('touchstart', onTouchStart, { passive: true });
  scroller.addEventListener('touchmove', onTouchMove, { passive: false });
  scroller.addEventListener('touchend', finish);
  scroller.addEventListener('touchcancel', finish);
  scroller.addEventListener('contextmenu', onContext);
  return () => {
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    scroller.removeEventListener('touchstart', onTouchStart);
    scroller.removeEventListener('touchmove', onTouchMove);
    scroller.removeEventListener('touchend', finish);
    scroller.removeEventListener('touchcancel', finish);
    scroller.removeEventListener('contextmenu', onContext);
  };
}
