// New episodes downloaded by themselves, for shows you switch it on for (show settings):
// on Wi-Fi, when the app opens and when podcasts refresh. Each show keeps its newest few;
// older downloads of it that you've played are removed.
import * as pod from '../sources/podcasts.js';
import { downloads, downloadBook, removeDownload, canDownload } from './downloads.js';

// Wi-Fi only (when the phone says what it's on; unknown counts as fine).
const onWifi = () => {
  const c = navigator.connection;
  return !c?.type || c.type === 'wifi' || c.type === 'ethernet';
};

let running = false;
export async function autoDownload({ refresh = true } = {}) {
  if (!canDownload || running || !onWifi()) return;
  const shows = Object.entries(pod.showPrefs.get()).filter(([, p]) => p.autoDl > 0);
  if (!shows.length) return;
  running = true;
  try {
    const latest = refresh ? await pod.refreshAll().catch(() => pod.cachedLatest()) : pod.cachedLatest();
    const dls = downloads.get();
    for (const [feedUrl, prefs] of shows) {
      const eps = latest.filter((e) => e.feedUrl === feedUrl && !pod.isHidden(e));
      const keep = eps.filter((e) => !pod.isPlayed(e)).slice(0, prefs.autoDl);
      for (const e of keep) {
        const d = dls[e.uid];
        if (d && (d.status === 'done' || d.status === 'downloading')) continue;
        await downloadBook(pod.asBook(e, e.podcast)).catch(() => {});
      }
      // Older downloads of this show that you've played go.
      const keepIds = new Set(keep.map((e) => e.uid));
      for (const d of Object.values(downloads.get())) {
        const b = d?.book;
        if (b?.source === 'pod' && b.feedUrl === feedUrl && !keepIds.has(b.uid) && d.status === 'done' && pod.isPlayed(b)) await removeDownload(b.uid).catch(() => {});
      }
    }
  } finally {
    running = false;
  }
}
