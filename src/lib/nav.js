// Minimal stack navigator with bottom-nav tabs, Android back button friendly.
const listeners = new Set();
let tab = 'home';
const stacks = { home: [], discover: [], podcasts: [], library: [], tracker: [], settings: [] };
let overlay = null; // e.g. full player

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
    if (t === tab) stacks[t] = [];
    tab = t;
    window.scrollTo(0, 0);
    emit();
  },
  push(name, params = {}) {
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
      return true;
    }
    if (tab !== 'home') {
      tab = 'home';
      emit();
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
