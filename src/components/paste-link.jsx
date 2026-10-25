// Paste any link in Discover's search box: a direct audio file (MP3, M4B…) plays and can be
// kept in your Library; an EPUB / PDF opens in the reader; an Internet Archive page opens
// that item; a podcast feed goes to Podcasts.
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { library, toggleLibrary, useStore } from '../lib/store.js';

export const isLink = (q) => /^https?:\/\/\S+$/i.test(String(q || '').trim());
const nameOf = (u) => {
  try {
    const last = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || '');
    return last.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]+/g, ' ').trim() || new URL(u).hostname;
  } catch {
    return 'Link';
  }
};

export function PasteLink({ q }) {
  const lib = useStore(library);
  const url = q.trim();
  const ia = url.match(/archive\.org\/(?:details|download)\/([^/?#]+)/i);
  const ebook = /\.(epub|pdf)(\?|#|$)/i.exec(url);
  const feed = /\.(rss|xml)(\?|#|$)|\/feed\/?$|\/rss\/?$/i.test(url);
  const title = nameOf(url);
  const book = { uid: 'url:' + encodeURIComponent(url), source: 'url', kind: 'audio', title, author: new URL(url).hostname.replace(/^www\./, ''), cover: '' };
  if (ia)
    return (
      <div class="paste-link pad">
        <button class="btn primary" onClick={() => nav.push('book', { book: { uid: 'ia:' + ia[1], source: 'ia', title: ia[1] } })}>
          <Icon name="book" size={16} /> Open this Internet Archive item
        </button>
      </div>
    );
  if (feed)
    return (
      <div class="paste-link pad">
        <button class="btn primary" onClick={() => nav.push('podcast', { show: { feedUrl: url, title: '' } })}>
          <Icon name="mic" size={16} /> Open this podcast feed
        </button>
      </div>
    );
  if (ebook) {
    const fmt = ebook[1].toUpperCase();
    return (
      <div class="paste-link pad">
        <button class="btn primary" onClick={() => nav.push('reader', { book: { uid: 'url:' + encodeURIComponent(url) + '#ebook', source: 'url', kind: 'text', title, ebookUrl: url, ebookName: title + '.' + ebook[1].toLowerCase(), ebookFormat: fmt } })}>
          <Icon name="book" size={16} /> Read this {fmt}
        </button>
      </div>
    );
  }
  const saved = !!lib[book.uid];
  return (
    <div class="paste-link pad">
      <p class="muted small">A link to an audio file (MP3, M4B, M4A…): play it here, and keep it in your Library to come back to.</p>
      <div class="paste-btns">
        <button
          class="btn primary"
          onClick={async () => {
            const { getDetails } = await import('../sources/index.js');
            nav.openOverlay('player');
            player.playBook(await getDetails(book)).catch?.((e) => toast(e.message));
          }}
        >
          <Icon name="play" size={16} /> Play this link
        </button>
        <button class="btn secondary" onClick={() => (toggleLibrary(book), toast(saved ? 'Removed from Library' : 'Saved to Library'))}>
          <Icon name={saved ? 'check' : 'plus'} size={16} /> {saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
}
