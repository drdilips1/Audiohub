// Open Library — discovery, trending lists, rich descriptions and covers.
// Works found here are cross-matched against audio and ebook sources.
import { getJson, qs } from '../lib/http.js';

const coverUrl = (id, size = 'L') => (id ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : '');

function toBook(w) {
  return {
    uid: 'ol:' + w.key.replace('/works/', ''),
    source: 'ol',
    kind: 'discover',
    title: w.title,
    author: (w.author_name || (w.authors || []).map((a) => a.name) || []).slice(0, 2).join(', '),
    cover: coverUrl(w.cover_i || w.cover_id),
    year: w.first_publish_year || '',
  };
}

export async function trending(period = 'weekly') {
  const data = await getJson(`https://openlibrary.org/trending/${period}.json?limit=24`);
  return (data.works || []).filter((w) => w.cover_i).map(toBook);
}

export async function subject(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const data = await getJson(`https://openlibrary.org/subjects/${slug}.json?limit=24`);
  return (data.works || []).map(toBook);
}

export async function search(term) {
  if (!term.trim()) return [];
  const data = await getJson(
    'https://openlibrary.org/search.json?' +
      qs({ q: term, limit: 24, fields: 'key,title,author_name,cover_i,first_publish_year' })
  );
  return (data.docs || []).map(toBook);
}

export async function details(book) {
  const w = await getJson(`https://openlibrary.org/works/${book.uid.slice(3)}.json`);
  const d = typeof w.description === 'string' ? w.description : w.description?.value || '';
  return {
    ...book,
    description: d.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/-{5,}[\s\S]*$/, '').trim(),
    subjects: (w.subjects || []).slice(0, 10),
    cover: book.cover || coverUrl(w.covers?.[0]),
    link: `https://openlibrary.org/works/${book.uid.slice(3)}`,
  };
}
