import { describe, it, expect } from 'vitest';
import { offlineCards, fromAi, aiRequest, ordinal } from '../src/lib/compose.js';
import { buildPrompt, CARD_SCHEMA } from '../src/lib/aiPrompt.js';

describe('compose', () => {
  it('makes several different offline designs with the same words', () => {
    const cards = offlineCards({ occasion: 'diwali', lang: 'hi', relation: 'mother', from: 'Rohan' }, 4);
    expect(cards).toHaveLength(4);
    expect(new Set(cards.map((c) => JSON.stringify(c.motifs) + c.palette.bg[0])).size).toBeGreaterThan(2);
    expect(cards.every((c) => c.heading === 'शुभ दीपावली' && c.from === 'Rohan')).toBe(true);
  });
  it('puts the age in English birthday headings', () => {
    expect(offlineCards({ occasion: 'birthday', lang: 'en', number: 60 }, 1)[0].heading).toBe('Happy 60th Birthday');
    expect(ordinal(21)).toBe('21st'); expect(ordinal(12)).toBe('12th'); expect(ordinal(103)).toBe('103rd');
  });
  it('keeps a typed occasion as the user wrote it', () => {
    const [c] = offlineCards({ customOccasion: 'Shop’s 10th year', lang: 'en' }, 1);
    expect(c.occasion).toBe('custom');
    expect(c.heading).toBe('Shop’s 10th year');
    expect(c.theme).toBe('home');
  });
  it('repairs an AI card that names a theme or motif we do not have', () => {
    const s = fromAi({ heading: 'Eid Mubarak', message: 'Peace and joy.', signoff: 'With love,', theme: 'space', motifs: ['crescent', 'robots'], palette: { bg: ['#062C30', '#0B4A50'], ink: '#F5D78E', sub: '#E8F6F3', c: ['#F5D78E', '#D4A53C', '#0F6B70'] }, font: 'serif' }, { occasion: 'eid', lang: 'en' });
    expect(s.theme).toBe('eid');
    expect(s.motifs).toEqual(['crescent']);
    expect(s.source).toBe('ai');
  });
  it('builds a prompt from the form fields only', () => {
    const r = aiRequest({ occasion: 'lohri', relation: 'friend', lang: 'pa', tone: 'funny', to: 'Gurpreet', note: 'he loves bhangra' });
    const p = buildPrompt(r);
    expect(p).toMatch(/Lohri \(Punjab\)/);
    expect(p).toMatch(/Punjabi \(Gurmukhi script\)/);
    expect(p).toMatch(/he loves bhangra/);
    expect(CARD_SCHEMA.properties.cards.items.required).toContain('motifs');
  });
});
