import { describe, it, expect, beforeAll } from 'vitest';

let rl;
beforeAll(async () => {
  const mem = {};
  globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v), removeItem: (k) => delete mem[k], key: () => null, length: 0 };
  globalThis.document = { addEventListener() {}, hidden: false };
  globalThis.window = globalThis;
  globalThis.addEventListener ??= () => {};
  rl = await import('../src/lib/readlists.js');
});

describe('a read list pasted from notes', () => {
  it('understands the usual ways of writing a line', () => {
    expect(rl.parseLine('Dune by Frank Herbert ★★★★★')).toEqual({ title: 'Dune', author: 'Frank Herbert', rating: 5 });
    expect(rl.parseLine('Dune - Frank Herbert - 4/5')).toEqual({ title: 'Dune', author: 'Frank Herbert', rating: 4 });
    expect(rl.parseLine('1. Sapiens, Yuval Noah Harari (8/10)')).toEqual({ title: 'Sapiens', author: 'Yuval Noah Harari', rating: 4 });
    expect(rl.parseLine('Atomic Habits | James Clear | 3 stars')).toEqual({ title: 'Atomic Habits', author: 'James Clear', rating: 3 });
    expect(rl.parseLine('The Hobbit\tTolkien\t5')).toEqual({ title: 'The Hobbit', author: 'Tolkien', rating: 5 });
    expect(rl.parseLine('- Project Hail Mary — Andy Weir')).toEqual({ title: 'Project Hail Mary', author: 'Andy Weir', rating: 0 });
    expect(rl.parseLine('Educated')).toEqual({ title: 'Educated', author: '', rating: 0 });
    expect(rl.parseLine('   ')).toBe(null);
  });
  it('rated books become ratings, the rest "already read", and both show as read elsewhere', () => {
    const r = rl.importReadList('Dune by Frank Herbert ★★★★★\nProject Hail Mary - Andy Weir\n\nThe Road - Cormac McCarthy - 2/5');
    expect(r).toEqual({ rated: 2, read: 1, total: 3 });
    const titles = rl.readElsewhere().map((b) => b.title).sort();
    expect(titles).toEqual(['Dune', 'Project Hail Mary', 'The Road']);
  });
});
