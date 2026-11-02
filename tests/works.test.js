// One book, every copy: grouping copies and picking which one opens.
import { describe, it, expect, beforeEach } from 'vitest';
import { sameWork, preferred, oneEach, otherCopyProgress } from '../src/lib/works.js';
import { progress } from '../src/lib/store.js';
import { downloads } from '../src/lib/downloads.js';

beforeEach(() => {
  progress.set({});
  downloads.set({});
});

describe('sameWork', () => {
  it('is the same book across sources, despite subtitles and case', () => {
    expect(sameWork({ title: 'Dune', author: 'Frank Herbert' }, { title: 'DUNE: Deluxe Edition', author: 'Herbert, Frank' })).toBe(true);
    expect(sameWork({ title: 'Dune', author: 'Frank Herbert' }, { title: 'DUNE: Deluxe Edition', author: 'F. Herbert' })).toBe(true);
  });

  it('is the same book when one author is unknown', () => {
    expect(sameWork({ title: 'Dune', author: '' }, { title: 'Dune', author: 'Frank Herbert' })).toBe(true);
  });

  it('is not the same book by another author or title', () => {
    expect(sameWork({ title: 'Dune', author: 'Frank Herbert' }, { title: 'Dune', author: 'Someone Else' })).toBe(false);
    expect(sameWork({ title: 'Dune', author: 'Frank Herbert' }, { title: 'Dune Messiah', author: 'Frank Herbert' })).toBe(false);
    expect(sameWork(null, { title: 'Dune' })).toBe(false);
  });
});

describe('preferred (which copy opens)', () => {
  const phone = { uid: 'loc:1', source: 'loc', title: 'Dune' };
  const server = { uid: 'abs:1', source: 'abs', title: 'Dune' };
  const torbox = { uid: 'tb:1', source: 'tb', title: 'Dune' };
  const other = { uid: 'x:1', source: 'archive', title: 'Dune' };

  it('without history: phone, then server, then cloud, then the rest', () => {
    expect(preferred([other, torbox, server, phone])).toBe(phone);
    expect(preferred([other, torbox, server])).toBe(server);
    expect(preferred([other, torbox])).toBe(torbox);
  });

  it('a downloaded copy ranks just after the phone copy', () => {
    downloads.set({ 'x:1': { status: 'done' } });
    expect(preferred([server, other])).toBe(other);
    expect(preferred([phone, other])).toBe(phone);
  });

  it('the copy you last used wins over rank', () => {
    progress.set({ 'tb:1': { updatedAt: 2 }, 'loc:1': { updatedAt: 1 } });
    expect(preferred([phone, torbox])).toBe(torbox);
  });
});

describe('oneEach (each book listed once)', () => {
  it('groups copies of the same book and counts them', () => {
    const list = [
      { uid: 'loc:1', source: 'loc', title: 'Dune', author: 'Frank Herbert' },
      { uid: 'abs:1', source: 'abs', title: 'Dune', author: 'Frank Herbert' },
      { uid: 'abs:2', source: 'abs', title: 'Emma', author: 'Jane Austen' },
    ];
    const out = oneEach(list);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ uid: 'loc:1', copies: 2 });
    expect(out[1]).toBe(list[2]);
  });

  it('keeps the same title by different authors apart', () => {
    const out = oneEach([
      { uid: 'a', title: 'Dune', author: 'Frank Herbert' },
      { uid: 'b', title: 'Dune', author: 'Someone Else' },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('otherCopyProgress (continue from another copy)', () => {
  const book = { uid: 'abs:1', title: 'Dune', author: 'Frank Herbert' };
  const copy = { uid: 'loc:1', title: 'Dune', author: 'Frank Herbert' };

  it('finds your newest place in another copy', () => {
    progress.set({
      'loc:1': { book: copy, global: 600, updatedAt: 1 },
      'tb:1': { book: { ...copy, uid: 'tb:1' }, global: 900, updatedAt: 2 },
    });
    expect(otherCopyProgress(book)).toMatchObject({ global: 900 });
  });

  it('ignores finished copies, the first 30 s, and this copy itself', () => {
    progress.set({
      'loc:1': { book: copy, global: 600, finished: true, updatedAt: 3 },
      'tb:1': { book: { ...copy, uid: 'tb:1' }, global: 10, updatedAt: 2 },
      'abs:1': { book, global: 900, updatedAt: 1 },
    });
    expect(otherCopyProgress(book)).toBe(null);
  });

  it('is null for ebooks', () => {
    expect(otherCopyProgress({ ...book, kind: 'text' })).toBe(null);
  });
});
