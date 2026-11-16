// Draws a card spec onto a canvas: background, artwork, then the words, laid out in
// the space the artwork leaves free. The same function makes the on-screen preview,
// the small thumbnails and the full-size image you share.

import { FORMATS, MOTIFS, isDark, rng } from './design.js';
import { DRAW, circle, dotRing, alpha } from './motifs.js';
import { LANGS, dearLine } from './languages.js';

const ORDER = { bg: 0, scatter: 1, corners: 2, frame: 3, top: 4, bottom: 5 };

/** Where the words go, given the artwork's zones. */
export function layoutFor(spec) {
  const F = FORMATS[spec.format] || FORMATS.post;
  const W = F.w, H = F.h;
  let top = 90, bottom = 90, side = 90, arch = false;
  for (const m of spec.motifs || []) {
    const z = MOTIFS[m];
    if (!z) continue;
    if (z.zone === 'top') top = Math.max(top, z.side ? z.h * 0.55 : z.h);
    if (z.zone === 'bottom') bottom = Math.max(bottom, z.side ? z.h * 0.45 : z.h);
    if (z.zone === 'frame') { top = Math.max(top, z.inset + 50); bottom = Math.max(bottom, z.inset + 50); side = Math.max(side, z.inset + 30); if (z.arch) { arch = true; top = Math.max(top, 400); bottom = Math.max(bottom, 220); side = Math.max(side, 210); } }
    if (z.zone === 'corners' && /alpana|mehndi/.test(m)) bottom = Math.max(bottom, 150);
    if (m === 'balloons') side = Math.max(side, 170);
  }
  // A square card has little height: let the text use part of the artwork's room.
  if (H < 1200) { top = Math.min(top, 230); bottom = Math.min(bottom, 250); }
  return { W, H, box: { x: side, y: top, w: W - side * 2, h: H - top - bottom }, arch };
}

function fontsFor(spec) {
  const L = LANGS[spec.lang] || LANGS.en;
  const head = spec.font === 'script' ? (L.script || L.serif) : spec.font === 'serif' ? L.serif : L.display;
  const hw = /^(Tiro|Great Vibes|Yatra)/.test(head) ? '400' : /^Baloo/.test(head) ? '800' : '700';
  const bw = /^(Mukta|Hind)/.test(L.body) ? '500' : '400';
  const stack = (f) => `"${f}", "${L.sys}", "Noto Sans", sans-serif`;
  return { L, head, hw, body: L.body, bw, stack, rtl: !!L.rtl, tall: !!L.tall };
}

/** Wait (briefly) for the card's fonts, so the first draw isn't in a fallback face. */
export async function ensureFonts(spec) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const f = fontsFor(spec);
  const sample = `${spec.heading || ''}${spec.message || ''}`.slice(0, 80) || 'Aa';
  const load = Promise.all([
    document.fonts.load(`${f.hw} 80px "${f.head}"`, sample),
    document.fonts.load(`${f.bw} 40px "${f.body}"`, sample),
  ]).catch(() => {});
  await Promise.race([load, new Promise((r) => setTimeout(r, 2500))]);
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) { const t = line ? `${line} ${w}` : w; if (!line || ctx.measureText(t).width <= maxW) line = t; else { out.push(line); line = w; } }
    if (line) out.push(line);
  }
  return out;
}

/** Biggest size (down to `min`) at which the text fits in `maxLines` lines. */
function fit(ctx, text, font, start, min, maxW, maxLines) {
  for (let s = start; s >= min; s -= 3) {
    ctx.font = font(s);
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) return { s, lines };
  }
  ctx.font = font(min);
  return { s: min, lines: wrap(ctx, text, maxW).slice(0, maxLines + 1) };
}

function buildItems(ctx, spec, f, box, photo, k) {
  const { L } = f;
  const lh = f.tall ? 1.9 : 1.4, hlh = f.tall ? 1.7 : 1.16;
  const hFont = (s) => `${f.hw} ${s}px ${f.stack(f.head)}`, bFont = (s) => `${f.bw} ${s}px ${f.stack(f.body)}`;
  const maxW = box.w;
  const items = [];
  if (photo) { const r = Math.round(150 * Math.min(1, k + 0.1)); items.push({ t: 'photo', r, h: 2 * r + 44 }); }
  const dear = dearLine(spec.lang, spec.to);
  if (dear) items.push({ t: 'line', text: dear, font: bFont(Math.round(42 * k)), role: 'sub', h: 42 * k * (f.tall ? 1.8 : 1.35) });
  if (spec.heading) {
    const h = fit(ctx, spec.heading, hFont, Math.round(118 * k), Math.round(52 * k), maxW, 3);
    items.push({ t: 'lines', lines: h.lines, font: hFont(h.s), role: 'ink', lh: h.s * hlh, h: h.lines.length * h.s * hlh });
  }
  items.push({ t: 'divider', h: 44 * Math.min(1, k + 0.2) });
  if (spec.message) {
    const m = fit(ctx, spec.message, bFont, Math.round(46 * k), Math.round(28 * k), maxW - 30, spec.format === 'status' ? 11 : 8);
    items.push({ t: 'lines', lines: m.lines, font: bFont(m.s), role: 'sub', lh: m.s * lh, h: m.lines.length * m.s * lh });
  }
  if (spec.from) {
    items.push({ t: 'gap', h: 18 * k });
    const so = spec.signoff || L.love;
    items.push({ t: 'line', text: so, font: bFont(Math.round(36 * k)), role: 'sub', h: 36 * k * (f.tall ? 1.8 : 1.35) });
    const fr = fit(ctx, spec.from, hFont, Math.round(60 * k), Math.round(34 * k), maxW, 2);
    items.push({ t: 'lines', lines: fr.lines, font: hFont(fr.s), role: 'ink', lh: fr.s * 1.2, h: fr.lines.length * fr.s * 1.2 });
  }
  const gap = 14 * k;
  return { items, total: items.reduce((a, i) => a + i.h, 0) + gap * (items.length - 1), gap };
}

/**
 * Draw `spec` onto `canvas`. `scale` < 1 makes thumbnails (0.25 → 270 px wide).
 * `photo` is a loaded HTMLImageElement or null.
 */
export function drawCard(canvas, spec, { scale = 1, photo = null } = {}) {
  const { W, H, box } = layoutFor(spec);
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const p = spec.palette, dark = isDark(p);

  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, p.bg[0]); g.addColorStop(1, p.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.45, 40, W / 2, H * 0.45, W * 0.75);
  glow.addColorStop(0, dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.35)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  const R = rng(spec.seed || 7);
  const k = { W, H, p, R, dark, box, spec };
  const motifs = [...(spec.motifs || [])].filter((m) => DRAW[m]).sort((a, b) => ORDER[MOTIFS[a].zone] - ORDER[MOTIFS[b].zone]);
  for (const m of motifs) { ctx.save(); try { DRAW[m](ctx, k); } catch (e) { /* one bad motif shouldn't blank the card */ } ctx.restore(); }

  // Words: shrink everything together until it fits the free space.
  const f = fontsFor(spec);
  ctx.direction = f.rtl ? 'rtl' : 'ltr';
  let built;
  for (let sc = 1; sc >= 0.5; sc -= 0.05) { built = buildItems(ctx, spec, f, box, photo, sc); if (built.total <= box.h) break; }
  let y = box.y + Math.max(0, (box.h - built.total) / 2);
  const cx = W / 2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const shadowOn = () => { if (dark) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 2; } else { ctx.shadowColor = 'rgba(255,255,255,.6)'; ctx.shadowBlur = 10; } };
  const shadowOff = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };
  for (const it of built.items) {
    const color = it.role === 'ink' ? p.ink : p.sub;
    if (it.t === 'photo' && photo) {
      const cy = y + it.h / 2, r = it.r;
      circle(ctx, cx, cy, r + 12, p.ink); dotRing(ctx, cx, cy, r + 26, 36, 4, p.ink);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      const s = Math.max((2 * r) / photo.width, (2 * r) / photo.height); const w = photo.width * s, h = photo.height * s;
      ctx.drawImage(photo, cx - w / 2, cy - h / 2, w, h); ctx.restore();
    } else if (it.t === 'line') {
      shadowOn(); ctx.font = it.font; ctx.fillStyle = color; ctx.fillText(it.text, cx, y + it.h / 2); shadowOff();
    } else if (it.t === 'lines') {
      shadowOn(); ctx.font = it.font; ctx.fillStyle = color; it.lines.forEach((l, i) => ctx.fillText(l, cx, y + it.lh * (i + 0.5))); shadowOff();
    } else if (it.t === 'divider') {
      const cy = y + it.h / 2;
      ctx.strokeStyle = alpha(p.ink, 0.7); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx - 140, cy); ctx.lineTo(cx - 30, cy); ctx.moveTo(cx + 30, cy); ctx.lineTo(cx + 140, cy); ctx.stroke();
      ctx.fillStyle = p.ink; ctx.beginPath(); ctx.moveTo(cx, cy - 13); ctx.lineTo(cx + 13, cy); ctx.lineTo(cx, cy + 13); ctx.lineTo(cx - 13, cy); ctx.closePath(); ctx.fill();
      circle(ctx, cx - 40, cy, 4, p.ink); circle(ctx, cx + 40, cy, 4, p.ink);
    }
    y += it.h + built.gap;
  }
  return canvas;
}

/** PNG of the card at full size, as a Blob. */
export function cardBlob(spec, photo) {
  const c = document.createElement('canvas');
  drawCard(c, spec, { photo });
  return new Promise((res) => c.toBlob(res, 'image/png'));
}
