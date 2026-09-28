// "Listeners also enjoyed" and "More by <author>" rows, powered by the Audible
// catalogue. Works for any book: the Audible match is looked up by title/author.
import { useEffect, useState } from 'preact/hooks';
import { Row } from './common.jsx';
import { audible } from '../sources/catalogs.js';
import { enabled } from '../sources/index.js';
import { lookup } from '../lib/meta.js';
import { mainTitle } from '../lib/match.js';

const seeds = new Map(); // uid -> Promise<{ asin, author } | null>

function seedFor(book) {
  if (!seeds.has(book.uid)) {
    const firstAuthor = (book.author || '').split(',')[0].trim();
    const p = (async () => {
      if (book.uid.startsWith('au:')) return { asin: book.uid.slice(3), author: firstAuthor };
      const m = await lookup(book).catch(() => null);
      if (m?.asin) return { asin: m.asin, author: (m.author || firstAuthor).split(',')[0].trim() };
      const hit = await audible.find(mainTitle(book.title), firstAuthor).catch(() => null);
      return hit ? { asin: hit.uid.slice(3), author: (hit.author || firstAuthor).split(',')[0].trim() } : null;
    })();
    p.catch(() => seeds.delete(book.uid));
    seeds.set(book.uid, p);
  }
  return seeds.get(book.uid);
}

export function RelatedRows({ book, label }) {
  const [seed, setSeed] = useState(null);
  useEffect(() => {
    setSeed(null);
    if (!book || !enabled('au')) return;
    let alive = true;
    seedFor(book).then((s) => alive && setSeed(s || false));
    return () => (alive = false);
  }, [book?.uid]);
  if (!seed) return null;
  return (
    <>
      <Row
        title={label ? `Related to “${mainTitle(label)}”` : 'Listeners also enjoyed'}
        subtitle="Audible"
        icon="sparkle"
        load={() => audible.related(seed.asin)}
        deps={[seed.asin]}
      />
      {seed.author && (
        <Row
          title={`More by ${seed.author}`}
          subtitle="Top-ranked on Audible"
          icon="star"
          load={() => audible.byAuthor(seed.author).then((r) => r.filter((b) => b.uid !== 'au:' + seed.asin).map((b, i) => ({ ...b, rank: i + 1 })))}
          deps={[seed.asin, seed.author]}
        />
      )}
    </>
  );
}
