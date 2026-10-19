// Minimal stack navigator with bottom-nav tabs, Android back button friendly.
const listeners = new Set();
let tab = 'home';
const stacks = { home: [], discover: [], podcasts: [], library: [], tracker: [], settings: [] };
let overlay = null; // e.g. full player
// Where each tab's main screen was scrolled to: tabs stay alive in the background, so
// coming back (to the tab, or from a book page) lands where you were.
const scrolls = {};
const saveScroll = () => {
  if (!stacks[tab].length) scrolls[tab] = window.scrollY;
};
const restore = (y) => requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y || 0)));

function emit() {
  const s = nav.state();
  listeners.forEach((f) => f(s));
}

export const nav = {
  state: () => ({ tab, stack: stacks[tab], top: stacks[tab][stacks[tab].length - 1] || null, overlay }),
  subscribe(f) {
    listeners.add(f);
    return () => listeners.delete(f);
  },
  tab(t) {
    stacks[t] ||= [];
    saveScroll();
    // Tapping the tab you're on: back to its top.
    const again = t === tab;
    if (again) stacks[t] = [];
    tab = t;
    emit();
    restore(again || stacks[t].length ? 0 : scrolls[t]);
  },
  push(name, params = {}) {
    saveScroll();
    stacks[tab] = [...stacks[tab], { name, params, key: Date.now() + Math.random() }];
    window.scrollTo(0, 0);
    emit();
  },
  back() {
    if (overlay) {
      overlay = null;
      emit();
      return true;
    }
    if (stacks[tab].length) {
      stacks[tab] = stacks[tab].slice(0, -1);
      emit();
      if (!stacks[tab].length) restore(scrolls[tab]);
      return true;
    }
    if (tab !== 'home') {
      saveScroll();
      tab = 'home';
      emit();
      restore(stacks.home.length ? 0 : scrolls.home);
      return true;
    }
    return false;
  },
  openOverlay(name) {
    overlay = name;
    emit();
  },
  closeOverlay() {
    overlay = null;
    emit();
  },
};
