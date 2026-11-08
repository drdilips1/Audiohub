import { describe, it, expect, beforeAll } from 'vitest';

// stats.js reads stores from localStorage and listens on document: stub both.
const D = 864e5;
const now = Date.now();
const dk = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
let stats;
beforeAll(async () => {
  const mem = {};
  const days = {};
  for (let i = 1; i <= 4; i++) days[dk(now - i * D)] = { s: 3600, c: 4320, h: Array(24).fill(0), b: { 'x:new': 3600 } };
  mem['inkwell:listenLog'] = JSON.stringify({ since: now - 20 * D, days, books: { 'x:new': { title: 'New Book', author: 'A' } } });
  mem['inkwell:progress'] = JSON.stringify({
    'x:old': { kind: 'audio', global: 100 * 3600, total: 120 * 3600, updatedAt: now - 30 * D, book: { uid: 'x:old', title: 'Old Long Book', author: 'B' } },
    'x:new': { kind: 'audio', global: 4 * 4320, total: 20 * 3600, updatedAt: now, book: { uid: 'x:new', title: 'New Book', author: 'A' } },
  });
  globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v), removeItem: (k) => delete mem[k], key: () => null, length: 0 };
  globalThis.document = { addEventListener() {}, hidden: false };
  globalThis.window = globalThis;
  globalThis.addEventListener ??= () => {};
  stats = await import('../src/lib/stats.js');
});

describe('listening stats', () => {
  it('all time includes listening from before the log began, like the Library header', () => {
    const s = stats.summary('listen');
    expect(s.total).toBe(4 * 3600); // logged on this phone
    expect(s.allTime).toBeGreaterThanOrEqual(100 * 3600 + 4 * 3600);
    expect(stats.hoursListened()).toBe(s.allTime);
    expect(s.topBooks[0].book.title).toBe('Old Long Book');
  });
  it('guesses when a book will be finished from the recent pace', () => {
    const line = stats.finishLine('x:new');
    expect(line).toMatch(/^Started \d+ days ago · likely to finish in about \d+ days$/);
    // Started before the log began: no start date, nothing logged → nothing to say.
    expect(stats.finishLine('x:old')).toBe('');
  });
});
