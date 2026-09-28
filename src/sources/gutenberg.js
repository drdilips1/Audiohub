// Project Gutenberg via the Gutendex JSON API — 75k+ free ebooks to read in-app.
import { getJson, getText, qs } from '../lib/http.js';

const API = 'https://gutendex.com/books/?';

function htmlUrl(f = {}) {
  const k = Object.keys(f).find((k) => k.startsWith('text/html'));
  return k ? f[k] : null;
}

function toBook(b) {
  const authors = (b.authors || []).map((a) => a.name.split(', ').reverse().join(' '));
  return {
    uid: 'gb:' + b.id,
    source: 'gb',
    kind: 'text',
    title: b.title.replace(/\s*[;:]\s*$/, ''),
    author: authors.join(', '),
    cover: b.formats?.['image/jpeg'] || '',
    year: b.authors?.[0]?.death_year ? `† ${b.authors[0].death_year}` : '',
    subjects: [...(b.bookshelves || []).map((s) => s.replace(/^Browsing:\s*/, '')), ...(b.subjects || [])].slice(0, 10),
    downloads: b.download_count,
    // Canonical HTML edition (the /ebooks/N.html.images URL redirects here, which
    // would break relative image paths).
    readUrl: htmlUrl(b.formats) ? `https://www.gutenberg.org/cache/epub/${b.id}/pg${b.id}-images.html` : null,
    epubUrl: b.formats?.['application/epub+zip'],
    summary: (b.summaries || [])[0] || '',
  };
}

async function list(params) {
  const data = await getJson(API + qs(params));
  return (data.results || []).map(toBook);
}

export const popular = (lang = 'en') => list({ languages: lang });
export const byTopic = (topic, lang = 'en') => list({ topic, languages: lang });
export const search = (term) => (term.trim() ? list({ search: term.trim() }) : Promise.resolve([]));

export async function details(book) {
  if (book.readUrl && book.subjects) {
    return { ...book, description: book.summary || book.description || '', link: `https://www.gutenberg.org/ebooks/${book.uid.slice(3)}` };
  }
  const data = await getJson(`https://gutendex.com/books/${book.uid.slice(3)}`);
  const b = toBook(data);
  return { ...book, ...b, description: b.summary, link: `https://www.gutenberg.org/ebooks/${b.uid.slice(3)}` };
}

// Fetch and sanitize a Gutenberg HTML edition for the in-app reader.
export async function loadText(book) {
  const url = book.readUrl;
  const html = await getText(url);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,link,meta,iframe,object,embed,form,#pg-header,#pg-footer,section.pg-boilerplate,.pg-boilerplate').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'style' || n === 'class' && !/chapter|poem|stanza|center/i.test(a.value)) el.removeAttribute(a.name);
      if ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
    if (el.tagName === 'IMG' && el.getAttribute('src')) el.setAttribute('src', new URL(el.getAttribute('src'), url).href);
    if (el.tagName === 'IMG') el.setAttribute('loading', 'lazy');
    if (el.tagName === 'A' && /^https?:/i.test(el.getAttribute('href') || '')) el.setAttribute('target', '_blank');
  });
  const headings = [...doc.body.querySelectorAll('h1,h2,h3')]
    .map((h, i) => {
      h.id ||= 'iw-h-' + i;
      return { id: h.id, text: h.textContent.replace(/\s+/g, ' ').trim(), level: +h.tagName[1] };
    })
    .filter((h) => h.text && h.text.length < 120);
  return { html: doc.body.innerHTML, headings };
}
