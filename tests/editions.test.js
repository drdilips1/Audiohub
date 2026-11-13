import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {} }) }));
const { judge, lengthOf } = await import('../src/lib/editions.js');

describe('edition check', () => {
  const full = { runtime: 41220, narrator: 'Sam Reader' };
  it('full, abridged, incomplete', () => {
    expect(judge({ duration: 41160, narrator: 'Sam Reader' }, full).tag).toBe('full');
    expect(judge({ duration: 21480, narrator: 'Jo Narrator' }, full)).toMatchObject({ tag: 'abridged', otherNarrator: true });
    expect(judge({ duration: 35460 }, full).tag).toBe('incomplete');
  });
  it('says nothing without lengths', () => {
    expect(judge({ duration: 0 }, full).tag).toBe('');
    expect(judge({ duration: 40000 }, null).tag).toBe('');
  });
  it('adds up parts when each length is known', () => {
    expect(lengthOf({ tracks: [{ duration: 100 }, { duration: 200 }] })).toBe(300);
    expect(lengthOf({ tracks: [{ duration: 100 }, {}] })).toBe(0);
  });
});
