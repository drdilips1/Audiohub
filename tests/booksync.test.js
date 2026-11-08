// Following the book by the audio's time (transcript with the ebook attached).
import { describe, it, expect } from 'vitest';
const { wordAtTime } = await import('../src/lib/booksync.js');

// Lines found at 10 s → word 100, 20 s → word 125, 30 s → word 150 (2.5 words a second).
const pts = [[10, 100], [20, 125], [30, 150]];
describe('wordAtTime', () => {
  it('between two found lines: by how far along', () => {
    expect(wordAtTime(pts, 15, 1000)).toBe(113);
    expect(wordAtTime(pts, 25, 1000)).toBe(138);
  });
  it('after the last found line: at the reader’s pace', () => {
    expect(wordAtTime(pts, 40, 1000)).toBe(175);
  });
  it('before the first: back at the same pace, never below 0 or past the end', () => {
    expect(wordAtTime(pts, 0, 1000)).toBe(75);
    expect(wordAtTime(pts, -100, 1000)).toBe(0);
    expect(wordAtTime(pts, 10000, 1000)).toBe(999);
  });
});

import { fixCredit } from '../src/lib/booksync.js';

describe('misheard credits and chapter headings', () => {
  const titles = ['Harry Potter and the Sorcerer’s Stone (Full-Cast Edition)', 'Harry Potter and the Sorcerer Stone'];
  it('fixes the title and "Chapter One"', () => {
    expect(fixCredit('Body and the saucer is stone', titles, { credits: true })).toBe('Harry Potter and the Sorcerer’s Stone');
    expect(fixCredit('Shop to one.', titles)).toBe('Chapter One');
    expect(fixCredit('Chapter 7', titles)).toBe('Chapter Seven');
    expect(fixCredit('chop to two', titles)).toBe('Chapter Two');
  });
  it('leaves ordinary lines alone', () => {
    for (const line of ['Written by J. K. Rowling.', 'More publishing and audible studios present.', 'This is Audible.', 'Mr. and Mrs. Dursley, of number four, Privet Drive', 'Stop to one side', 'He went to one'])
      expect(fixCredit(line, titles, { credits: true })).toBe(line);
    // Outside the credits, never the title.
    expect(fixCredit('Harry looked at the stone', titles)).toBe('Harry looked at the stone');
    expect(fixCredit('Body and the saucer is stone', titles)).toBe('Body and the saucer is stone');
  });
});
