// Android Auto, the app's side: tells the car which books to list (Continue listening,
// Recently played, Downloaded — kept on the phone so the car shows them with the app closed),
// prepares a book the car picks (as when you tap Play), and takes back the places books
// reached when they played from the car with the app closed.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { progress, library } from './store.js';
import { downloads } from './downloads.js';

const ON = Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('InkwellPlayer');
const Native = registerPlugin('InkwellPlayer');

const https = (u) => (/^https:\/\//i.test(u || '') ? u : '');
const item = (uid, b, p) => ({
  id: uid,
  title: b?.title || 'Audiobook',
  author: b?.author || '',
  artwork: https(b?.cover),
  track: p?.track || 0,
  time: p?.time || 0,
});

function catalog() {
  const prog = progress.get();
  const dls = downloads.get();
  const audio = Object.entries(prog).filter(([, p]) => p && p.kind !== 'text' && p.book && !/^pod:/.test(p.book.uid || ''));
  const recent = audio.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  const parts = (uid) => {
    const d = dls[uid];
    return d?.status === 'done' && d.tracks?.length ? d.tracks.map((t, i) => ({ url: t.uri, title: t.title || `Part ${i + 1}` })) : undefined;
  };
  return {
    continue: recent.filter(([, p]) => !p.finished).slice(0, 15).map(([uid, p]) => ({ ...item(uid, p.book, p), parts: parts(uid) })),
    recent: recent.slice(0, 25).map(([uid, p]) => item(uid, p.book, p)),
    downloaded: Object.entries(dls)
      .filter(([, d]) => d?.status === 'done' && d.tracks?.length && d.book)
      .sort((a, b) => (b[1].finishedAt || 0) - (a[1].finishedAt || 0))
      .slice(0, 30)
      .map(([uid, d]) => ({ ...item(uid, d.book, prog[uid]), parts: parts(uid) })),
  };
}

let last = '';
let timer = 0;
function push() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const json = JSON.stringify(catalog());
    if (json === last) return;
    last = json;
    Native.setCarCatalog({ json }).catch(() => {});
  }, 4000);
}

/** The book the car picked, as a summary the app can open (from your progress, library or downloads). */
function bookFor(uid) {
  return progress.get()[uid]?.book || library.get()[uid] || downloads.get()[uid]?.book || null;
}

if (ON) {
  progress.subscribe(push);
  downloads.subscribe(push);
  push();

  // Places reached in the car with the app closed: newer than what the app has → taken.
  Native.takeCarProgress()
    .then(({ json }) => {
      const got = JSON.parse(json || '{}');
      const ids = Object.keys(got);
      if (!ids.length) return;
      progress.set((all) => {
        const next = { ...all };
        for (const uid of ids) {
          const g = got[uid];
          const cur = all[uid];
          if (!cur || (cur.updatedAt || 0) < g.at) next[uid] = { ...(cur || { kind: 'audio', book: bookFor(uid) }), track: g.track, time: g.time, updatedAt: g.at };
        }
        return next;
      });
    })
    .catch(() => {});

  // A book picked in the car: open it and play from your place.
  Native.addListener('carPlay', async ({ id }) => {
    const book = bookFor(id);
    if (!book) return;
    try {
      const [{ getDetails }, player] = await Promise.all([import('../sources/index.js'), import('./player.js')]);
      const details = await getDetails(book);
      await player.playBook(details);
    } catch (e) {
      const { logError } = await import('./report.js');
      logError('Android Auto', `${e?.message || e} — “${book.title || id}”`);
    }
  });
}
