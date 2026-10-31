// Accent pairs for gradients. The pastel set follows Material You's tonal
// palettes; `l`/`lb` are the deeper tones used on light backgrounds.
export const ACCENTS = {
  // Brass to copper on warm ink / ivory — the default look.
  brass: { name: 'Brass', a: '#dcb675', b: '#c98a62', l: '#8a6322', lb: '#9b4f2b' },
  // Warm orange on clean black / white.
  studio: { name: 'Studio orange', a: '#f7991c', b: '#ff7a00', l: '#c45f00', lb: '#b84d00' },
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

// Paper & Ink's own accent: forest green on paper, a lighter sage at night.
const FOREST = { a: '#a3b89f', b: '#a3b89f', l: '#557663', lb: '#557663' };
// Ivory & Gold: Paper & Ink's layout on warm ivory, with an antique-gold accent.
const GOLD = { a: '#d4b26a', b: '#d4b26a', l: '#9c7a3c', lb: '#9c7a3c' };
/** Themes built on Paper & Ink (its clean layout), with their own colours. */
export const isInk = (pid) => pid === 'paperink' || pid === 'ivory';

/** Light / dark / black, with "system" following the phone's setting. */
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
export const resolvedMode = (st) => (st.mode === 'system' ? (darkQuery?.matches ? 'dark' : 'light') : st.mode);
let lastSt = null;
darkQuery?.addEventListener?.('change', () => lastSt?.mode === 'system' && applyTheme(lastSt));

let onApplied = null;
/** Called after each theme change with whether it is light (status bar icons). */
export const onThemeApplied = (f) => (onApplied = f);

/** The colour theme in use: each mode keeps its own (light colours by day, dark at night). */
export const activePalette = (st, mode = resolvedMode(st)) => (mode === 'light' ? st.paletteLight : st.paletteDark) || st.palette || 'default';

export function applyTheme(st) {
  lastSt = st;
  const mode = resolvedMode(st);
  const pid = activePalette(st, mode);
  const a = pid === 'paperink' ? FOREST : pid === 'ivory' ? GOLD : ACCENTS[st.accent] || ACCENTS[LEGACY[st.accent]] || ACCENTS.brass;
  const root = document.documentElement;
  const light = mode === 'light';
  root.dataset.mode = mode;
  // Palette: the colour of the whole app (backgrounds and text), per mode.
  const pal = PALETTES.find((p) => p.id === pid && p.light === light);
  // Ivory & Gold uses Paper & Ink's styles, with its own colours on top (data-variant).
  root.dataset.palette = pal ? (pal.id === 'ivory' ? 'paperink' : pal.id) : 'default';
  if (pal?.id === 'ivory') root.dataset.variant = 'ivory';
  else delete root.dataset.variant;
  root.style.setProperty('--accent', light && a.l ? a.l : a.a);
  root.style.setProperty('--accent-2', light && a.lb ? a.lb : a.b);
  // Soft pastel pair for gradients and tints, whatever the mode.
  root.style.setProperty('--tint', a.a);
  root.style.setProperty('--tint-2', a.b);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = mode === 'amoled' ? '#000000' : pal?.bg || (light ? '#fdf7ff' : '#131218');
  onApplied?.(light);
}

/** Whole-app colour themes. Dark ones apply in Dark mode, light ones in Light mode. */
export const PALETTES = [
  { id: 'ivory', name: 'Ivory & Gold', light: true, bg: '#fbf8f2', swatch: ['#fbf8f2', '#9c7a3c'] },
  { id: 'ivory', name: 'Ivory & Gold', light: false, bg: '#1a1814', swatch: ['#1a1814', '#d4b26a'] },
  { id: 'paperink', name: 'Paper & Ink', light: false, bg: '#191b18', swatch: ['#191b18', '#a3b89f'] },
  { id: 'paperink', name: 'Paper & Ink', light: true, bg: '#f6f2e9', swatch: ['#f6f2e9', '#557663'] },
  { id: 'atelier', name: 'Atelier', light: false, bg: '#0f0e0d', swatch: ['#0f0e0d', '#dcb675'] },
  { id: 'atelier', name: 'Atelier', light: true, bg: '#f7f3ec', swatch: ['#f7f3ec', '#8a6322'] },
  { id: 'studio', name: 'Studio', light: false, bg: '#121212', swatch: ['#121212', '#f7991c'] },
  { id: 'studio', name: 'Studio', light: true, bg: '#ffffff', swatch: ['#ffffff', '#f7991c'] },
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
  // Light looks with their own accent (picked along with them; any accent can still be chosen after).
  { id: 'linen', name: 'Linen', light: true, bg: '#f8f3eb', swatch: ['#f8f3eb', '#8f4c2a'], accent: 'peach' },
  { id: 'cloud', name: 'Cloud', light: true, bg: '#f3f6fb', swatch: ['#f3f6fb', '#335f9e'], accent: 'sky' },
  { id: 'apricot', name: 'Apricot', light: true, bg: '#fff6ef', swatch: ['#fff6ef', '#c2410c'], accent: 'sunset' },
  { id: 'sage', name: 'Sage', light: true, bg: '#f2f4ec', swatch: ['#f2f4ec', '#047857'], accent: 'emerald' },
  { id: 'lilac', name: 'Lilac', light: true, bg: '#f6f3fc', swatch: ['#f6f3fc', '#6750a4'], accent: 'lavender' },
  { id: 'stone', name: 'Stone & Brass', light: true, bg: '#f2f0ed', swatch: ['#f2f0ed', '#8a6322'], accent: 'brass' },
];
