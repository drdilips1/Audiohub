// Offline downloads: saves every part of an audiobook to the phone, then plays
// from the local files. Location: public Downloads/Audiohub (visible in the file
// manager) or private app storage — chosen in Settings → Downloads.
import { metaNow } from './meta.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { persisted, settings, summarize } from './store.js';

const Native = registerPlugin('InkwellDownloads');
export const canDownload = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellDownloads');

export const downloads = persisted('downloads', {}); // uid -> { book, status, tracks, done, total, bytes, location, error }

const safe = (s) => String(s || 'Audiobook').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const EXT = /\.(mp3|m4b|m4a|aac|flac|ogg|oga|opus|wav|mka)(?:[?#]|$)/i;
const MIME = { mp3: 'audio/mpeg', m4b: 'audio/mp4', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', mka: 'audio/x-matroska' };

const patch = (uid, part) => downloads.set((all) => ({ ...all, [uid]: { ...(all[uid] || {}), ...part } }));

export const isDownloaded = (uid) => downloads.get()[uid]?.status === 'done';
export const isRunning = (uid) => running.has(uid);

/** Swap streaming URLs for the local files of a downloaded book. */
export function applyLocal(details) {
  const d = downloads.get()[details.uid];
  if (!d || d.status !== 'done' || !d.tracks?.length) return details;
  return {
    ...details,
    resolveTracks: undefined,
    chaptersMeta: details.chaptersMeta,
    tracks: d.tracks.map((t, i) => ({ title: t.title, url: t.uri, duration: t.duration, offset: t.offset, index: i })),
    offline: true,
  };
}

let running = new Set();

/** Download every part of `details` (from sources.getDetails). */
/**
 * Where a book is saved: Audiohub/Author/Series/03 - Title, or Audiohub/Author/Title
 * without a series (the layout Audiobookshelf and most players read).
 */
export function folderFor(details) {
  const first = (details.author || '').split(/,|&| and /)[0].trim();
  const author = first ? safe(first) : 'Unknown author';
  const title = safe(details.title);
  const m = /^(.*?)\s*#\s*([\d.]+)\s*$/.exec(details.series || '');
  if (m && m[1].trim()) {
    const n = m[2].includes('.') ? m[2] : m[2].padStart(2, '0');
    return `Audiohub/${author}/${safe(m[1])}/${n} - ${title}`;
  }
  if ((details.series || '').trim()) return `Audiohub/${author}/${safe(details.series)}/${title}`;
  return `Audiohub/${author}/${title}`;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Download every part of `details` (from sources.getDetails). Parts already saved
 * (a paused or interrupted download) are kept; each part is tried up to three times,
 * with a fresh link when one has expired.
 */
export async function downloadBook(details, { resume = false } = {}) {
  if (!canDownload) throw new Error('Downloads work in the Android app');
  const uid = details.uid;
  if (running.has(uid)) return;
  running.add(uid);
  const job = `${uid}:${Date.now()}`;
  const target = settings.get().downloadTarget || 'public';
  const before = downloads.get()[uid];
  const keepParts = resume && before?.tracks?.length ? before.tracks : [];
  const folder = keepParts.length && before.folder ? before.folder : folderFor(details);
  patch(uid, { book: summarize(details), series: details.series || '', folder, status: 'downloading', done: keepParts.length, error: '', job, tracks: keepParts, tries: 0 });
  const sub = Native.addListener('progress', (e) => {
    if (e.job === job) patch(uid, { current: e.received, currentTotal: e.total });
  });
  const stopped = () => ['cancelled', 'paused'].includes(downloads.get()[uid]?.status);
  try {
    let tracks = details.tracks;
    if (!tracks?.length && details.resolveTracks) tracks = (await details.resolveTracks()).tracks;
    if (!tracks?.length) throw new Error('Nothing to download for this title');
    patch(uid, { total: tracks.length });
    const saved = keepParts.slice(0, tracks.length);
    let bytes = saved.reduce((n, t) => n + (t.size || 0), 0);
    for (let i = saved.length; i < tracks.length; i++) {
      if (stopped()) throw new Error('stopped');
      let t = tracks[i];
      let r = null;
      for (let attempt = 0; attempt < 3 && !r; attempt++) {
        if (stopped()) throw new Error('stopped');
        try {
          const url = t.url || (t.resolve ? await t.resolve() : null);
          if (!url) throw new Error(`No link for part ${i + 1}`);
          if (/^file:|^content:/.test(url)) {
            r = { uri: url, size: t.size || 0, local: true };
            break;
          }
          const ext = ((EXT.exec(url) || [])[1] || (EXT.exec(t.title || '') || [])[1] || 'mp3').toLowerCase();
          const name = `${String(i + 1).padStart(3, '0')} - ${safe(t.title).slice(0, 60)}.${ext}`;
          r = await Native.download({ url, headers: t.headers || {}, name, folder, target, job, mime: MIME[ext] || 'audio/mpeg' });
        } catch (e) {
          if (stopped() || e.message === 'cancelled') throw new Error('stopped');
          if (attempt === 2) throw e;
          patch(uid, { tries: attempt + 1, error: `Part ${i + 1}: ${e.message} — trying again` });
          await wait(attempt === 0 ? 3000 : 10000);
          // Links from the cloud expire: ask for fresh ones before the next try.
          if (details.resolveTracks) {
            try {
              const fresh = (await details.resolveTracks()).tracks;
              if (fresh?.[i]) t = fresh[i];
            } catch {}
          }
        }
      }
      bytes += r.size || 0;
      saved.push({ title: t.title, uri: r.uri, duration: t.duration, offset: t.offset, size: r.size });
      patch(uid, { done: i + 1, bytes, location: r.location || downloads.get()[uid]?.location, tracks: saved.slice(), current: 0, currentTotal: 0, error: '', tries: 0 });
    }
    patch(uid, { status: 'done', tracks: saved, bytes, finishedAt: Date.now(), error: '' });
  } catch (e) {
    const st = downloads.get()[uid]?.status;
    if (st === 'cancelled') {
      const keep = downloads.get()[uid]?.tracks || [];
      await Promise.all(keep.map((t) => Native.remove({ uri: t.uri }).catch(() => {})));
      downloads.set((all) => {
        const n = { ...all };
        delete n[uid];
        return n;
      });
    } else if (st === 'paused') {
      patch(uid, { current: 0, currentTotal: 0 }); // the parts saved so far stay
    } else {
      patch(uid, { status: 'error', error: e.message, current: 0, currentTotal: 0 });
      throw e;
    }
  } finally {
    running.delete(uid);
    sub.then((h) => h.remove());
  }
}

/** Pause: the part being saved stops; finished parts stay for Resume. */
export async function pauseDownload(uid) {
  const d = downloads.get()[uid];
  if (!d || d.status !== 'downloading') return;
  patch(uid, { status: 'paused' });
  await Native.cancel({ job: d.job }).catch(() => {});
}

/** Resume a paused, failed or interrupted download (fresh links from your service). */
export async function resumeDownload(uid) {
  const d = downloads.get()[uid];
  if (!d?.book) return;
  const { getDetails } = await import('../sources/index.js');
  const details = await getDetails({ ...d.book, series: d.series });
  return downloadBook({ ...details, uid }, { resume: true });
}

// The app was closed (or crashed) mid-download: those continue on their own.
if (canDownload)
  setTimeout(async () => {
    const stuck = Object.entries(downloads.get()).filter(([uid, d]) => d?.status === 'downloading' && !running.has(uid));
    for (const [uid] of stuck) patch(uid, { status: 'paused', error: 'Interrupted — resuming' });
    for (const [uid] of stuck) await resumeDownload(uid).catch((e) => patch(uid, { status: 'error', error: e.message }));
  }, 6000);

export async function cancelDownload(uid) {
  const d = downloads.get()[uid];
  if (!d) return;
  if (!running.has(uid)) return removeDownload(uid); // paused / failed: just delete what's saved
  patch(uid, { status: 'cancelled' });
  await Native.cancel({ job: d.job }).catch(() => {});
}

export async function removeDownload(uid) {
  const d = downloads.get()[uid];
  if (!d) return;
  if (d.status === 'downloading' && running.has(uid)) return cancelDownload(uid);
  await Promise.all((d.tracks || []).map((t) => Native.remove({ uri: t.uri }).catch(() => {})));
  downloads.set((all) => {
    const n = { ...all };
    delete n[uid];
    return n;
  });
}

export const publicAvailable = () => (canDownload ? Native.publicAvailable().then((r) => r.available).catch(() => false) : Promise.resolve(false));

export function fmtBytes(n) {
  if (!n) return '0 MB';
  return n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n < 1e7 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e6)} MB`;
}

/** Downloads not yet in their Author / Series / Title folder. */
export function unsorted() {
  return Object.entries(downloads.get()).filter(([, d]) => d.status === 'done' && d.book && d.folder !== targetFolder(d));
}
const targetFolder = (d) => folderFor({ ...d.book, series: d.series || metaNow(d.book)?.series || '' });

/** Move earlier downloads into Author / Series / Title folders. Returns { moved, failed }. */
export async function sortDownloads(onProgress) {
  const todo = unsorted();
  let moved = 0;
  let failed = 0;
  for (const [uid, d] of todo) {
    onProgress?.(moved + failed, todo.length, d.book.title);
    const folder = targetFolder(d);
    const tracks = [];
    let location = d.location;
    let ok = true;
    for (const t of d.tracks || []) {
      try {
        const r = await Native.move({ uri: t.uri, folder });
        tracks.push({ ...t, uri: r.uri });
        location = r.location;
      } catch {
        tracks.push(t); // stays where it was, still plays
        ok = false;
      }
    }
    patch(uid, { tracks, location, ...(ok ? { folder } : {}) });
    ok ? moved++ : failed++;
  }
  return { moved, failed };
}
