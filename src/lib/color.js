import { hashHue } from './format.js';

const memo = new Map();

// Extract a vivid average colour from a cover image. Falls back to a title-derived hue
// when the image can't be read (no CORS, missing cover, ...).
export function coverColor(src, seed = '') {
  const fallback = `hsl(${hashHue(seed || src || '')} 70% 55%)`;
  if (!src) return Promise.resolve(fallback);
  if (memo.has(src)) return memo.get(src);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const done = (c) => resolve(c || fallback);
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        const n = 24;
        c.width = c.height = n;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, n, n);
        const d = ctx.getImageData(0, 0, n, n).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2];
          const max = Math.max(R, G, B), min = Math.min(R, G, B);
          const sat = max ? (max - min) / max : 0;
          const weight = 0.15 + sat * sat * 3 * (max > 40 && max < 245 ? 1 : 0.2);
          r += R * weight; g += G * weight; b += B * weight; w += weight;
        }
        done(vivid(r / w, g / w, b / w));
      } catch {
        done(null);
      }
    };
    img.onerror = () => done(null);
    setTimeout(() => done(null), 6000);
    img.src = src;
  });
  memo.set(src, p);
  return p;
}

function vivid(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  let s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = Math.round(h * 60 + 360) % 360;
  s = Math.min(1, Math.max(0.45, s * 1.4));
  const L = Math.min(0.62, Math.max(0.45, l));
  return `hsl(${h} ${Math.round(s * 100)}% ${Math.round(L * 100)}%)`;
}
