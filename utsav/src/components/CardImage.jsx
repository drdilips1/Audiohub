// A card drawn from its spec. Thumbnails draw small and only once they scroll into
// view, so a screen full of cards stays fast on a budget phone.
import { useEffect, useRef, useState } from 'preact/hooks';
import { drawCard, ensureFonts } from '../lib/render.js';

const photos = new Map();
export function loadPhoto(src) {
  if (!src) return Promise.resolve(null);
  if (!photos.has(src)) photos.set(src, new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; }));
  return photos.get(src);
}

export function CardImage({ spec, scale = 0.35, lazy = false, class: cls = '', alt = '' }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(!lazy);
  useEffect(() => {
    if (visible || !ref.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible || !spec) return;
    let live = true;
    (async () => {
      await ensureFonts(spec);
      const photo = await loadPhoto(spec.photo);
      if (live && ref.current) drawCard(ref.current, spec, { scale, photo });
    })();
    // Fonts that finish loading later get a redraw.
    const redraw = () => { if (live && ref.current) loadPhoto(spec.photo).then((photo) => live && ref.current && drawCard(ref.current, spec, { scale, photo })); };
    document.fonts?.addEventListener?.('loadingdone', redraw);
    return () => { live = false; document.fonts?.removeEventListener?.('loadingdone', redraw); };
  }, [visible, spec, scale]);
  const ratio = spec?.format === 'status' ? '9 / 16' : spec?.format === 'square' ? '1 / 1' : '4 / 5';
  return <canvas ref={ref} class={`card-img ${cls}`} style={{ aspectRatio: ratio }} role="img" aria-label={alt || spec?.heading || 'Greeting card'} />;
}
