// Keeps the app's saved data well under the WebView's storage limit (about 5 MB for
// everything). Caches that only save time — looked-up details, ratings, AI answers,
// feeds — get a size budget; over it, their oldest entries go. Imported first in
// main.jsx, so stores read the trimmed copies. Your library, progress, settings and
// keys are never touched.
const P = 'inkwell:';
// key -> budget in characters (≈ bytes)
const BUDGETS = {
  metaCache: 1_000_000,
  podcastFeeds: 1_200_000,
  ratingsCache: 250_000,
  grPages: 250_000,
  aiCache: 250_000,
  transcriptCache: 300_000,
  bookSummaries: 300_000,
  sourceCache: 250_000,
  booksellerCache: 150_000,
  rowCache: 300_000,
  storyshotsFound: 100_000,
  askThreads: 300_000,
  moodShelves: 200_000,
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
