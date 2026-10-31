// Send to Kindle. With a Gmail sender and Kindle addresses set up (Settings → Send to
// Kindle), the book is downloaded and e-mailed straight to the Kindle through Gmail
// (native GmailSender). Otherwise it goes to Android's share sheet, where the Kindle app
// or an e-mail to your @kindle.com address picks it up. Amazon accepts EPUB and PDF.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { settings, kindle } from './store.js';
import { toast } from '../components/common.jsx';

const Web = registerPlugin('InkwellWeb');
const native = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');

export const canSendToKindle = (book) => !!book?.epubUrl;

// The single address saved by earlier versions becomes the first Kindle in the list.
{
  const old = String(settings.get().kindleEmail || '').trim();
  if (old && !kindle.get().targets.length) kindle.set((k) => ({ ...k, targets: [{ name: 'My Kindle', email: old }] }));
  if (old) settings.set((s) => ({ ...s, kindleEmail: '' }));
}

/** Your first Kindle's e-mail address, if any. */
export const kindleEmail = () => kindle.get().targets[0]?.email || '';
/** Sends straight from Gmail (Android app with a sender and a Kindle set up). */
export const sendsDirect = () => native && kindle.get().senders.length > 0 && kindle.get().targets.length > 0;

// "Which Kindle?" — shown by KindleChooser (components/kindle-chooser.jsx).
let asker = null;
export const setKindleAsker = (f) => (asker = f);

/** Where to send: { to: [emails], label, sender } — asks when there's more than one choice. */
async function chooseTarget() {
  const { targets, senders } = kindle.get();
  if (targets.length === 1 && senders.length === 1) return { to: [targets[0].email], label: targets[0].name, sender: senders[0] };
  if (!asker) return { to: [targets[0].email], label: targets[0].name, sender: senders[0] };
  return asker({ targets, senders });
}

// Never leave a button spinning: give up after 5 minutes with a clear message.
const withLimit = (p) =>
  Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('The download is taking too long — try again, or open the link in the browser')), 5 * 60e3))]);

async function share(url, name, mime, title) {
  if (sendsDirect()) {
    const pick = await chooseTarget();
    if (!pick) return; // cancelled
    toast(`Sending to ${pick.label}…`);
    await withLimit(Web.mailFile({ url, name, mime, to: pick.to, from: pick.sender.email, password: pick.sender.password }));
    toast(`Sent to ${pick.label} — it shows up on the Kindle in a few minutes`);
    return;
  }
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
  // Amazon's e-mail service no longer takes MOBI / AZW3: say so instead of sending into the void.
  if (sendsDirect() && /^(MOBI|AZW3?)$/.test(file.format || '')) throw new Error(`Amazon doesn't accept ${file.format} by e-mail any more — pick an EPUB or PDF of this book`);
  const url = await file.resolve();
  if (native) return share(url, file.name, MIME[file.format] || 'application/octet-stream', `Send "${book.title}" to…`);
  window.open(url, '_blank');
}
