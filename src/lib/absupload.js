// Send to Audiobookshelf: a book from your TorBox / Real-Debrid (or anything Play can stream)
// goes into your server, only the books you choose. The phone downloads it (the usual
// download, kept going in the background), then uploads the files into your library folder
// and asks the server to look for it. The phone's copy can be removed afterwards.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { persisted, abs } from './store.js';
import { downloads, downloadBook, removeDownload, canDownload } from './downloads.js';

const Native = registerPlugin('InkwellDownloads');
export const canSendToAbs = () => canDownload && Capacitor.isPluginAvailable('InkwellDownloads') && !!(abs.get().server && abs.get().token);

// uid -> { status: 'downloading' | 'uploading' | 'done' | 'error', pct, error, library, at }
export const absUploads = persisted('absUploads', {});
const patch = (uid, p) => absUploads.set((all) => ({ ...all, [uid]: { ...all[uid], ...p } }));
const busy = new Set();

const b0 = (d) => d.book || {};
const base = (u) => decodeURIComponent(String(u || '').split('?')[0].split('/').pop() || '');

/** Send one book. `keepOnPhone`: leave the phone's download there afterwards. */
export async function sendToAbs(book, { keepOnPhone = false } = {}) {
  if (!canSendToAbs()) throw new Error('Connect Audiobookshelf first (Settings → Audiobookshelf), in the Android app');
  const uid = book.uid;
  if (busy.has(uid)) return;
  busy.add(uid);
  const absSrc = await import('../sources/audiobookshelf.js');
  try {
    const target = await absSrc.uploadTarget();
    if (!target) throw new Error('No library folder found on your Audiobookshelf server');
    const had = downloads.get()[uid]?.status === 'done';
    if (!had) {
      patch(uid, { status: 'downloading', pct: 0, error: '', at: Date.now() });
      const { getDetails } = await import('../sources/index.js');
      const details = await getDetails(book);
      await downloadBook(details);
      if (downloads.get()[uid]?.status !== 'done') throw new Error(downloads.get()[uid]?.error || 'The download didn’t finish');
    }
    const d = downloads.get()[uid];
    // The file's own name (Audiobookshelf goes by the extension: .mp3, .m4b…). Downloads in the
    // phone's Downloads folder are known by a number, so the name saved with them is used.
    const ext = (n) => /\.[a-z0-9]{2,4}$/i.test(n || '');
    const files = (d.tracks || []).map((t, i) => {
      const own = ext(t.name) ? t.name : ext(base(t.uri)) ? base(t.uri) : '';
      return { uri: t.uri, size: t.size || 0, name: own || `${String(i + 1).padStart(3, '0')} - ${(t.title || 'part').replace(/[\\/:*?"<>|]/g, ' ')}.${(b0(d).format || 'mp3').toLowerCase()}` };
    });
    if (!files.length) throw new Error('No files to send');
    const b = d.book || book;
    patch(uid, { status: 'uploading', pct: 0, error: '', library: target.label });
    const job = `abs:${uid}:${Date.now()}`;
    const sub = Native.addListener('uploadProgress', (e) => e.job === job && e.total > 0 && patch(uid, { pct: Math.min(0.99, e.sent / e.total) }));
    try {
      const { url, token } = await absSrc.uploadAuth();
      await Native.uploadAbs({
        url,
        token,
        job,
        files,
        fields: { title: b.title || 'Audiobook', author: b.author || '', series: d.series || b.series || '', library: target.library, folder: target.folder },
      });
    } finally {
      sub.then((h) => h.remove());
    }
    absSrc.scanLibrary(target.library);
    patch(uid, { status: 'done', pct: 1, at: Date.now() });
    if (!keepOnPhone && !had) await removeDownload(uid).catch(() => {});
    return target;
  } catch (e) {
    patch(uid, { status: 'error', error: e.message });
    throw e;
  } finally {
    busy.delete(uid);
  }
}
