// Standard Ebooks: carefully produced, free public-domain ebooks. Search their
// catalogue page; read in-app (single-page edition) or send the EPUB to Kindle.
import { getText, qs } from '../lib/http.js';

const SE = 'https://standardebooks.org';

function toBook(path, title, author, cover) {
  const slug = path.replace(/^\/ebooks\//, '').replace(/\//g, '_');
  return {
    uid: 'se:' + path.replace(/^\/ebooks\//, ''),
    source: 'se',
    kind: 'text',
    title,
    author,
    cover: cover ? new URL(cover, SE).href : '',
    readUrl: `${SE}${path}/text/single-page`,
    epubUrl: `${SE}${path}/downloads/${slug}.epub?source=download`,
    link: SE + path,
  };
}

export async function search(term) {
  if (!term.trim()) return [];
  const html = await getText(`${SE}/ebooks?` + qs({ query: term.trim(), 'per-page': 24 }), { timeout: 15000 });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('li[typeof="schema:Book"]')]
    .map((li) => {
      const path = li.getAttribute('about') || li.querySelector('a[href^="/ebooks/"]')?.getAttribute('href') || '';
      const title = li.querySelector('[property="schema:name"]')?.textContent?.trim() || '';
      const author = [...li.querySelectorAll('[property="schema:author"] [property="schema:name"], .author [property="schema:name"]')].map((n) => n.textContent.trim()).filter(Boolean).join(', ');
      const img = li.querySelector('img')?.getAttribute('src') || '';
      return path && title ? toBook(path, title, author, img) : null;
    })
    .filter(Boolean);
}

export async function details(book) {
  if (book.description) return book;
  try {
    const html = await getText(book.link, { timeout: 15000 });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const desc = doc.querySelector('#description, section[id="description"]')?.textContent?.replace(/\s+/g, ' ').trim() || doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    return { ...book, description: desc };
  } catch {
    return book;
  }
}
