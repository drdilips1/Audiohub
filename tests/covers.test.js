import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/http.js', () => ({ getJson: vi.fn(), getText: vi.fn(), qs: (o) => new URLSearchParams(o).toString() }));
vi.mock('../src/sources/catalogs.js', () => ({ audibleRating: vi.fn(), audible: { search: vi.fn() }, googleBooks: { search: vi.fn() } }));
const { searchTitle, sameBook } = await import('../src/lib/meta.js');

describe('cover search from file names', () => {
  it('turns file names into words', () => {
    expect(searchTitle('SayNothing-1')).toBe('Say Nothing');
    expect(searchTitle('CATCH22')).toBe('CATCH 22');
    expect(searchTitle('the_book_thief')).toBe('the book thief');
    expect(searchTitle('Bel Canto')).toBe('Bel Canto');
  });
  it('matches the same book spelled differently', () => {
    expect(sameBook({ title: 'SayNothing-1', author: '' }, { title: 'Say Nothing: A True Story', author: 'Patrick Radden Keefe' })).toBe(true);
    expect(sameBook({ title: 'CATCH22', author: '' }, { title: 'Catch-22', author: 'Joseph Heller' })).toBe(true);
    expect(sameBook({ title: 'Sapiens', author: 'Yuval Noah Harari' }, { title: 'Sapiens: A Brief History', author: 'Yuval Noah Harari' })).toBe(true);
    expect(sameBook({ title: 'Sapiens', author: '' }, { title: 'Homo Deus', author: 'Yuval Noah Harari' })).toBe(false);
  });
});
