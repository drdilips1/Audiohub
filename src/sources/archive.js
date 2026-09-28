// Internet Archive — hosts the full LibriVox catalogue plus thousands of other
// free spoken-word recordings. Search + metadata APIs are CORS-enabled.
import { getJson, qs } from '../lib/http.js';
import { first, parseLength, stripHtml } from '../lib/format.js';

const AUDIO_COLLECTIONS = '(collection:librivoxaudio OR collection:audio_bookspoetry OR collection:oldtimeradio)';

export const cover = (id) => `https://archive.org/services/img/${encodeURIComponent(id)}`;

function toBook(d) {
  return {
    uid: 'ia:' + d.identifier,
    source: 'ia',
    kind: 'audio',
    title: cleanTitle(first(d.title) || d.identifier),
    author: first(d.creator) || '',
    cover: cover(d.identifier),
    year: first(d.year) || '',
    downloads: d.downloads,
  };
}

function cleanTitle(t) {
  return String(t).replace(/\s*\((version \d+|dramatic reading|abridged)\)\s*$/i, (m) => m).replace(/\s+/g, ' ').trim();
}

export async function query(q, { sort = 'downloads desc', rows = 30, page = 1, anyCollection = false } = {}) {
  const url =
    'https://archive.org/advancedsearch.php?' +
    qs({
      q: `(${q}) AND mediatype:audio${anyCollection ? '' : ` AND ${AUDIO_COLLECTIONS}`}`,
      'fl[]': ['identifier', 'title', 'creator', 'downloads', 'year'],
      'sort[]': sort,
      rows,
      page,
      output: 'json',
    });
  const data = await getJson(url);
  return (data.response?.docs || []).map(toBook);
}

export const popular = () => query('collection:librivoxaudio', { rows: 24 });
export const newest = () => query('collection:librivoxaudio', { sort: 'addeddate desc', rows: 24 });
/** Free Hindi audio (stories, poetry, talks) across all Internet Archive collections. */
export const hindi = (topic = '') => query(`language:(hin OR hindi OR Hindi)${topic ? ` AND (${topic})` : ''}`, { rows: 40, anyCollection: true });
export const bySubject = (s) => query(`subject:(${s}) OR title:(${s})`, { rows: 30 });

export function search(term) {
  const t = term.replace(/[():"]/g, ' ').trim();
  if (!t) return Promise.resolve([]);
  return query(`title:(${t}) OR creator:(${t}) OR subject:(${t})`, { rows: 30 });
}

const FORMAT_PREF = ['64Kbps MP3', 'VBR MP3', '128Kbps MP3', 'MP3', '32Kbps MP3', 'Ogg Vorbis'];

export async function details(book) {
  const id = book.uid.slice(3);
  const meta = await getJson(`https://archive.org/metadata/${encodeURIComponent(id)}`);
  const m = meta.metadata || {};
  const files = meta.files || [];
  const byFormat = {};
  for (const f of files) (byFormat[f.format] ||= []).push(f);
  const fmt = FORMAT_PREF.find((f) => byFormat[f]?.length) || Object.keys(byFormat).find((f) => /mp3/i.test(f));
  const audio = (byFormat[fmt] || []).filter((f) => f.source !== 'metadata' || /mp3|ogg/i.test(f.name));
  audio.sort((a, b) => (parseInt(a.track) || 0) - (parseInt(b.track) || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const tracks = audio.map((f, i) => ({
    title: f.title || f.name.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '),
    url: `https://archive.org/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
    duration: parseLength(f.length),
    index: i,
  }));
  return {
    ...book,
    title: cleanTitle(first(m.title) || book.title),
    author: first(m.creator) || book.author,
    year: first(m.year) || first(m.date)?.slice(0, 4) || book.year,
    description: stripHtml(m.description),
    subjects: [].concat(m.subject || []).flatMap((s) => String(s).split(/[;,]/)).map((s) => s.trim()).filter(Boolean).slice(0, 10),
    language: first(m.language),
    tracks,
    duration: tracks.reduce((a, t) => a + (t.duration || 0), 0),
    link: `https://archive.org/details/${id}`,
  };
}
