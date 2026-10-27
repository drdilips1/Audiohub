// Your own notes — highlights, bookmarks (with their notes and quotes) and ratings —
// are also kept as small files in the app's own storage. The web storage the app normally
// uses has a hard limit of about 5 MB for everything; when it's full a new save fails and
// the note is gone after a restart. The files don't have that limit. On start, whichever
// copy was saved last wins.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { bookmarks } from './store.js';
import { myRatings } from './taste.js';
import { highlights } from './highlights.js';
import { logError } from './report.js';

const Web = registerPlugin('InkwellWeb');
const native = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');
const STAMPS = 'inkwell:keepStamps'; // key -> when its web-storage copy last saved for sure

const KEPT = { highlights, bookmarks, myRatings };

const readStamps = () => {
  try {
    return JSON.parse(localStorage.getItem(STAMPS) || '{}') || {};
  } catch {
    return {};
  }
};

function watch(key, store) {
  let timer;
  store.subscribe((value) => {
    clearTimeout(timer);
    // After the store's own save (150 ms): note whether web storage really has it.
    timer = setTimeout(() => {
      const text = JSON.stringify(value);
      const t = Date.now();
      Web.keepWrite({ name: key, text: JSON.stringify({ t, v: value }) }).catch((e) => logError('keep', `${key}: ${e.message}`));
      let saved = false;
      try {
        saved = localStorage.getItem('inkwell:' + key) === text;
        if (saved) localStorage.setItem(STAMPS, JSON.stringify({ ...readStamps(), [key]: t }));
      } catch {}
      if (!saved) logError('storage', `Couldn't save ${key} in web storage (full?) — kept in the app's files instead`);
    }, 600);
  });
}

async function restore(key, store) {
  try {
    const { text } = await Web.keepRead({ name: key });
    const file = text ? JSON.parse(text) : null;
    const local = JSON.stringify(store.get());
    if (!file) {
      // First run with this: start the file from what's here.
      if (local !== '{}') Web.keepWrite({ name: key, text: JSON.stringify({ t: Date.now(), v: store.get() }) }).catch(() => {});
      return;
    }
    if ((file.t || 0) > (readStamps()[key] || 0) && JSON.stringify(file.v) !== local) store.set(file.v);
  } catch (e) {
    logError('keep', `${key}: ${e.message}`);
  }
}

if (native)
  for (const [key, store] of Object.entries(KEPT)) {
    restore(key, store).finally(() => watch(key, store));
  }
