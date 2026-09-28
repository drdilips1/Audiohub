// LibriVox — volunteer-read public-domain audiobooks. Results link to their
// Internet Archive mirror (better covers + track metadata) when available.
import { getJson, qs } from '../lib/http.js';
import { parseLength, stripHtml } from '../lib/format.js';
import { cover as iaCover } from './archive.js';

const API = 'https://librivox.org/api/feed/audiobooks/?';

function iaId(b) {
  const m = /archive\.org\/details\/([^/?#]+)/.exec(b.url_iarchive || '');
  return m ? m[1] : null;
}

function toBook(b) {
  const ia = iaId(b);
  const author = (b.authors || []).map((a) => `${a.first_name || ''} ${a.last_name || ''}`.trim()).join(', ');
  return {
    uid: ia ? 'ia:' + ia : 'lv:' + b.id,
    source: ia ? 'ia' : 'lv',
    via: 'lv',
    kind: 'audio',
    title: b.title,
    author,
    cover: b.coverart_jpg || b.coverart_thumbnail || (ia ? iaCover(ia) : ''),
    year: b.copyright_year && b.copyright_year !== '0' ? b.copyright_year : '',
    duration: Number(b.totaltimesecs) || 0,
    description: stripHtml(b.description),
    _raw: b,
  };
}

async function fetchBooks(params) {
  try {
    const data = await getJson(API + qs({ format: 'json', extended: 1, coverart: 1, limit: 30, ...params }));
    return (data.books || []).map(toBook);
  } catch (e) {
    if (e.status === 404) return []; // LibriVox answers 404 for "no results"
    throw e;
  }
}

export async function search(term) {
  const t = term.trim();
  if (!t) return [];
  const [byTitle, byAuthor] = await Promise.all([
    fetchBooks({ title: '^' + t }),
    fetchBooks({ author: '^' + t.split(/\s+/).pop() }).catch(() => []),
  ]);
  const seen = new Set();
  return [...byTitle, ...byAuthor].filter((b) => !seen.has(b.uid) && seen.add(b.uid));
}

export async function details(book) {
  let raw = book._raw;
  if (!raw) {
    const data = await getJson(API + qs({ format: 'json', extended: 1, coverart: 1, id: book.uid.slice(3) }));
    raw = data.books?.[0];
  }
  const b = toBook(raw);
  const tracks = (raw.sections || []).map((s, i) => ({
    title: s.title || `Section ${s.section_number}`,
    url: s.listen_url,
    duration: parseLength(s.playtime),
    index: i,
  }));
  return { ...book, ...b, uid: book.uid, source: book.source, tracks, link: raw.url_librivox };
}
