// Which tab is showing and which full-screen pages are open on top of it. Android's
// back button closes the top page first, then returns to Home.

import { useEffect, useState } from 'preact/hooks';

const nav = { tab: 'home', stack: [] };
const subs = new Set();
const emit = () => subs.forEach((f) => f());

export const go = (tab) => { nav.tab = tab; nav.stack = []; emit(); window.scrollTo?.(0, 0); };
export const open = (page, props = {}) => { nav.stack = [...nav.stack, { page, props, key: Math.random() }]; emit(); };
export const replaceTop = (page, props = {}) => { nav.stack = [...nav.stack.slice(0, -1), { page, props, key: Math.random() }]; emit(); };
export const back = () => {
  if (nav.stack.length) { nav.stack = nav.stack.slice(0, -1); emit(); return true; }
  if (nav.tab !== 'home') { go('home'); return true; }
  return false;
};

export function useNav() {
  const [, t] = useState(0);
  useEffect(() => { const f = () => t((n) => n + 1); subs.add(f); return () => subs.delete(f); }, []);
  return nav;
}
