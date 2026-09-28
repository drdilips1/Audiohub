// Player backgrounds: the cover (blurred), living colour, plain, a built-in wallpaper,
// or your own photo (kept on the phone, never uploaded).
import { useEffect, useState } from 'preact/hooks';

export const WALLPAPERS = [
  ['aurora', 'Aurora'],
  ['nebula', 'Nebula'],
  ['mountains', 'Moonlit peaks'],
  ['ocean', 'Night sea'],
  ['dunes', 'Dunes'],
  ['forest', 'Misty pines'],
  ['sunset', 'Retro sunset'],
  ['liquid', 'Liquid glow'],
  ['marble', 'Black marble'],
  ['city', 'City lights'],
];
export const wallpaperUrl = (id, thumb = false) => `./wallpapers/${id}${thumb ? '-thumb' : ''}.jpg`;

const CACHE = 'audiohub-wallpaper';
const KEY = '/my-wallpaper.jpg';

/** Shrink a picked photo to a phone-sized JPEG and keep it. */
export async function saveCustom(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 2340 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
  const cache = await caches.open(CACHE);
  await cache.put(KEY, new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } }));
  bump++;
  listeners.forEach((f) => f());
}

let bump = 0;
const listeners = new Set();

/** Object URL of your own photo, or '' when none is saved. */
export function useCustomWallpaper(enabled = true) {
  const [url, setUrl] = useState('');
  const [v, setV] = useState(bump);
  useEffect(() => {
    const f = () => setV(bump);
    listeners.add(f);
    return () => listeners.delete(f);
  }, []);
  useEffect(() => {
    if (!enabled || typeof caches === 'undefined') return;
    let u = '';
    caches
      .open(CACHE)
      .then((c) => c.match(KEY))
      .then((r) => r && r.blob())
      .then((b) => b && setUrl((u = URL.createObjectURL(b))))
      .catch(() => {});
    return () => u && URL.revokeObjectURL(u);
  }, [enabled, v]);
  return url;
}
