import { describe, it, expect } from 'vitest';
import { checkParts, partNumbers } from '../src/lib/parts.js';

const T = (names, extra = {}) => names.map((name, i) => ({ name, url: 'u' + i, index: i, size: 1000 * (i + 10), ...extra }));

describe('part numbers', () => {
  it('finds the changing number', () => {
    expect(partNumbers(['Book 2 Part 01', 'Book 2 Part 02', 'Book 2 Part 03'])).toEqual([1, 2, 3]);
    expect(partNumbers(['Intro', 'Chapter A', 'Chapter B'])).toEqual([null, null, null]);
  });
});

describe('book check', () => {
  it('puts parts in number order', () => {
    const r = checkParts(T(['Part 10.mp3', 'Part 2.mp3', 'Part 1.mp3', 'Part 3.mp3', 'Part 4.mp3', 'Part 5.mp3', 'Part 6.mp3', 'Part 7.mp3', 'Part 8.mp3', 'Part 9.mp3']));
    expect(r.tracks.map((t) => t.name)[0]).toBe('Part 1.mp3');
    expect(r.tracks.at(-1).name).toBe('Part 10.mp3');
    expect(r.note.reordered).toBe(true);
    expect(r.tracks.map((t) => t.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('skips copies and notices a missing part', () => {
    const r = checkParts(T(['Part 05.mp3', 'Part 06.mp3', 'Part 08.mp3', 'Part 06 (1).mp3', 'Part 09.mp3']));
    expect(r.note.missing).toEqual([7]);
    expect(r.note.dupes).toEqual(['Part 06 (1)']);
    expect(r.tracks.map((t) => t.name)).toEqual(['Part 05.mp3', 'Part 06.mp3', 'Part 08.mp3', 'Part 09.mp3']);
    expect(r.note.gapBefore).toEqual({ 2: [7] });
  });
  it('says nothing about a book that is fine', () => {
    expect(checkParts(T(['01.mp3', '02.mp3', '03.mp3'])).note).toBe(null);
  });
  it('only reports for a book in progress (keeps every part where it is)', () => {
    const tr = T(['Part 2.mp3', 'Part 1.mp3', 'Part 4.mp3', 'Part 1 (1).mp3']);
    const r = checkParts(tr, { keep: true });
    expect(r.tracks).toBe(tr);
    expect(r.note.missing).toEqual([3]);
    expect(r.note.reordered).toBe(false);
    expect(r.note.outOfOrder).toBe(true);
  });
});
