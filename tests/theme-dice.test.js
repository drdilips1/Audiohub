import { describe, it, expect, beforeAll } from 'vitest';

let theme;
beforeAll(async () => {
  globalThis.window = globalThis;
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
  globalThis.document = { documentElement: { dataset: {}, style: { setProperty() {} } }, querySelector: () => null, addEventListener() {} };
  theme = await import('../src/lib/theme.js');
});

describe('theme dice', () => {
  it('every roll changes the accent and never lands on a palette that ignores it', () => {
    const st = { mode: 'dark', palette: 'plum', paletteDark: 'plum', accent: 'emerald' };
    for (let i = 0; i < 300; i++) {
      const r = theme.rollTheme(st);
      expect(['paperink', 'ivory']).not.toContain(r.palette);
      expect(r.accent).not.toBe(st.accent);
      expect(theme.ACCENTS[r.accent]).toBeTruthy();
      if (r.mode === 'light') expect(theme.ACCENTS[r.accent].l).toBeTruthy(); // readable on light
    }
  });
});
