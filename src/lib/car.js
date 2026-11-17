// Android Auto, the app's side: tells the car which books to list (Continue listening,
// Recently played, Downloaded — kept on the phone so the car shows them with the app closed),
// prepares a book the car picks (as when you tap Play), and takes back the places books
// reached when they played from the car with the app closed.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { progress, library, persisted, abs, debrid } from './store.js';
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

// TorBox books: how the car fetches their parts itself (fresh links each time, so they never
// expire) — worked out by the app for the books in your car lists.
const recipes = persisted('carRecipes', {}); // uid -> { at, parts }
const isTb = (uid) => /^tb:/.test(uid || '');
let filling = false;
async function fillRecipes(uids) {
  if (filling) return;
  const want = uids.filter((u) => isTb(u) && Date.now() - (recipes.get()[u]?.at || 0) > 12 * 3600e3).slice(0, 30);
  if (!want.length) return;
  filling = true;
  try {
    const { tbRecipe } = await import('../sources/debrid.js');
    const lists = {};
    const got = {};
    for (const uid of want) {
      const r = await tbRecipe({ uid }, lists).catch(() => null);
      got[uid] = r ? { at: Date.now(), parts: r.parts } : { at: Date.now(), parts: [] };
    }
    recipes.set((all) => {
      const next = { ...all, ...got };
      // Only books still in the car's lists are kept.
      return Object.fromEntries(Object.entries(next).sort((a, b) => b[1].at - a[1].at).slice(0, 60));
    });
  } finally {
    filling = false;
  }
}

const recipeOf = (uid) => (recipes.get()[uid]?.parts?.length ? recipes.get()[uid].parts : undefined);
function catalog() {
  const prog = progress.get();
  const dls = downloads.get();
  const audio = Object.entries(prog).filter(([, p]) => p && p.kind !== 'text' && p.book && !/^pod:/.test(p.book.uid || ''));
  const recent = audio.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  const parts = (uid) => {
    const d = dls[uid];
    if (d?.status === 'done' && d.tracks?.length) return d.tracks.map((t, i) => ({ url: t.uri, title: t.title || `Part ${i + 1}` }));
    // A podcast episode: its own audio link (plays in the car with the app closed too).
    const b = prog[uid]?.book;
    if (b?.source === 'pod' && b.tracks?.[0]?.url) return b.tracks.map((t, i) => ({ url: t.url, title: t.title || b.title || `Part ${i + 1}` }));
    return undefined;
  };
  return {
    continue: recent.filter(([, p]) => !p.finished).slice(0, 15).map(([uid, p]) => ({ ...item(uid, p.book, p), parts: parts(uid), stream: streams.get()[uid], recipe: recipeOf(uid) })),
    recent: recent.slice(0, 25).map(([uid, p]) => ({ ...item(uid, p.book, p), parts: parts(uid), stream: streams.get()[uid], recipe: recipeOf(uid) })),
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
    const c = catalog();
    fillRecipes([...c.continue, ...c.recent].map((x) => x.id)).catch(() => {});
    const json = JSON.stringify(c);
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
  recipes.subscribe(push);
  // Your TorBox key, kept by the phone for the car (as your server's sign-in is).
  let tbSent = null;
  const pushTb = async () => {
    const { torboxKey } = await import('../sources/debrid.js');
    const key = torboxKey();
    if (key === tbSent) return;
    tbSent = key;
    Native.setCarTorbox({ key }).catch(() => {});
  };
  pushTb();
  debrid.subscribe(() => pushTb().catch(() => {}));
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

  // A book picked in the car: open it and play from your place. (`book`: one found by a search
  // in the car, not in the app's lists.)
  Native.addListener('carPlay', ({ id, book }) => {
    Native.carAck().catch(() => {});
    let given = null;
    try {
      given = book ? JSON.parse(book) : null;
    } catch {}
    return playId(id, given);
  });

  // Your Audiobookshelf for the car: its addresses and your sign-in, handed over whenever they
  // change — so the car can search it and play from it even with the app closed.
  let pushedAt = 0;
  const pushAbs = () => {
    const c = abs.get();
    pushedAt = Date.now();
    const libraryIds = [c.libraryId].filter(Boolean);
    const json = c.server && c.token ? JSON.stringify({ server: c.server, altServer: c.altServer || '', token: c.token, refreshToken: c.refreshToken || '', libraryIds, at: pushedAt }) : '';
    Native.setCarAbs({ json }).catch(() => {});
  };
  // The car renewed the sign-in while the app was closed: take the newer one.
  const takeAbs = () =>
    Native.takeCarAbs()
      .then(({ json }) => {
        const got = json ? JSON.parse(json) : null;
        if (got?.renewedAt && got.renewedAt > pushedAt && got.token && got.token !== abs.get().token) abs.patch({ token: got.token, refreshToken: got.refreshToken || abs.get().refreshToken });
      })
      .catch(() => {});
  takeAbs().finally(() => {
    pushAbs();
    abs.subscribe(pushAbs);
  });
  setInterval(takeAbs, 60000);
  // The car's request to your server was refused: renew the sign-in (handed over by pushAbs).
  Native.addListener('carAbsRenew', async () => {
    try {
      await (await import('../sources/audiobookshelf.js')).uploadAuth();
    } catch {}
  });

  // Search in the car: your other sources (the car asks your server itself).
  Native.addListener('carSearch', async ({ query, token }) => {
    let list = [];
    try {
      list = await carSearch(query);
    } catch {}
    Native.carSearchResults({ token, json: JSON.stringify(list) }).catch(() => {});
  });

  // "Hey Google, play … on AudioYam": a match from the car's lists (id), else any book of yours
  // whose title / author has the words, else the search opens with them.
  Native.addListener('voicePlay', async ({ id, query }) => {
    if (id) return playId(id);
    const words = String(query || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
    if (!words.length) return;
    const pool = [...Object.values(progress.get()).map((p) => p?.book), ...Object.values(library.get()), ...Object.values(downloads.get()).map((d) => d?.book)].filter((b) => b?.uid && !/^pod:/.test(b.uid));
    const score = (b) => words.filter((w) => `${b.title || ''} ${b.author || ''}`.toLowerCase().includes(w)).length;
    const best = pool.map((b) => [b, score(b)]).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] * 2 >= words.length && !/\b(where|when|scene|moment|chapter|part|back|forward|skip|sleep|speed|pause|stop|resume)\b/i.test(query)) return playBook(best[0]);
    // Anything else said to the car goes to the app's voice button: a command ("back 30
    // seconds", "sleep in 20 minutes"), a scene ("play the part where…"), a chapter, a book or a
    // question (answered aloud).
    if (words.length >= 2) {
      try {
        const { runSaid } = await import('../components/scene-cmd.jsx');
        await runSaid(String(query).replace(/\b(on|in|using|with) audio ?hub\+?.*$/i, '').trim());
        await Native.carReady().catch(() => {});
        return;
      } catch {}
    }
    // Not yours yet: your cloud and server copies, then the best torrent from your sources —
    // as the app's own "play …" voice command does.
    const want = wantOf(query);
    try {
      const { playScene } = await import('./voicecmd.js');
      await playScene(query, () => {}, { action: 'play_book', title: want.title, author: want.author, moment: false });
      await Native.carReady().catch(() => {});
    } catch (e) {
      const { logError } = await import('./report.js');
      logError('Android Auto', `voice “${query}”: ${e.message}`);
      const { openSearch } = await import('../screens/Discover.jsx');
      openSearch(query);
    }
  });
}

/** "atomic habits by james clear on audiohub" → { title: 'atomic habits', author: 'james clear' } */
function wantOf(q) {
  const s = String(q || '').replace(/\b(on|in|using|with) audio ?(hub|yam)\+?.*$/i, '').replace(/^(play|listen to|start|read)\s+/i, '').trim();
  const m = /^(.+?)\s+by\s+(.+)$/i.exec(s);
  return m ? { title: m[1].trim(), author: m[2].trim() } : { title: s, author: '' };
}

// Books a search in the car found (from your sources), by the id the car shows.
const carFound = new Map();

/**
 * Search in the car, in the app: your phone, downloads and Library first, your TorBox /
 * Real-Debrid, then the source add-ons' audiobook torrents (instant ones and the best seeded
 * first). [{ id, title, author, artwork }]
 */
async function carSearch(query) {
  const want = wantOf(query);
  const out = [];
  const seen = new Set();
  const addBook = (b, sub) => {
    if (!b?.uid || b.kind === 'text' || /^pod:|^abs:/.test(b.uid) || seen.has(b.uid)) return;
    seen.add(b.uid);
    const id = 'src:' + b.uid;
    carFound.set(id, { book: b });
    out.push({ ...item(b.uid, b), id, author: [b.author, sub].filter(Boolean).join(' · ') });
  };
  const [{ matches, mainTitle }, cloud, local] = await Promise.all([import('./match.js'), import('../sources/debrid.js'), import('../sources/local.js')]);
  const fits = (b) => matches(want.title, `${b.title || ''} ${b.author || ''} ${b.rawName || ''}`);
  // Yours already: the phone, downloads, played before, your Library.
  for (const b of [...(await local.search(want.title).catch(() => [])), ...Object.values(downloads.get()).filter((d) => d?.status === 'done').map((d) => d.book), ...Object.values(progress.get()).map((p) => p?.book), ...Object.values(library.get())]) if (b && fits(b)) addBook(b, 'yours');
  // Your cloud.
  for (const b of await cloud.search(want.title).catch(() => [])) addBook(b, b.source === 'rd' ? 'Real-Debrid' : 'TorBox');
  // Sources: audiobook torrents, through your TorBox / Real-Debrid (instant first, then seeds).
  const provider = cloud.preferredProvider((await import('./store.js')).settings.get().debridPreferred);
  if (provider) {
    const { searchSources } = await import('../sources/sourceaddons.js');
    const got = [];
    await Promise.race([searchSources({ title: want.title, author: want.author }, (name, list) => got.push(...(list || []))), new Promise((r) => setTimeout(r, 9000))]);
    const ebookish = /\b(epub|pdf|mobi|azw3?|ebook)\b/i;
    const ready = (r) => !!(provider === 'torbox' ? r.cache?.torbox : r.cache?.realdebrid);
    const list = got
      .filter((r) => r && !r.loose && (r.magnet || r.hash) && r.contentType !== 'ebook' && !ebookish.test(`${r.title} ${r.format || ''}`) && r.seeders !== 0)
      .sort((x, y) => Number(ready(y)) - Number(ready(x)) || (y.seeders || 0) - (x.seeders || 0))
      .slice(0, 6);
    list.forEach((r, i) => {
      const id = `src:find:${r.hash || i}`;
      if (seen.has(id)) return;
      seen.add(id);
      carFound.set(id, { result: r, provider, want });
      out.push({ id, title: mainTitle(want.title) ? `${r.title}`.slice(0, 80) : r.title, author: [ready(r) ? 'ready now' : r.seeders ? `${r.seeders} seeds` : '', r.format || ''].filter(Boolean).join(' · '), artwork: '' });
    });
  }
  return out.slice(0, 20);
}

async function playId(id, given = null) {
  setTimeout(takeLog, 35000);
  // Found by a search in the car.
  const hit = carFound.get(id);
  if (hit?.result) return playResult(hit);
  const book = hit?.book || bookFor(id) || (id.startsWith('abs:') && given ? { uid: id, source: 'abs', kind: 'audio', title: given.title || 'Audiobook', author: given.author || '' } : null);
  if (!book) {
    const { logError } = await import('./report.js');
    logError('Android Auto', `the car picked a book the app doesn't have in its lists (${id})`);
    return;
  }
  return playBook(book);
}

/** A source's torrent picked in the car: through your TorBox / Real-Debrid, then it plays. */
async function playResult({ result, provider, want }) {
  try {
    const [cloud, { getDetails }, player] = await Promise.all([import('../sources/debrid.js'), import('../sources/index.js'), import('./player.js')]);
    const stub = await cloud.prepareMagnet(provider, result, () => {});
    const details = await getDetails({ ...stub, title: want.title || stub.title, author: want.author || result.author || stub.author });
    await player.playBook(details, { exact: true });
    await Native.carReady().catch(() => {});
  } catch (e) {
    const { logError } = await import('./report.js');
    logError('Android Auto', `${e.pending ? 'still downloading in your cloud' : e.message} — “${result.title}”`);
  }
}

async function playBook(book) {
  try {
    const [{ getDetails }, player] = await Promise.all([import('../sources/index.js'), import('./player.js')]);
    // A podcast episode is ready to play as it is (its audio link is in it).
    const details = book.source === 'pod' && book.tracks?.length ? book : await getDetails(book, { fast: true });
    await player.playBook(details);
    // Started (whichever way it got there): the car plays it too.
    await Native.carReady({ id: player.getState().book?.uid || book.uid }).catch(() => {});
  } catch (e) {
    const { logError } = await import('./report.js');
    logError('Android Auto', `${e?.message || e} — “${book.title || book.uid}”`);
  }
}
