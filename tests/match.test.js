// Title matching: phone copies, search titles, copycats, "another book".
import { describe, it, expect } from 'vitest';
import { words, mainTitle, searchTitle, surname, cleanAuthor, matches, otherBook, samePhoneBook, sinkCopycats } from '../src/lib/match.js';

describe('words / mainTitle', () => {
  it('ignores case, accents, punctuation and small words', () => {
    expect(words('The Café, & the Sea')).toEqual(['cafe', 'sea']);
  });

  it('drops subtitles and series tags', () => {
    expect(mainTitle('Dune: Deluxe Edition')).toBe('Dune');
    expect(mainTitle('Red Rising (Red Rising #1)')).toBe('Red Rising');
  });
});

describe('searchTitle (a title from a file or folder name)', () => {
  it('drops release words and numbered-file endings', () => {
    expect(searchTitle('The Selfish Gene Unabridged 2_005')).toBe('The Selfish Gene');
    expect(searchTitle('Sapiens Part 03.mp3')).toBe('Sapiens');
    expect(searchTitle('Atomic Habits [128kbps]')).toBe('Atomic Habits');
  });

  it('keeps numbers that are the title', () => {
    expect(searchTitle('1984')).toBe('1984');
    expect(searchTitle('Catch-22')).toBe('Catch-22');
  });
});

describe('surname', () => {
  it('skips degrees and suffixes', () => {
    expect(surname('Bruce H. Lipton PhD')).toBe('lipton');
    expect(surname('Martin Luther King Jr.')).toBe('king');
  });

  it('takes the first author', () => {
    expect(surname('Stephen King, Peter Straub')).toBe('king');
    expect(surname('')).toBe('');
  });
});

describe('matches', () => {
  it('finds a title inside a messy release name', () => {
    expect(matches('Rich Dad, Poor Dad', 'Kiyosaki - Rich Dad Poor Dad (2017) [MP3]')).toBe(true);
  });

  it('needs every significant word', () => {
    expect(matches('Rich Dad Poor Dad', 'Rich Dad Guide to Investing')).toBe(false);
  });
});

describe('otherBook (a result that is a different book borrowing the title)', () => {
  it('is false for the book itself with release details', () => {
    expect(otherBook('Dune (Unabridged) MP3', 'Dune', 'Frank Herbert')).toBe(false);
    expect(otherBook('Frank Herbert - Dune', 'Dune', 'Frank Herbert')).toBe(false);
    expect(otherBook('Dune: Deluxe Edition', 'Dune', 'Frank Herbert')).toBe(false);
  });

  it('is true for sequels and longer titles', () => {
    expect(otherBook('Dune Messiah', 'Dune', 'Frank Herbert')).toBe(true);
    expect(otherBook('The Greatest Secret', 'The Secret', 'Rhonda Byrne')).toBe(true);
    expect(otherBook('Morning Star (Red Rising #3)', 'Red Rising', 'Pierce Brown')).toBe(true);
  });
});

describe('samePhoneBook (phone copy first)', () => {
  const book = { title: '12 Rules for Life', author: 'Jordan B. Peterson' };

  it('takes a phone copy whose title starts with the book title', () => {
    expect(samePhoneBook(book, { title: '12 Rules for Life An Antidote to Chaos', author: 'Jordan Peterson' })).toBe(true);
  });

  it('takes it by folder name, after an author name in front', () => {
    expect(samePhoneBook(book, { title: 'Track 01', rawName: 'Jordan Peterson - 12 Rules for Life' })).toBe(true);
  });

  it('does not take a different book that contains the title', () => {
    expect(samePhoneBook(book, { title: 'Beyond Order: 12 More Rules for Life', author: 'Jordan Peterson' })).toBe(false);
  });

  it('does not take the same title by another author', () => {
    expect(samePhoneBook(book, { title: '12 Rules for Life', author: 'Someone Else' })).toBe(false);
  });

  it('takes it when the phone copy has no author', () => {
    expect(samePhoneBook(book, { title: '12 Rules for Life' })).toBe(true);
  });
});

describe('sinkCopycats (Audible copycats below the real book)', () => {
  const real = { title: '12 Rules for Life', author: 'Jordan B. Peterson', rating: 4.7 };
  const copycat = { title: '12 Rules for Life In English', author: 'Someone Else' };
  const fresh = { title: 'A New Release', author: 'New Author' };

  it('moves unrated copycats by other authors below the real book', () => {
    expect(sinkCopycats([copycat, real, fresh])).toEqual([real, fresh, copycat]);
  });

  it("keeps the real author's own unrated editions in place", () => {
    const own = { title: '12 Rules for Life (Hindi)', author: 'Jordan B. Peterson' };
    expect(sinkCopycats([own, real])).toEqual([own, real]);
  });

  it('leaves the list as it is without a rated book', () => {
    expect(sinkCopycats([copycat, fresh])).toEqual([copycat, fresh]);
  });
});

describe('author names with degrees', () => {
  it('drops degrees and titles, keeps real names', () => {
    expect(cleanAuthor('Brené Brown PhD LMSW')).toBe('Brené Brown');
    expect(cleanAuthor('Dr. Joe Dispenza')).toBe('Joe Dispenza');
    expect(cleanAuthor('Peter Attia MD, Bill Gifford')).toBe('Peter Attia, Bill Gifford');
    expect(cleanAuthor('Ma Jian')).toBe('Ma Jian');
  });
  it('finds the real surname', () => {
    expect(surname('Brené Brown PhD LMSW')).toBe('brown');
    expect(surname('Gabor Maté MD')).toBe('maté');
  });
});
