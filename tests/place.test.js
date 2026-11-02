// Your place in a book: part lengths, switching copies, the server's place.
import { describe, it, expect } from 'vitest';
import { estimateDuration, copyPlace, partByPercent, fitted } from '../src/lib/place.js';

describe('estimateDuration (a part that has not played yet)', () => {
  it('uses the real length once known', () => {
    expect(estimateDuration([{ duration: 600 }], 0)).toBe(600);
  });

  it('is 0 for a missing part, or when nothing has played', () => {
    expect(estimateDuration([{ duration: 600 }], 5)).toBe(0);
    expect(estimateDuration([{}, {}], 1)).toBe(0);
  });

  it('estimates from file size at the rate of the parts already played', () => {
    // 100 MB played in 1000 s → a 50 MB part is about 500 s.
    const tracks = [{ duration: 1000, size: 100e6 }, { size: 50e6 }];
    expect(estimateDuration(tracks, 1)).toBeCloseTo(500);
  });

  it('falls back to the average known length when sizes are missing', () => {
    const tracks = [{ duration: 1000 }, { duration: 2000 }, {}];
    expect(estimateDuration(tracks, 2)).toBe(1500);
  });
});

describe('copyPlace (switching to another copy of the book)', () => {
  it('keeps the same time when the copies match', () => {
    // 1 h into a 10 h book, 10% through: the same copy length.
    expect(copyPlace(3600, 0.1, 36000)).toBe(3600);
  });

  it('goes by how far through you were when the lengths differ', () => {
    // 50% through a 10 h edition, now on an 8 h edition: 4 h in, not 5 h.
    expect(copyPlace(18000, 0.5, 28800)).toBe(14400);
  });

  it('never lands past the end of a shorter copy', () => {
    // A place beyond this copy's end: by percent, and never the very end.
    expect(copyPlace(30000, 0.9, 20000)).toBe(18000);
    expect(copyPlace(19990, 1, 20000)).toBe(0.995 * 20000);
  });

  it('leaves the place alone without a percent or a known length', () => {
    expect(copyPlace(3600, 0, 36000)).toBe(3600);
    expect(copyPlace(3600, 0.5, 0)).toBe(3600);
    expect(copyPlace(null, 0.5, 36000)).toBe(null);
  });
});

describe('partByPercent (a cloud copy whose part lengths are not known yet)', () => {
  it('picks the part by file sizes when every part has one', () => {
    // Parts of 10, 30, 60 MB; 50% through = 50 MB in → part 3, 10 of its 60 MB.
    const r = partByPercent(0.5, [{ size: 10 }, { size: 30 }, { size: 60 }]);
    expect(r.i).toBe(2);
    expect(r.frac).toBeCloseTo(10 / 60);
  });

  it('treats parts as equal when a size is missing', () => {
    const r = partByPercent(0.5, [{ size: 10 }, {}, { size: 60 }, {}]);
    expect(r).toEqual({ i: 2, frac: 0 });
  });

  it('never opens past the last part, even at 100%', () => {
    const bySize = partByPercent(1, [{ size: 10 }, { size: 10 }]);
    expect(bySize.i).toBe(1);
    expect(bySize.frac).toBeLessThan(1);
    const equal = partByPercent(1, [{}, {}]);
    expect(equal.i).toBe(1);
    expect(equal.frac).toBeLessThan(1);
  });

  it('a single-file book: the right point in that file', () => {
    expect(partByPercent(0.25, [{ size: 400 }])).toEqual({ i: 0, frac: 0.25 });
  });
});

describe("fitted (the server's place in this copy's time)", () => {
  it('is the same time when lengths match or are unknown', () => {
    expect(fitted({ time: 100, duration: 1000 }, 1000)).toBe(100);
    expect(fitted({ time: 100 }, 1000)).toBe(100);
    expect(fitted({ time: 100, duration: 1000 }, 0)).toBe(100);
  });

  it('scales when the lengths are close (a few seconds of intro)', () => {
    expect(fitted({ time: 500, duration: 1000 }, 1020)).toBeCloseTo(510);
  });

  it('is null for another edition (lengths more than 6% apart)', () => {
    expect(fitted({ time: 500, duration: 1000 }, 1100)).toBe(null);
  });

  it('is null without a usable place', () => {
    expect(fitted(null, 1000)).toBe(null);
    expect(fitted({}, 1000)).toBe(null);
    expect(fitted({ time: -1 }, 1000)).toBe(null);
  });
});
