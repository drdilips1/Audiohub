// Images from plain-http hosts (e.g. an Audiobookshelf server on the LAN) are
// fetched through native HTTP on Android and shown as data URLs, because the
// WebView may refuse insecure / local-network image loads.
import { useEffect, useState } from 'preact/hooks';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { abs } from './store.js';

const cache = new Map();
const native = Capacitor.isNativePlatform();

const isAbs = (url) => {
  const { server, altServer, token } = abs.get();
  return !!(token && ((server && url.startsWith(server)) || (altServer && url.startsWith(altServer))));
};

export function needsProxy(url) {
  return native && !!url && (/^http:\/\//i.test(url) || isAbs(url));
}

export function loadImage(url) {
  if (!needsProxy(url)) return Promise.resolve(url);
  if (cache.has(url)) return cache.get(url);
  const headers = isAbs(url) ? { Authorization: `Bearer ${abs.get().token}` } : {};
  const p = CapacitorHttp.get({ url, headers, responseType: 'blob', connectTimeout: 15000, readTimeout: 20000 })
    .then((res) => {
      if (res.status >= 400 || !res.data) throw new Error('HTTP ' + res.status);
      const h = res.headers || {};
      const type = h['Content-Type'] || h['content-type'] || 'image/jpeg';
      return typeof res.data === 'string' && res.data.startsWith('data:') ? res.data : `data:${type.split(';')[0]};base64,${res.data}`;
    })
    .catch((e) => {
      cache.delete(url);
      throw e;
    });
  cache.set(url, p);
  return p;
}

export function useImage(url) {
  const [src, setSrc] = useState(needsProxy(url) ? null : url);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!needsProxy(url)) return setSrc(url);
    let alive = true;
    setSrc(null);
    loadImage(url)
      .then((s) => alive && setSrc(s))
      .catch(() => alive && setFailed(true));
    return () => (alive = false);
  }, [url]);
  return { src, failed };
}

// Covers that come padded (a portrait cover on a white or coloured square, as some
// stores send them): find the plain bars around the real cover, so it can be zoomed
// to fill the square instead of showing the bars. Not stretched — the cover is only
// scaled up evenly and its middle kept. Results are remembered per picture.
const frames = new Map();
const small = (url) => (/media-amazon\.com|images-amazon\.com/.test(url) ? url.replace(/\._[A-Z0-9_,]+_\.(jpg|jpeg|png)/i, '._SL96_.$1') : url);
const FRAME_KEY = 'coverFrames';
let saved = null;
function savedFrames() {
  if (saved) return saved;
  try {
    saved = JSON.parse(localStorage.getItem(FRAME_KEY) || '{}');
  } catch {
    saved = {};
  }
  return saved;
}
// Saved a few seconds after the last one found (not once per cover while scrolling).
let saveTimer = null;
function keep(url, f) {
  const all = savedFrames();
  all[url] = f;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keys = Object.keys(all);
    if (keys.length > 1500) for (const k of keys.slice(0, 300)) delete all[k];
    try {
      localStorage.setItem(FRAME_KEY, JSON.stringify(all));
    } catch {}
  }, 4000);
}

/** The real cover inside a padded picture as fractions { x, y, w, h }, or null (nothing to trim). */
export function coverFrame(url) {
  if (!url) return Promise.resolve(null);
  const known = savedFrames()[url];
  if (known !== undefined) return Promise.resolve(known);
  if (frames.has(url)) return frames.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      let f = null;
      try {
        f = findFrame(img);
      } catch {
        return resolve(null); // the host doesn't allow reading its pictures: leave it as it is
      }
      keep(url, f);
      resolve(f);
    };
    img.onerror = () => resolve(null);
    img.src = url.startsWith('data:') ? url : small(url);
  });
  frames.set(url, p);
  return p;
}

function findFrame(img) {
  // Only square pictures (a cover padded to a square); others are already cropped to fit.
  const ratio = img.naturalWidth / img.naturalHeight;
  if (!(ratio > 0.92 && ratio < 1.08)) return null;
  const W = 64;
  const H = Math.max(8, Math.round((W * img.naturalHeight) / img.naturalWidth));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data; // throws when the picture can't be read
  const px = (x, y) => {
    const i = (y * W + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
  const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 36;
  // The bar colour: the corners must agree.
  const corners = [px(0, 0), px(W - 1, 0), px(0, H - 1), px(W - 1, H - 1)];
  const bg = corners[0];
  if (!corners.every((k) => near(k, bg))) return null;
  const plainCol = (x) => {
    let n = 0;
    for (let y = 0; y < H; y++) if (near(px(x, y), bg)) n++;
    return n / H > 0.97;
  };
  const plainRow = (y, x0, x1) => {
    let n = 0;
    for (let x = x0; x <= x1; x++) if (near(px(x, y), bg)) n++;
    return n / (x1 - x0 + 1) > 0.97;
  };
  let l = 0;
  let r = W - 1;
  while (l < W / 2 && plainCol(l)) l++;
  while (r > W / 2 && plainCol(r)) r--;
  let t = 0;
  let b = H - 1;
  while (t < H / 2 && plainRow(t, l, r)) t++;
  while (b > H / 2 && plainRow(b, l, r)) b--;
  const w = (r - l + 1) / W;
  const h = (b - t + 1) / H;
  // Only real padding: at least 6% trimmed, and the rest still a cover-sized picture.
  if (w * h > 0.94 || w < 0.4 || h < 0.4) return null;
  return { x: l / W, y: t / H, w, h };
}

/** The real cover inside the padding isn't square (a tall book cover)? */
export const frameTall = (f) => !!f && (f.w / f.h < 0.85 || f.w / f.h > 1.18);

/** CSS that zooms the picture so its real cover fills the (square) box. */
export function frameStyle(f) {
  if (!f) return undefined;
  // A tall book cover inside a square picture: zooming it to fill would cut off its top and
  // bottom — show the picture as it is.
  if (frameTall(f)) return { objectViewBox: `inset(${f.y * 100}% ${(1 - f.x - f.w) * 100}% ${(1 - f.y - f.h) * 100}% ${f.x * 100}%)`, objectFit: 'contain' };
  const s = Math.min(3, 1 / Math.min(f.w, f.h));
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  // Keep the zoomed cover covering the box: don't move past its edges.
  const half = 0.5 / s;
  const clamp = (c) => Math.min(Math.max(c, half), 1 - half);
  const ox = clamp(cx);
  const oy = clamp(cy);
  return { transform: `translate(${(0.5 - ox) * s * 100}%, ${(0.5 - oy) * s * 100}%) scale(${s})` };
}
