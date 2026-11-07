// Android Auto, the app's side: tells the car which books to list (Continue listening,
// Recently played, Downloaded — kept on the phone so the car shows them with the app closed),
// prepares a book the car picks (as when you tap Play), and takes back the places books
// reached when they played from the car with the app closed.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { progress, library, persisted } from './store.js';
import { downloads } from './downloads.js';

const ON = Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('InkwellPlayer');
const Native = registerPlugin('InkwellPlayer');

// Stream links of books played in the app (the last 10): with the app closed, the car can
// play them from these until they expire (TorBox's after some hours; Audiobookshelf's last).
const streams = persisted('carStreams', {}); // uid -> { at, headers, parts: [{ i, url, title }] }
async function keepStreams() {
  const { getState } = await import('./player.js');
  const st = getState();
  const b = st.book;
  if (!b?.uid || /^pod:/.test(b.uid) || !st.tracks?.length) return;
  const parts = st.tracks.map((t, i) => (/^https?:/i.test(t.url || '') ? { i, url: t.url, title: t.title || `Part ${i + 1}` } : null)).filter(Boolean);
  if (!parts.length) return;
  const old = streams.get()[b.uid];
  if (old && old.parts.length === parts.length && old.parts.every((p, k) => p.url === parts[k].url)) return;
  streams.set((all) => {
    const next = { ...all, [b.uid]: { at: Date.now(), headers: st.tracks.find((t) => t.headers)?.headers || {}, parts } };
    const keep = Object.entries(next).sort((x, y) => y[1].at - x[1].at).slice(0, 10);
    return Object.fromEntries(keep);
  });
}

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
    continue: recent.filter(([, p]) => !p.finished).slice(0, 15).map(([uid, p]) => ({ ...item(uid, p.book, p), parts: parts(uid), stream: streams.get()[uid] })),
    recent: recent.slice(0, 25).map(([uid, p]) => ({ ...item(uid, p.book, p), parts: parts(uid), stream: streams.get()[uid] })),
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

// What the car asked for and what happened → Report a problem (as "Android Auto" lines).
async function takeLog() {
  try {
    const { json } = await Native.takeCarLog();
    const lines = JSON.parse(json || '[]');
    if (!lines.length) return;
    const { logError } = await import('./report.js');
    for (const l of lines) logError('Android Auto', l);
  } catch {}
}

if (ON) {
  takeLog();
  setInterval(takeLog, 60000);
  progress.subscribe(push);
  downloads.subscribe(push);
  streams.subscribe(push);
  // Keep the playing book's links (checked now and then; only stored when they change).
  setInterval(() => keepStreams().catch(() => {}), 20000);
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
    setTimeout(takeLog, 35000);
    const book = bookFor(id);
    if (!book) {
      const { logError } = await import('./report.js');
      logError('Android Auto', `the car picked a book the app doesn't have in its lists (${id})`);
      return;
    }
    try {
      const [{ getDetails }, player] = await Promise.all([import('../sources/index.js'), import('./player.js')]);
      const details = await getDetails(book);
      await player.playBook(details);
      // Started (whichever way it got there): the car plays it too.
      await Native.carReady().catch(() => {});
    } catch (e) {
      const { logError } = await import('./report.js');
      logError('Android Auto', `${e?.message || e} — “${book.title || id}”`);
    }
  });
}
