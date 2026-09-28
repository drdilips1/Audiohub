// "Play when ready": remembers torrents the user asked to play while TorBox /
// Real-Debrid were still downloading them, checks progress in the background
// and starts playback (or says it's ready) the moment the download finishes.
import { persisted } from './store.js';
import * as cloud from '../sources/debrid.js';
import { getDetails } from '../sources/index.js';
import * as player from './player.js';
import { nav } from './nav.js';
import { toast } from '../components/common.jsx';

export const waitlist = persisted('waitlist', []); // [{ hash, provider, magnet, title, author, cover, progress, state, ready, addedAt }]

const INTERVAL = 20000;
let timer = null;
let checking = false;

export function wait(entry) {
  waitlist.set((list) => [{ ...entry, ready: false, addedAt: Date.now() }, ...list.filter((w) => w.hash !== entry.hash)]);
  schedule(4000);
}

export function cancel(hash) {
  waitlist.set((list) => list.filter((w) => w.hash !== hash));
}

export async function playNow(w) {
  const shown = { uid: 'wait:' + w.hash, source: w.provider === 'torbox' ? 'tb' : 'rd', kind: 'audio', title: w.bookTitle || w.title, author: w.author || '', cover: w.cover || '' };
  nav.openOverlay('player');
  // The player opens at once with "Opening the book…" while the link is prepared.
  return player.openAndPlay(shown, async () => {
    const stub = await cloud.prepareMagnet(w.provider, { magnet: w.magnet, hash: w.hash, title: w.title });
    const details = await getDetails({ ...stub, title: w.bookTitle || stub.title, author: w.author || stub.author, cover: w.cover || stub.cover });
    cancel(w.hash);
    return details;
  });
}

async function check() {
  const list = waitlist.get();
  if (!list.length || checking) return;
  checking = true;
  try {
    cloud.forget();
    const status = await cloud.accountStatus();
    let started = false;
    const next = [];
    for (const w of list) {
      const s = status.get(w.hash);
      if (!s) {
        next.push(w);
        continue;
      }
      const updated = { ...w, progress: s.progress, state: s.state, ready: s.ready };
      if (s.ready && !w.ready) {
        const busy = player.getState().playing;
        if (!busy && !started) {
          started = true;
          toast(`“${w.bookTitle || w.title}” is ready — starting playback`);
          playNow(updated).catch((e) => toast(e.message));
          continue; // removed by playNow
        }
        toast(`“${w.bookTitle || w.title}” is ready to play`);
      }
      next.push(updated);
    }
    // Keep entries playNow may already have removed out of the list.
    waitlist.set((cur) => next.filter((n) => cur.some((c) => c.hash === n.hash)));
  } catch {
    // network hiccup: try again next round
  } finally {
    checking = false;
  }
}

function schedule(delay = INTERVAL) {
  clearTimeout(timer);
  if (!waitlist.get().some((w) => !w.ready)) return;
  timer = setTimeout(async () => {
    await check();
    schedule();
  }, delay);
}

// Resume checks when the app comes back to the foreground, and on launch.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') schedule(1000);
});
schedule(3000);
