// Motion: small, quiet animations (the cover breathing while it plays, play ⇄ pause, a ripple
// on skip, sparks on a like, the cover growing into the player, a moon for the sleep timer…).
// Settings → Appearance → Motion: Off / Gentle (default) / Full. Off — or the phone's own
// "reduce motion" with Gentle — keeps everything still. Only transform / opacity move (cheap),
// and the endless ones pause while the app is in the background.
import { settings } from './store.js';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 'off' | 'gentle' | 'full' — what the app does now. */
export function motionLevel() {
  const m = settings.get().motion || 'gentle';
  if (m === 'off') return 'off';
  if (m === 'gentle' && reduced()) return 'off';
  return m;
}
const apply = () => typeof document !== 'undefined' && (document.documentElement.dataset.motion = motionLevel());
if (typeof document !== 'undefined') {
  apply();
  settings.subscribe(apply);
  try {
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', apply);
  } catch {}
  // Nothing animates while you can't see it.
  document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('app-hidden', document.visibilityState === 'hidden'));
}
const on = () => motionLevel() !== 'off';

/** Two rings spreading out from a button (skip 15 / 30), and the icon gives a small turn. */
export function ripple(el) {
  if (!el || !on()) return;
  for (const delay of [0, 120]) {
    const r = document.createElement('span');
    r.className = 'mo-ripple';
    r.style.animationDelay = `${delay}ms`;
    el.appendChild(r);
    setTimeout(() => r.remove(), 800);
  }
  el.classList.remove('mo-turn');
  void el.offsetWidth;
  el.classList.add('mo-turn');
}

/** A quick squash-and-bounce (the play button). */
export function squash(el) {
  if (!el || !on()) return;
  el.classList.remove('mo-squash');
  void el.offsetWidth;
  el.classList.add('mo-squash');
}

/** A few sparks flying out of a button (a like, Read later). */
export function burst(el) {
  if (!el || !on()) return;
  const n = motionLevel() === 'full' ? 16 : 12;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.className = 'mo-spark' + (i % 2 ? ' alt' : '');
    s.style.setProperty('--a', `${(i * 360) / n}deg`);
    el.appendChild(s);
    setTimeout(() => s.remove(), 650);
  }
}

/**
 * The cover grows from where it was tapped (the mini player) into the big player cover:
 * a copy of the picture, already the big cover's size, starts shrunk onto the small one and
 * grows into place — moved and scaled only (the phone's graphics chip does that smoothly;
 * changing its size every frame made the page re-layout and stutter).
 */
export function openFrom(fromEl, open) {
  const img = fromEl?.querySelector('img');
  if (!fromEl || !on()) return open();
  const from = fromEl.getBoundingClientRect();
  const src = img?.currentSrc || img?.src || '';
  document.documentElement.classList.add('mo-opening');
  open();
  // The player is on screen after the next frame: measure where the big cover is, then fly.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const to = document.querySelector('.full-player .fp-ring')?.getBoundingClientRect();
      if (!to || !to.width || !from.width) return done(null);
      const fly = document.createElement('div');
      fly.className = 'mo-fly';
      if (src) fly.style.backgroundImage = `url("${src}")`;
      else fly.style.background = getComputedStyle(fromEl).backgroundColor || 'var(--surface-2)';
      Object.assign(fly.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
      const sx = from.width / to.width;
      const sy = from.height / to.height;
      fly.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`;
      document.body.appendChild(fly);
      void fly.offsetWidth; // start from the small cover
      fly.classList.add('go');
      fly.style.transform = 'none';
      setTimeout(() => done(fly), 560);
    })
  );
  function done(fly) {
    document.documentElement.classList.remove('mo-opening');
    if (!fly) return;
    fly.classList.add('done');
    setTimeout(() => fly.remove(), 200);
  }
}
