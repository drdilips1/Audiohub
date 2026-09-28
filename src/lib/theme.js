// Accent pairs for gradients. The pastel set follows Material You's tonal
// palettes; `l`/`lb` are the deeper tones used on light backgrounds.
export const ACCENTS = {
  audiohub: { name: 'Audiohub', a: '#8fe9ff', b: '#f7a6d8', l: '#0e7490', lb: '#be185d' },
  orchid: { name: 'Orchid', a: '#dcb0ff', b: '#ff9fd2', l: '#7e22ce', lb: '#be185d' },
  sunset: { name: 'Sunset', a: '#ffb57a', b: '#ff86a8', l: '#c2410c', lb: '#be123c' },
  ocean: { name: 'Ocean', a: '#7cc8ff', b: '#8f9dff', l: '#0369a1', lb: '#4338ca' },
  emerald: { name: 'Emerald', a: '#7ee2b8', b: '#b9f27c', l: '#047857', lb: '#4d7c0f' },
  amber: { name: 'Amber', a: '#ffd479', b: '#ffab76', l: '#b45309', lb: '#c2410c' },
  crimson: { name: 'Crimson', a: '#ff8a8a', b: '#ffb38a', l: '#b91c1c', lb: '#c2410c' },
  lavender: { name: 'Lavender', a: '#cbb8ff', b: '#ffb3d0', l: '#6750a4', lb: '#984061' },
  peach: { name: 'Peach', a: '#ffb68f', b: '#ffd9a0', l: '#8f4c2a', lb: '#7d5700' },
  mint: { name: 'Mint', a: '#8fdcc3', b: '#a8d8ff', l: '#006b56', lb: '#00639b' },
  sky: { name: 'Sky', a: '#a8c8ff', b: '#d2bbff', l: '#335f9e', lb: '#6750a4' },
  blush: { name: 'Blush', a: '#ffafc9', b: '#ffc9a8', l: '#984061', lb: '#8f4c2a' },
  champagne: { name: 'Champagne', a: '#c8a96a', b: '#e6d3a8' },
  sage: { name: 'Sage', a: '#8aa894', b: '#c5d6bf' },
  dusk: { name: 'Dusk', a: '#9a8fc2', b: '#c9bfe3' },
  terracotta: { name: 'Terracotta', a: '#c47b5f', b: '#e3b79f' },
  slate: { name: 'Slate', a: '#7f94b0', b: '#b9c7da' },
  rosewood: { name: 'Rosewood', a: '#b57380', b: '#e0b6be' },
  teal: { name: 'Deep teal', a: '#5f9a98', b: '#a9cfcb' },
  graphite: { name: 'Graphite', a: '#b9b4ac', b: '#e4e0d8' },
};
// Earlier, brighter accent names map onto the refined set.
const LEGACY = { aurora: 'dusk', sunset: 'terracotta', ocean: 'slate', forest: 'sage', rose: 'rosewood', ember: 'terracotta', gold: 'champagne', ice: 'slate' };

export function applyTheme(st) {
  const a = ACCENTS[st.accent] || ACCENTS[LEGACY[st.accent]] || ACCENTS.audiohub;
  const root = document.documentElement;
  const light = st.mode === 'light';
  root.dataset.mode = st.mode;
  // Palette: the colour of the whole app (backgrounds and text), per mode.
  const pal = PALETTES.find((p) => p.id === st.palette && p.light === light);
  root.dataset.palette = pal ? pal.id : 'default';
  root.style.setProperty('--accent', light && a.l ? a.l : a.a);
  root.style.setProperty('--accent-2', light && a.lb ? a.lb : a.b);
  // Soft pastel pair for gradients and tints, whatever the mode.
  root.style.setProperty('--tint', a.a);
  root.style.setProperty('--tint-2', a.b);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = st.mode === 'amoled' ? '#000000' : pal?.bg || (light ? '#fdf7ff' : '#131218');
}

/** Whole-app colour themes. Dark ones apply in Dark mode, light ones in Light mode. */
export const PALETTES = [
  { id: 'default', name: 'Classic', light: false, bg: '#131218', swatch: ['#131218', '#262330'] },
  { id: 'midnight', name: 'Midnight', light: false, bg: '#0b1020', swatch: ['#0b1020', '#1b2745'] },
  { id: 'aurora', name: 'Aurora', light: false, bg: '#0d0b1f', swatch: ['#0d0b1f', '#2a1c52'] },
  { id: 'forest', name: 'Forest', light: false, bg: '#0c1512', swatch: ['#0c1512', '#1c332a'] },
  { id: 'mocha', name: 'Mocha', light: false, bg: '#16110e', swatch: ['#16110e', '#33261d'] },
  { id: 'nord', name: 'Nord', light: false, bg: '#1b2029', swatch: ['#1b2029', '#2e3440'] },
  { id: 'plum', name: 'Plum', light: false, bg: '#170d17', swatch: ['#170d17', '#35193a'] },
  { id: 'default', name: 'Classic', light: true, bg: '#fdf7ff', swatch: ['#fdf7ff', '#ece4f4'] },
  { id: 'sepia', name: 'Sepia', light: true, bg: '#f4ecdd', swatch: ['#f4ecdd', '#e3d4b8'] },
  { id: 'paper', name: 'Paper', light: true, bg: '#f5f6f8', swatch: ['#f5f6f8', '#dfe3ea'] },
  { id: 'blossom', name: 'Blossom', light: true, bg: '#fff4f6', swatch: ['#fff4f6', '#fbd9e1'] },
  { id: 'mint', name: 'Mint', light: true, bg: '#f1f8f4', swatch: ['#f1f8f4', '#d3eadd'] },
];
