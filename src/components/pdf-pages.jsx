import { useEffect, useRef, useState } from 'preact/hooks';
import { openPdf, renderPage, pageRatios } from '../lib/pdf.js';

/**
 * The PDF's original pages, one under the other. Only pages near the screen are
 * drawn (and far ones cleared), so big PDFs stay light. Zoom with the − / + buttons.
 */
export function PdfPages({ bytes, startPage = 1, onPage }) {
  const box = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [ratios, setRatios] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let doc;
    let alive = true;
    openPdf(bytes)
      .then(async (d) => {
        doc = d;
        const r = await pageRatios(d);
        if (alive) {
          setPdf(d);
          setRatios(r);
        }
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
      doc?.destroy();
    };
  }, [bytes]);

  useEffect(() => {
    const measure = () => setWidth(Math.max(200, (box.current?.clientWidth || 360) - 16));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Jump to the page you were on (once the pages are laid out).
  useEffect(() => {
    if (!ratios.length || !box.current || startPage <= 1) return;
    const el = box.current.querySelector(`[data-page="${startPage}"]`);
    if (el) box.current.scrollTop = el.offsetTop - 64;
  }, [ratios.length]);

  // Draw what's on (or near) the screen; report the page at the top.
  useEffect(() => {
    if (!pdf || !box.current) return;
    const drawn = new Map(); // page -> width drawn at
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = +e.target.dataset.page;
          const canvas = e.target.querySelector('canvas');
          const w = Math.round(width * zoom);
          if (e.isIntersecting && drawn.get(n) !== w) {
            drawn.set(n, w);
            renderPage(pdf, n, canvas, w).catch(() => drawn.delete(n));
          } else if (!e.isIntersecting && drawn.has(n)) {
            drawn.delete(n);
            canvas.width = 0; // free the memory; drawn again when it comes back
            canvas.height = 0;
          }
        }
      },
      { root: box.current, rootMargin: '150% 0px' }
    );
    box.current.querySelectorAll('.pdf-pg').forEach((el) => io.observe(el));
    const onScroll = () => {
      const top = box.current.getBoundingClientRect().top + 40;
      const pages = box.current.querySelectorAll('.pdf-pg');
      for (const el of pages) {
        if (el.getBoundingClientRect().bottom > top) {
          onPage?.(+el.dataset.page, pages.length);
          break;
        }
      }
    };
    box.current.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      io.disconnect();
      box.current?.removeEventListener('scroll', onScroll);
    };
  }, [pdf, width, zoom, ratios.length]);

  if (error) return <div class="reader-msg"><p>Couldn't show the pages: {error}</p></div>;
  const w = Math.round(width * zoom);
  return (
    <div class="pdf-pages" ref={box}>
      {!pdf && (
        <div class="reader-msg">
          <span class="spinner" />
          <p>Opening the pages…</p>
        </div>
      )}
      {ratios.map((r, i) => (
        <div class="pdf-pg" data-page={i + 1} style={{ width: w + 'px', height: Math.round(w / r) + 'px' }}>
          <canvas />
        </div>
      ))}
      <div class="pdf-zoom">
        <button onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))} disabled={zoom <= 1} aria-label="Zoom out">
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.5).toFixed(1)))} disabled={zoom >= 3} aria-label="Zoom in">
          +
        </button>
      </div>
    </div>
  );
}
