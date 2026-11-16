import { describe, it, expect } from 'vitest';
import { THEMES, MOTIFS, designFor, sanitizeSpec, contrast, isDark } from '../src/lib/design.js';
import { OCCASIONS, CATEGORIES, themeForText } from '../src/lib/occasions.js';

describe('themes and occasions', () => {
  it('every occasion uses a theme that exists, in a category that exists', () => {
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const o of OCCASIONS) {
      expect(THEMES[o.theme], o.id).toBeTruthy();
      expect(cats.has(o.cat), o.id).toBe(true);
    }
  });
  it('occasion ids are unique', () => {
    const ids = OCCASIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('every theme only uses known motifs and readable palettes', () => {
    for (const [id, T] of Object.entries(THEMES)) {
      for (const set of T.motifs) for (const m of set) expect(MOTIFS[m], `${id}:${m}`).toBeTruthy();
      for (const p of T.palettes) {
        for (const bg of p.bg) expect(contrast(p.ink, bg), `${id} heading`).toBeGreaterThanOrEqual(3);
        for (const bg of p.bg) expect(contrast(p.sub, bg), `${id} message`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('custom occasions get a theme from their words', () => {
    expect(themeForText('Shop opening on Monday')).toBe('home');
    expect(themeForText('Pihu’s first day at school')).toBe('baby');
    expect(themeForText('something else entirely')).toBe('lights');
  });
});

describe('designFor', () => {
  it('gives different variants different looks', () => {
    const a = designFor({ theme: 'birthday', variant: 0 });
    const b = designFor({ theme: 'birthday', variant: 1 });
    expect(a.motifs).not.toEqual(b.motifs);
  });
  it('never uses a Latin script face for Indian languages', () => {
    expect(designFor({ theme: 'love', lang: 'hi' }).font).toBe('serif');
    expect(designFor({ theme: 'love', lang: 'en' }).font).toBe('script');
  });
});

describe('sanitizeSpec', () => {
  it('repairs whatever the AI sends back', () => {
    const s = sanitizeSpec({ theme: 'nope', motifs: ['diyas', 'unicorns', 'diyas'], palette: { bg: ['red', 'blue'] }, heading: '  Hi  ', seed: 'x' });
    expect(s.theme).toBe('lights');
    expect(s.motifs).toEqual(['diyas']);
    expect(s.palette.bg[0]).toMatch(/^#/);
    expect(s.heading).toBe('Hi');
    expect(s.seed).toBe(7);
    expect(s.format).toBe('post');
  });
  it('keeps one frame and one top band so artwork doesn’t pile up', () => {
    const s = sanitizeSpec({ theme: 'wedding', motifs: ['frame-gold', 'arch-frame', 'toran', 'bunting', 'lanterns'] });
    expect(s.motifs).toEqual(['frame-gold', 'toran', 'lanterns']);
  });
  it('fixes unreadable text colours', () => {
    const s = sanitizeSpec({ theme: 'birthday', motifs: ['confetti'], palette: { bg: ['#FFFFFF', '#FAFAFA'], ink: '#FFFFEE', sub: '#EEEEEE', c: ['#FF0000', '#00FF00', '#0000FF'] } });
    expect(isDark(s.palette)).toBe(false);
    expect(contrast(s.palette.ink, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(contrast(s.palette.sub, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });
});
