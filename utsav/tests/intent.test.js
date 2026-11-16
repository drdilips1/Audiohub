import { describe, it, expect } from 'vitest';
import { parseRequest } from '../src/lib/intent.js';

describe('parseRequest', () => {
  it('reads occasion, relation and tone, ignoring negated words', () => {
    const r = parseRequest('Make a beautiful birthday card for my elder sister, emotional but not too sentimental.');
    expect(r.occasion).toBe('birthday');
    expect(r.relation).toBe('sister');
    expect(r.tone).toBe('emotional');
    expect(r.elder).toBe(true);
  });
  it('reads a formal retirement wish for a boss', () => {
    const r = parseRequest('Wish my boss on his retirement, classy and respectful');
    expect(r.occasion).toBe('retirement');
    expect(r.relation).toBe('boss');
    expect(r.tone).toBe('formal');
  });
  it('knows a Diwali greeting from the family should be traditional', () => {
    const r = parseRequest('Create a Diwali greeting from our family, traditional but sophisticated');
    expect(r.occasion).toBe('diwali');
    expect(r.style).toBe('traditional');
    expect(r.fromFamily).toBe(true);
  });
  it('prefers the longer occasion: wedding anniversary is an anniversary', () => {
    expect(parseRequest('Anniversary wish for my wife, romantic and personal').occasion).toBe('anniversary');
    expect(parseRequest('25th wedding anniversary for mummy papa').occasion).toBe('anniversary');
    expect(parseRequest('25th wedding anniversary for mummy papa').number).toBe(25);
  });
  it('picks up the language by name or by script', () => {
    expect(parseRequest('Holi card for friends in Tamil').lang).toBe('ta');
    expect(parseRequest('माँ के लिए जन्मदिन कार्ड').lang).toBe('hi');
    expect(parseRequest('ਲੋਹੜੀ ਦੀਆਂ ਵਧਾਈਆਂ').lang).toBe('pa');
    expect(parseRequest('Eid card', { lang: 'ur' }).lang).toBe('ur');
  });
  it('finds the recipient and sender names', () => {
    const r = parseRequest('Birthday card for Priya from the Sharma family');
    expect(r.to).toBe('Priya');
    expect(r.from).toBe('Sharma family');
  });
  it('keeps an unknown occasion as the user’s own words', () => {
    const r = parseRequest("Card for Pihu's first day at school");
    expect(r.occasion).toBeNull();
    expect(r.customOccasion).toMatch(/first day at school/i);
  });
});

describe('names after the relationship', () => {
  it('finds "my elder sister Priya" and "my wife Neha"', () => {
    expect(parseRequest('A birthday card for my elder sister Priya, emotional').to).toBe('Priya');
    expect(parseRequest('Anniversary wish for my wife Neha').to).toBe('Neha');
    expect(parseRequest('Anniversary wish for my wife, romantic').to).toBe('');
  });
});
