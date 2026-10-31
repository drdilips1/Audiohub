// Keeps the app's saved data well under the WebView's storage limit (about 5 MB for
// everything; the caches together stay under about 4 MB). Caches that only save time — looked-up details, ratings, AI answers,
// feeds — get a size budget; over it, their oldest entries go. Imported first in
// main.jsx, so stores read the trimmed copies. Your library, progress, settings and
// keys are never touched.
const P = 'inkwell:';
// key -> budget in characters (≈ bytes)
const BUDGETS = {
  metaCache: 700_000,
  podcastFeeds: 700_000,
  ratingsCache: 200_000,
  grPages: 150_000,
  aiCache: 200_000,
  transcriptCache: 200_000,
  bookSummaries: 200_000,
  sourceCache: 200_000,
  booksellerCache: 100_000,
  rowCache: 200_000,
  storyshotsFound: 80_000,
  askThreads: 200_000,
  moodShelves: 150_000,
  xray: 250_000,
  seriesCache: 150_000,
  heroCache: 80_000,
};

const stamp = (v) => (v && typeof v === 'object' ? v.t || v.updatedAt || v.at || 0 : 0);

/** Drop a cache's oldest entries until it fits its budget (or clear it when it isn't a keyed map). */
function fit(key, budget) {
  const raw = localStorage.getItem(P + key);
  if (!raw || raw.length <= budget) return;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return localStorage.removeItem(P + key);
    const entries = Object.entries(obj).sort((a, b) => stamp(b[1]) - stamp(a[1]));
    // Keep the newest entries that fit in about 70% of the budget (room to grow).
    const out = {};
    let size = 2;
    for (const [k, v] of entries) {
      const n = k.length + JSON.stringify(v).length + 4;
      if (size + n > budget * 0.7) break;
      out[k] = v;
      size += n;
    }
    localStorage.setItem(P + key, JSON.stringify(out));
  } catch {
    localStorage.removeItem(P + key);
  }
}

export function trimStorage() {
  try {
    for (const [k, b] of Object.entries(BUDGETS)) fit(k, b);
  } catch {}
}

/** Storage is full: shrink every cache hard so the important write can go through. */
export function emergencyTrim() {
  try {
    for (const [k, b] of Object.entries(BUDGETS)) fit(k, Math.floor(b / 4));
  } catch {}
}

trimStorage();
