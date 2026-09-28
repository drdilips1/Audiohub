// Send to Kindle: download the EPUB and hand it to Android's share sheet, where
// the Kindle app ("Send to Kindle") or an email to your @kindle.com address
// picks it up. Amazon accepts EPUB this way.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { settings } from './store.js';

const Web = registerPlugin('InkwellWeb');
const native = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');

export const canSendToKindle = (book) => !!book?.epubUrl;

/** Your Kindle's e-mail address (Settings → Send to Kindle), if set. */
export const kindleEmail = () => String(settings.get().kindleEmail || '').trim();

// Never leave a button spinning: give up after 5 minutes with a clear message.
const withLimit = (p) =>
  Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('The download is taking too long — try again, or open the link in the browser')), 5 * 60e3))]);

function share(url, name, mime, title) {
  const email = kindleEmail();
  return withLimit(Web.shareFile({ url, name, mime, title: email ? 'E-mail it to your Kindle' : title, email }));
}

export async function sendToKindle(book) {
  const name = `${(book.title || 'Book').slice(0, 80)}${book.author ? ` - ${book.author.split(',')[0]}` : ''}.epub`;
  if (native) return share(book.epubUrl, name, 'application/epub+zip', 'Send to Kindle');
  // Browser: download the EPUB, then upload it at amazon.com/sendtokindle.
  window.open(book.epubUrl, '_blank');
}

const MIME = { EPUB: 'application/epub+zip', PDF: 'application/pdf', MOBI: 'application/x-mobipocket-ebook', AZW3: 'application/vnd.amazon.ebook', AZW: 'application/vnd.amazon.ebook', TXT: 'text/plain' };

/** Share an ebook file (TorBox / Real-Debrid or a direct link): Kindle, or any reader app. */
export async function shareEbook(file, book) {
  const url = await file.resolve();
  if (native) return share(url, file.name, MIME[file.format] || 'application/octet-stream', `Send "${book.title}" to…`);
  window.open(url, '_blank');
}
