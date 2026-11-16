import { describe, it, expect } from 'vitest';
import { headingFor, messageFor, signoffFor, hasOwnWords } from '../src/lib/messages.js';
import { OCCASIONS, occasionById, customOccasion } from '../src/lib/occasions.js';
import { LANG_IDS, dearLine } from '../src/lib/languages.js';

describe('offline words', () => {
  it('every occasion has a heading and message in every language', () => {
    for (const o of OCCASIONS) for (const l of LANG_IDS) {
      expect(headingFor(o, l), `${o.id}/${l}`).toBeTruthy();
      expect(messageFor(o, { lang: l }), `${o.id}/${l}`).toBeTruthy();
    }
  });
  it('writes Hindi in Devanagari and Urdu in Urdu script', () => {
    expect(headingFor(occasionById('diwali'), 'hi')).toBe('शुभ दीपावली');
    expect(headingFor(occasionById('eid'), 'ur')).toBe('عید مبارک');
    expect(headingFor(occasionById('lohri'), 'pa')).toMatch(/ਲੋਹੜੀ/);
  });
  it('shapes the message by relationship', () => {
    const toMum = messageFor(occasionById('birthday'), { lang: 'en', relation: 'mother' });
    const toBoss = messageFor(occasionById('birthday'), { lang: 'en', relation: 'boss' });
    expect(toMum).toMatch(/blessings/);
    expect(toBoss).not.toMatch(/blessings/);
    expect(signoffFor('en', 'boss')).toBe('Warm regards,');
    expect(signoffFor('hi', 'grandmother')).toBe('सादर प्रणाम,');
  });
  it('keeps condolences free of jokes and cheer', () => {
    const m = messageFor(occasionById('sympathy'), { lang: 'en', relation: 'friend', tone: 'funny' });
    expect(m).toMatch(/sorry for your loss/);
    expect(signoffFor('en', 'friend', occasionById('sympathy'))).toMatch(/condolences/);
  });
  it('short tone gives one sentence', () => {
    const m = messageFor(occasionById('diwali'), { lang: 'hi', tone: 'short' });
    expect(m.split('।').filter(Boolean).length).toBe(1);
  });
  it('custom occasions use the user’s words in English', () => {
    expect(headingFor(customOccasion('Pihu’s first day at school'), 'en')).toBe('Pihu’s first day at school');
  });
  it('knows which languages have their own words', () => {
    expect(hasOwnWords(occasionById('pongal'), 'ta')).toBe(true);
    expect(hasOwnWords(occasionById('teej'), 'ta')).toBe(false);
  });
  it('writes the greeting line with the right punctuation', () => {
    expect(dearLine('en', 'Priya')).toBe('Dear Priya,');
    expect(dearLine('ur', 'Ayesha')).toBe('پیارے Ayesha،');
    expect(dearLine('hi', '')).toBe('');
  });
});
