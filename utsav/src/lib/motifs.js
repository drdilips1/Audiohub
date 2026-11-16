// The drawn artwork: diyas, rangoli, toran, kolam, pookalam, rakhi, lanterns and the
// rest. Everything is drawn in code (no image files), so every card is original,
// sharp at any size and recoloured by its palette. Cards are 1080 px wide; heights
// differ by format, so bottom artwork is placed from H.
//
// Each motif is draw(ctx, k) where k = { W, H, p (palette), R (seeded random), dark, box }.
// `box` is the text area; scattered motifs keep mostly out of it.

const TAU = Math.PI * 2;
const pol = (r, a) => [r * Math.cos(a), r * Math.sin(a)];

export function hex(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
export function alpha(h, a) { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; }
export function shade(h, amt) { return '#' + hex(h).map((v) => Math.max(0, Math.min(255, v + amt)).toString(16).padStart(2, '0')).join(''); }

export function circle(ctx, x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = fill; ctx.fill(); }
export function petalRing(ctx, cx, cy, r0, r1, n, fill, rot = 0, fat = 0.9) {
  ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = fill; ctx.beginPath();
  const w = (Math.PI / n) * fat;
  for (let k = 0; k < n; k++) {
    const a = rot + (k * TAU) / n;
    const [x0, y0] = pol(r0, a - w), [c1x, c1y] = pol(r1 * 0.92, a - w * 0.75), [tx, ty] = pol(r1, a), [c2x, c2y] = pol(r1 * 0.92, a + w * 0.75), [x1, y1] = pol(r0, a + w);
    ctx.moveTo(x0, y0); ctx.quadraticCurveTo(c1x, c1y, tx, ty); ctx.quadraticCurveTo(c2x, c2y, x1, y1); ctx.closePath();
  }
  ctx.fill(); ctx.restore();
}
export function dotRing(ctx, cx, cy, r, n, s, fill, rot = 0) {
  ctx.fillStyle = fill; ctx.beginPath();
  for (let k = 0; k < n; k++) { const [x, y] = pol(r, rot + (k * TAU) / n); ctx.moveTo(cx + x + s, cy + y); ctx.arc(cx + x, cy + y, s, 0, TAU); }
  ctx.fill();
}
export function mandala(ctx, cx, cy, R, c) {
  const n = [24, 16, 12, 8];
  dotRing(ctx, cx, cy, R * 1.05, 48, R * 0.012 + 2, c[3 % c.length]);
  for (let i = 0; i < 4; i++) { const r1 = R * (1 - i * 0.22); petalRing(ctx, cx, cy, r1 * 0.55, r1, n[i], c[i % c.length], i % 2 ? Math.PI / n[i] : 0); }
  circle(ctx, cx, cy, R * 0.2, c[1 % c.length]); dotRing(ctx, cx, cy, R * 0.14, 12, R * 0.018 + 1.5, c[3 % c.length]); circle(ctx, cx, cy, R * 0.07, c[0]);
}
function sparkle(ctx, x, y, s, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x, y, x + s, y); ctx.quadraticCurveTo(x, y, x, y + s); ctx.quadraticCurveTo(x, y, x - s, y); ctx.quadraticCurveTo(x, y, x, y - s); ctx.fill(); }
function star(ctx, x, y, r, col, n = 5) { ctx.fillStyle = col; ctx.beginPath(); for (let i = 0; i < n * 2; i++) { const rr = i % 2 ? r * 0.45 : r, a = -Math.PI / 2 + (i * Math.PI) / n; const [px, py] = pol(rr, a); i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py); } ctx.closePath(); ctx.fill(); }
function heart(ctx, x, y, s, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y + s * 0.35); ctx.bezierCurveTo(x - s, y - s * 0.3, x - s * 0.45, y - s, x, y - s * 0.45); ctx.bezierCurveTo(x + s * 0.45, y - s, x + s, y - s * 0.3, x, y + s * 0.35); ctx.fill(); }
function glowDot(ctx, x, y, r, col) { const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4); g.addColorStop(0, alpha(col, 0.6)); g.addColorStop(1, alpha(col, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 4, 0, TAU); ctx.fill(); circle(ctx, x, y, r, col); circle(ctx, x - r * 0.3, y - r * 0.3, r * 0.35, 'rgba(255,255,255,.7)'); }
const sagY = (y0, sag, span) => (x) => { const t = (((x % span) + span) % span) / span; return y0 + sag * 4 * t * (1 - t); };
function flame(ctx, fx, fy, s) {
  const g = ctx.createRadialGradient(fx, fy - s * 0.5, 0, fx, fy - s * 0.5, s * 2.6); g.addColorStop(0, 'rgba(255,196,77,.55)'); g.addColorStop(1, 'rgba(255,196,77,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fx, fy - s * 0.5, s * 2.6, 0, TAU); ctx.fill();
  const f = ctx.createLinearGradient(fx, fy - s * 1.1, fx, fy); f.addColorStop(0, '#FF7A00'); f.addColorStop(0.6, '#FFD23F'); f.addColorStop(1, '#FFF6D0');
  ctx.fillStyle = f; ctx.beginPath(); ctx.moveTo(fx, fy - s * 1.1); ctx.bezierCurveTo(fx + s * 0.45, fy - s * 0.4, fx + s * 0.35, fy, fx, fy); ctx.bezierCurveTo(fx - s * 0.35, fy, fx - s * 0.45, fy - s * 0.4, fx, fy - s * 1.1); ctx.fill();
}
function diya(ctx, x, y, s, body, rim) {
  const g = ctx.createLinearGradient(x, y - s * 0.4, x, y + s * 0.7); g.addColorStop(0, shade(body, 35)); g.addColorStop(1, shade(body, -45));
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - s * 1.2, y - s * 0.3); ctx.quadraticCurveTo(x, y + s, x + s * 1.2, y - s * 0.3);
  ctx.lineTo(x + s * 1.6, y - s * 0.6); ctx.quadraticCurveTo(x, y - s * 0.05, x - s * 1.2, y - s * 0.3); ctx.closePath(); ctx.fill();
  for (let i = -3; i <= 3; i++) circle(ctx, x + i * s * 0.28, y + s * 0.08 - Math.abs(i) * s * 0.03, s * 0.07, rim);
  flame(ctx, x + s * 1.35, y - s * 0.6, s * 0.75);
}
function marigold(ctx, x, y, r, col) { circle(ctx, x, y, r, col); dotRing(ctx, x, y, r * 0.68, 9, r * 0.32, shade(col, -28)); circle(ctx, x, y, r * 0.34, shade(col, 30)); }
function leaf(ctx, x, y, len, rot, col) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.38, len * 0.5, 0, len); ctx.quadraticCurveTo(-len * 0.38, len * 0.5, 0, 0); ctx.fill();
  ctx.strokeStyle = shade(col, 40); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, len - 4); ctx.stroke(); ctx.restore();
}
function flower(ctx, x, y, r, col, center, petals = 5, rot = 0) { petalRing(ctx, x, y, r * 0.15, r, petals, col, rot, 0.95); circle(ctx, x, y, r * 0.28, center); }
function frameRect(ctx, col, inset, lw, W, H) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2); }
const GREEN = '#3E8E41';

/** A random point, kept out of the text box most of the time. */
function edgePoint(R, k, margin = 30) {
  for (let i = 0; i < 6; i++) {
    const x = R() * k.W, y = R() * k.H;
    const b = k.box;
    if (!(x > b.x - margin && x < b.x + b.w + margin && y > b.y - margin && y < b.y + b.h + margin)) return [x, y, false];
  }
  return [R() * k.W, R() * k.H, true];
}

export const DRAW = {
  // ----- backgrounds -----
  bandhani(ctx, { W, H, p }) {
    ctx.strokeStyle = alpha(p.ink, 0.12); ctx.lineWidth = 3;
    for (let y = 40, row = 0; y < H; y += 60, row++) for (let x = 20 + (row % 2) * 30; x < W; x += 60) { ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.stroke(); }
  },
  'night-sky'(ctx, { W, H, R }) {
    for (let i = 0; i < 160; i++) circle(ctx, R() * W, R() * H * 0.8, 0.6 + R() * 1.8, `rgba(255,255,255,${0.2 + R() * 0.6})`);
  },
  sunburst(ctx, { W, H, p }) {
    ctx.save(); ctx.translate(W / 2, H - 60);
    for (let i = 0; i < 24; i++) { ctx.rotate(TAU / 24); ctx.fillStyle = alpha(p.c[1], i % 2 ? 0.18 : 0.07); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-50, -H); ctx.lineTo(50, -H); ctx.fill(); }
    ctx.restore();
  },
  chakra(ctx, { W, H }) {
    const cx = W / 2, cy = H * 0.45, r = 330;
    ctx.save(); ctx.globalAlpha = 0.07; ctx.strokeStyle = '#000080'; ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    ctx.lineWidth = 5; for (let i = 0; i < 24; i++) { const [x, y] = pol(r, (i * TAU) / 24); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + x, cy + y); ctx.stroke(); }
    circle(ctx, cx, cy, 40, '#000080'); ctx.restore();
  },

  // ----- scatter -----
  sparkles(ctx, k) { for (let i = 0; i < 40; i++) { const [x, y, inside] = edgePoint(k.R, k); sparkle(ctx, x, y, 3 + k.R() * 9, alpha(k.p.ink, inside ? 0.12 : 0.25 + k.R() * 0.4)); } },
  stars(ctx, k) { for (let i = 0; i < 30; i++) { const [x, y, inside] = edgePoint(k.R, k); star(ctx, x, y, 5 + k.R() * 9, alpha(k.p.c[i % 2 ? 0 : 1] || k.p.ink, inside ? 0.15 : 0.7)); } },
  confetti(ctx, k) {
    for (let i = 0; i < 70; i++) {
      const [x, y, inside] = edgePoint(k.R, k); if (inside) continue;
      ctx.save(); ctx.translate(x, y); ctx.rotate(k.R() * TAU); ctx.fillStyle = alpha(k.p.c[i % k.p.c.length], 0.85);
      if (i % 3) ctx.fillRect(-9, -4, 18, 8); else { ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
  },
  hearts(ctx, k) { for (let i = 0; i < 22; i++) { const [x, y, inside] = edgePoint(k.R, k, 50); if (inside) continue; heart(ctx, x, y, 14 + k.R() * 22, alpha(k.p.c[i % k.p.c.length], 0.75)); } },
  snow(ctx, k) {
    const col = k.dark ? '#FFFFFF' : '#9EC5E8';
    for (let i = 0; i < 120; i++) circle(ctx, k.R() * k.W, k.R() * k.H, 1.5 + k.R() * 4.5, alpha(col, 0.35 + k.R() * 0.5));
    ctx.strokeStyle = alpha(col, 0.7); ctx.lineWidth = 3;
    for (let i = 0; i < 9; i++) { const [x, y, inside] = edgePoint(k.R, k); if (inside) continue; const s = 14 + k.R() * 14; for (let a = 0; a < 3; a++) { const [dx, dy] = pol(s, (a * Math.PI) / 3); ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy); ctx.stroke(); } }
  },
  splashes(ctx, k) {
    const { W, H, p, R, dark } = k;
    ctx.save(); ctx.globalCompositeOperation = dark ? 'source-over' : 'multiply'; ctx.globalAlpha = dark ? 0.85 : 0.9;
    [[60, 110, 230], [W - 70, 80, 210], [-30, H * 0.48, 170], [W + 30, H * 0.53, 200], [120, H - 60, 260], [W - 120, H - 70, 280], [W / 2, H + 90, 170], [W / 2, -80, 120]].forEach(([x, y, r], i) => {
      const col = p.c[i % p.c.length], n = 14, pts = [];
      for (let j = 0; j < n; j++) pts.push(pol(r * (0.65 + R() * 0.5), (j * TAU) / n));
      ctx.fillStyle = col; ctx.beginPath();
      for (let j = 0; j <= n; j++) { const p0 = pts[j % n], p1 = pts[(j + 1) % n], mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2; if (j === 0) ctx.moveTo(x + mx, y + my); else ctx.quadraticCurveTo(x + p0[0], y + p0[1], x + mx, y + my); }
      ctx.fill();
      for (let j = 0; j < 24; j++) { const a = R() * TAU, d = r * (1 + R() * 0.9), s = r * 0.02 + R() * r * 0.06; circle(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, s, col); }
    });
    ctx.restore();
    for (let i = 0; i < 220; i++) circle(ctx, R() * W, R() * H, 1 + R() * 2.5, alpha(p.c[i % p.c.length], 0.3));
  },
  shiuli(ctx, k) {
    ctx.save(); if (!k.dark) { ctx.shadowColor = 'rgba(80,0,0,.25)'; ctx.shadowBlur = 8; }
    for (let i = 0; i < 22; i++) { const x = 110 + k.R() * (k.W - 220), y = 110 + k.R() * Math.max(80, k.box.y - 160); const s = 13 + k.R() * 12; petalRing(ctx, x, y, s * 0.12, s, 6, '#FFFFFF', k.R() * TAU, 0.7); circle(ctx, x, y, s * 0.22, '#FF7A00'); }
    ctx.restore();
  },
  rain(ctx, k) {
    ctx.strokeStyle = alpha(k.dark ? '#BFE3FF' : '#4A90C2', 0.45); ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 90; i++) { const [x, y, inside] = edgePoint(k.R, k, 10); if (inside) continue; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 8, y + 30); ctx.stroke(); }
    ctx.lineCap = 'butt';
  },
  balloons(ctx, k) {
    const spots = [[90, 330], [190, 250], [130, 520], [k.W - 90, 340], [k.W - 190, 240], [k.W - 130, 530]];
    spots.forEach(([x, y], i) => {
      const col = k.p.c[i % k.p.c.length], rx = 52, ry = 64;
      ctx.strokeStyle = alpha(k.p.ink, 0.45); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y + ry); ctx.bezierCurveTo(x + 20, y + ry + 60, x - 20, y + ry + 120, x + 6, y + ry + 190); ctx.stroke();
      const g = ctx.createRadialGradient(x - 18, y - 22, 6, x, y, ry); g.addColorStop(0, shade(col, 60)); g.addColorStop(1, col);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - 8, y + ry + 8); ctx.lineTo(x + 8, y + ry + 8); ctx.lineTo(x, y + ry - 2); ctx.fill();
    });
  },

  // ----- corners -----
  'florals-corner'(ctx, { W, H, p, R }) {
    const cluster = (cx, cy, dir) => {
      for (let i = 0; i < 7; i++) leaf(ctx, cx + dir * (R() * 120), cy - dir * (R() * 120) * -1, 70 + R() * 50, R() * TAU, shade(GREEN, Math.round(R() * 40 - 20)));
      for (let i = 0; i < 6; i++) { const x = cx + dir * (20 + R() * 150), y = cy + dir * (20 + R() * 150) * (dir > 0 ? 1 : 1); flower(ctx, x, y, 26 + R() * 26, p.c[i % 3], shade(p.c[(i + 1) % 3], -30), 5 + (i % 2), R() * TAU); }
    };
    cluster(0, 0, 1); cluster(W, H, -1);
  },
  leaves(ctx, { W, H, R }) {
    const bunch = (x, y, base) => { for (let i = 0; i < 9; i++) leaf(ctx, x, y, 110 + R() * 90, base + (R() - 0.5) * 1.6, shade(GREEN, Math.round(R() * 60 - 30))); };
    bunch(W + 10, -10, Math.PI * 0.75); bunch(-10, H + 10, -Math.PI * 0.25);
  },
  'alpana-corners'(ctx, { W, H, p, dark }) {
    const cols = dark ? ['#FFFFFF', p.c[1], alpha('#FFFFFF', 0.7), p.c[1]] : [p.c[0], p.c[1], p.c[3] || p.c[0], p.c[1]];
    mandala(ctx, 0, H, 250, cols); mandala(ctx, W, H, 250, cols);
  },
  'mehndi-corners'(ctx, { W, H, p }) {
    const cols = [p.c[0], alpha(p.c[0], 0.55), p.c[1], alpha(p.c[0], 0.75)];
    mandala(ctx, 30, H - 30, 220, cols); mandala(ctx, W - 30, H - 30, 220, cols);
  },
  'peacock-feathers'(ctx, { W, H }) {
    const feather = (x0, y0, x1, y1, flip) => {
      ctx.strokeStyle = '#5B7F2C'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + flip * 80, (y0 + y1) / 2, x1, y1); ctx.stroke();
      ctx.strokeStyle = 'rgba(90,150,60,.55)'; ctx.lineWidth = 2;
      for (let t = 0.15; t < 0.92; t += 0.025) {
        const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * ((x0 + x1) / 2 + flip * 80) + t * t * x1, y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * ((y0 + y1) / 2) + t * t * y1;
        const w = 60 * Math.sin(t * Math.PI);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - w, y - 30); ctx.moveTo(x, y); ctx.lineTo(x + w, y - 30); ctx.stroke();
      }
      const ex = x1, ey = y1 + 30;
      [[58, 76, '#1F7A4D'], [44, 58, '#E0B13A'], [32, 44, '#1B6CA8'], [18, 26, '#0B1F4D']].forEach(([rx, ry, c]) => { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(ex, ey, rx, ry, 0, 0, TAU); ctx.fill(); });
    };
    feather(120, H + 20, 230, H - 520, 1); feather(W - 120, H + 20, W - 230, H - 520, -1);
  },

  // ----- frames -----
  'frame-gold'(ctx, { W, H, p }) {
    const col = p.c.find((c) => /^#(C9|D4|E0|F3|F4|F5|F6|F7|FF)[A-F0-9]{4}$/i.test(c)) || p.c[0];
    frameRect(ctx, col, 36, 4, W, H); frameRect(ctx, alpha(col, 0.6), 50, 1.5, W, H);
    [[36, 36], [W - 36, 36], [36, H - 36], [W - 36, H - 36]].forEach(([x, y]) => { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillStyle = col; ctx.fillRect(-12, -12, 24, 24); ctx.restore(); });
  },
  'arch-frame'(ctx, { W, H, p }) {
    const col = p.c[0], top = 265, bottom = H - 170;
    [[0, 1], [1, 0.55]].forEach(([i, a]) => {
      const d = i * 18; ctx.strokeStyle = alpha(col, a); ctx.lineWidth = i ? 2 : 4; ctx.beginPath();
      ctx.moveTo(150 + d, bottom); ctx.lineTo(150 + d, top + 295); ctx.bezierCurveTo(150 + d, top + 145 + d, 400, top + 155 + d, W / 2, top + d * 1.3);
      ctx.bezierCurveTo(680, top + 155 + d, W - 150 - d, top + 145 + d, W - 150 - d, top + 295); ctx.lineTo(W - 150 - d, bottom); ctx.stroke();
    });
    sparkle(ctx, W / 2, top - 33, 16, col);
  },
  kasavu(ctx, { W, H }) { frameRect(ctx, '#D4A017', 30, 16, W, H); frameRect(ctx, '#D4A017', 54, 3, W, H); },
  'laal-paar'(ctx, { W, H, p, dark }) {
    const band = dark ? (p.c.includes('#FFFFFF') ? '#FFFFFF' : p.c[1]) : p.c[0];
    ctx.fillStyle = band; ctx.fillRect(0, 0, W, 46); ctx.fillRect(0, H - 46, W, 46); ctx.fillRect(0, 0, 46, H); ctx.fillRect(W - 46, 0, 46, H);
    frameRect(ctx, p.c[1], 60, 4, W, H);
  },

  // ----- top bands -----
  'string-lights'(ctx, { W, p }) {
    [[30, 70, 360, 0], [86, 80, 270, 23]].forEach(([y0, sag, span, off], s) => {
      const yAt = sagY(y0, sag, span);
      ctx.strokeStyle = alpha(p.sub, 0.3); ctx.lineWidth = 2; ctx.beginPath(); for (let x = 0; x <= W; x += 6) x ? ctx.lineTo(x, yAt(x)) : ctx.moveTo(0, yAt(0)); ctx.stroke();
      for (let x = 18 + off, i = 0; x < W; x += 46, i++) glowDot(ctx, x, yAt(x) + 9, 7, p.c[(i + s) % p.c.length]);
    });
  },
  toran(ctx, { W, p }) {
    const y0 = 16, sc = 4, w = W / sc, sag = 78, orange = p.c[0], yellow = p.c[1];
    for (let k = 0; k < sc; k++) { const mx = k * w + w / 2, my = y0 + sag; [-0.45, 0, 0.45].forEach((r) => leaf(ctx, mx, my + 6, 72, r, GREEN)); }
    for (let k = 0; k <= sc; k++) { const x = k * w; for (let i = 0; i < 5; i++) marigold(ctx, x, y0 + 22 + i * 27, 13, i % 2 ? orange : yellow); circle(ctx, x, y0 + 161, 9, '#E0B23A'); }
    for (let k = 0; k < sc; k++) for (let i = 0; i <= 14; i++) { const t = i / 14, x = k * w + t * w, y = y0 + sag * 4 * t * (1 - t); marigold(ctx, x, y, 17, i % 2 ? yellow : orange); }
  },
  bunting(ctx, { W, p }) {
    [[18, 90, 540, 0], [58, 80, 360, 30]].forEach(([y0, sag, span, off], s) => {
      const yAt = sagY(y0, sag, span);
      ctx.strokeStyle = alpha(p.ink, 0.5); ctx.lineWidth = 2; ctx.beginPath(); for (let x = 0; x <= W; x += 6) x ? ctx.lineTo(x, yAt(x)) : ctx.moveTo(0, yAt(0)); ctx.stroke();
      for (let x = 24 + off, i = 0; x < W; x += 64, i++) { const y = yAt(x); ctx.fillStyle = p.c[(i + s * 2) % p.c.length]; ctx.beginPath(); ctx.moveTo(x - 22, y); ctx.lineTo(x + 22, y); ctx.lineTo(x, y + 58); ctx.fill(); }
    });
  },
  lanterns(ctx, { p }) {
    const lantern = (x, top, y, s, col, glow) => {
      ctx.strokeStyle = alpha(col, 0.7); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, y - s * 0.25); ctx.stroke();
      const g = ctx.createRadialGradient(x, y + s * 0.7, 0, x, y + s * 0.7, s * 2); g.addColorStop(0, alpha(glow, 0.35)); g.addColorStop(1, alpha(glow, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y + s * 0.7, s * 2, 0, TAU); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - s * 0.2, y - s * 0.25); ctx.lineTo(x + s * 0.2, y - s * 0.25); ctx.lineTo(x + s * 0.5, y); ctx.lineTo(x - s * 0.5, y); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - s * 0.5, y); ctx.lineTo(x + s * 0.5, y); ctx.lineTo(x + s * 0.7, y + s * 0.6); ctx.lineTo(x + s * 0.5, y + s * 1.4); ctx.lineTo(x - s * 0.5, y + s * 1.4); ctx.lineTo(x - s * 0.7, y + s * 0.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = glow; ctx.beginPath(); ctx.moveTo(x - s * 0.32, y + s * 0.15); ctx.lineTo(x + s * 0.32, y + s * 0.15); ctx.lineTo(x + s * 0.48, y + s * 0.6); ctx.lineTo(x + s * 0.32, y + s * 1.25); ctx.lineTo(x - s * 0.32, y + s * 1.25); ctx.lineTo(x - s * 0.48, y + s * 0.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - s * 0.3, y + s * 1.4); ctx.lineTo(x + s * 0.3, y + s * 1.4); ctx.lineTo(x, y + s * 1.8); ctx.fill();
    };
    const col = p.c[1] || p.c[0], glow = p.c[0];
    lantern(135, 0, 140, 62, col, glow); lantern(255, 0, 230, 46, col, glow);
  },
  kites(ctx, { W, p }) {
    const kite = (x, y, s, col, str) => {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.75, y); ctx.lineTo(x, y + s * 1.1); ctx.lineTo(x - s * 0.75, y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = alpha(str, 0.5); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s * 1.1); ctx.moveTo(x - s * 0.75, y); ctx.lineTo(x + s * 0.75, y); ctx.stroke();
      ctx.strokeStyle = str; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, y + s * 1.1); ctx.bezierCurveTo(x + s * 0.6, y + s * 1.8, x - s * 0.6, y + s * 2.3, x + s * 0.2, y + s * 3); ctx.stroke();
    };
    kite(W - 250, 140, 64, p.c[2] || p.c[0], p.ink); kite(W - 110, 260, 46, p.c[0], p.ink);
  },
  sun(ctx, { p }) {
    const col = p.c.find((c) => /^#FF[B-D]/i.test(c)) || '#FFB703';
    ctx.save(); ctx.translate(170, 180); ctx.fillStyle = alpha(col, 0.9);
    for (let i = 0; i < 16; i++) { ctx.rotate(TAU / 16); ctx.beginPath(); ctx.moveTo(-12, -88); ctx.lineTo(0, -138); ctx.lineTo(12, -88); ctx.fill(); }
    ctx.restore(); circle(ctx, 170, 180, 80, col);
  },
  crescent(ctx, { W, H, p }) {
    const x = W - 270, y = 205, r = 108, col = p.c[0];
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(x + r * 0.42, y - r * 0.18, r * 0.86, 0, TAU, true); ctx.clip('evenodd');
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2); g.addColorStop(0, alpha(col, 0.25)); g.addColorStop(1, alpha(col, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, TAU); ctx.fill();
    circle(ctx, x, y, r, col); ctx.restore(); star(ctx, x + 70, y + 17, 26, col);
  },
  birds(ctx, { W, p }) {
    ctx.strokeStyle = alpha(p.ink, 0.7); ctx.lineWidth = 4; ctx.lineCap = 'round';
    [[W - 300, 120, 30], [W - 230, 160, 24], [W - 170, 105, 26], [W - 360, 175, 20], [W - 120, 175, 18]].forEach(([x, y, s]) => { ctx.beginPath(); ctx.moveTo(x - s, y - s * 0.3); ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.7, x, y); ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.7, x + s, y - s * 0.3); ctx.stroke(); });
    ctx.lineCap = 'butt';
  },
  clouds(ctx, { W, dark }) {
    const col = dark ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.92)';
    const cloud = (x, y, s) => { [[0, 0, 1], [-0.9, 0.25, 0.7], [0.9, 0.25, 0.75], [-0.4, -0.35, 0.75], [0.45, -0.3, 0.7]].forEach(([dx, dy, r]) => circle(ctx, x + dx * s, y + dy * s, r * s, col)); };
    cloud(170, 120, 60); cloud(W - 200, 90, 70); cloud(W / 2 + 40, 175, 44);
  },
  fireworks(ctx, { W, p, R }) {
    [[230, 170, 120], [W - 230, 150, 140], [W / 2, 90, 80]].forEach(([x, y, r], i) => {
      const col = p.c[i % p.c.length]; ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let a = 0; a < 24; a++) { const ang = (a * TAU) / 24 + R() * 0.1, r0 = r * 0.25, r1 = r * (0.8 + R() * 0.25); const [x0, y0] = pol(r0, ang), [x1, y1] = pol(r1, ang); ctx.beginPath(); ctx.moveTo(x + x0, y + y0); ctx.lineTo(x + x1, y + y1); ctx.stroke(); circle(ctx, x + x1 * 1.08, y + y1 * 1.08, 3.5, col); }
      ctx.lineCap = 'butt';
    });
  },
  'moon-full'(ctx, { W, p }) {
    const x = W / 2, y = 175, r = 105, col = '#FFF4D6';
    const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.4); g.addColorStop(0, alpha(p.c[0], 0.35)); g.addColorStop(1, alpha(p.c[0], 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, TAU); ctx.fill();
    circle(ctx, x, y, r, col); circle(ctx, x - 30, y - 20, 16, 'rgba(200,180,140,.35)'); circle(ctx, x + 35, y + 25, 22, 'rgba(200,180,140,.3)'); circle(ctx, x + 10, y - 45, 9, 'rgba(200,180,140,.3)');
  },

  // ----- bottom bands -----
  rangoli(ctx, { W, H, p }) { mandala(ctx, W / 2, H - 15, 285, p.c); },
  diyas(ctx, k) {
    const { W, H, p, spec } = k, body = '#B4441B', rim = p.c[2] || '#FFD27A';
    const xs = spec.motifs.includes('rangoli') || spec.motifs.includes('lotus') ? [[95, H - 100], [250, H - 138], [W - 250, H - 138], [W - 95, H - 100]] : [[150, H - 95], [345, H - 95], [540, H - 95], [735, H - 95], [930, H - 95]];
    xs.forEach(([x, y]) => diya(ctx, x, y, 34, body, rim));
  },
  skyline(ctx, { W, H, p, dark }) {
    ctx.fillStyle = dark ? 'rgba(0,0,0,0.32)' : alpha(p.c[2] || p.c[1], 0.4);
    const dome = (x0, x1, base, tip) => { const m = (x0 + x1) / 2; ctx.beginPath(); ctx.moveTo(x0, base); ctx.bezierCurveTo(x0 - 20, base - (base - tip) * 0.55, m - 12, tip + (base - tip) * 0.25, m, tip); ctx.bezierCurveTo(m + 12, tip + (base - tip) * 0.25, x1 + 20, base - (base - tip) * 0.55, x1, base); ctx.closePath(); ctx.fill(); };
    const b = H - 170;
    ctx.fillRect(400, b, 280, 170); dome(410, 670, b + 5, b - 190);
    [[120, 240], [W - 240, W - 120]].forEach(([a, c]) => { ctx.fillRect(a, b + 70, c - a, 100); dome(a + 6, c - 6, b + 74, b - 30); });
    [300, W - 300].forEach((x) => { ctx.fillRect(x - 18, b - 120, 36, 290); dome(x - 24, x + 24, b - 116, b - 190); ctx.fillRect(x - 3, b - 220, 6, 32); });
    ctx.fillRect(W / 2 - 3, b - 240, 6, 52); ctx.fillRect(0, H - 30, W, 30);
    [W / 2 - 70, W / 2, W / 2 + 70].forEach((x) => { ctx.fillStyle = alpha(p.c[0], 0.75); ctx.beginPath(); ctx.moveTo(x - 18, H - 30); ctx.lineTo(x - 18, H - 92); ctx.quadraticCurveTo(x, H - 128, x + 18, H - 92); ctx.lineTo(x + 18, H - 30); ctx.fill(); });
  },
  kolam(ctx, { W, H, p, dark }) {
    const kc = dark ? 'rgba(255,255,255,.85)' : alpha(p.c[2] || p.ink, 0.75), gap = 50, n = 4, kx = W / 2, ky = H - 95;
    ctx.strokeStyle = kc; ctx.lineWidth = 3;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (Math.abs(i) + Math.abs(j) <= n) { const x = kx + i * gap, y = ky + j * gap * 0.8; circle(ctx, x, y, 4.5, kc); ctx.beginPath(); ctx.arc(x, y, gap * 0.56, 0, TAU); ctx.stroke(); }
  },
  pot(ctx, { W, H, p }) {
    const s = 108, x = W / 2, y = H - 65, col = p.c[0];
    const g = ctx.createRadialGradient(x - s * 0.35, y - s * 0.95, s * 0.1, x, y - s * 0.6, s * 1.25); g.addColorStop(0, shade(col, 55)); g.addColorStop(1, shade(col, -45));
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y - s * 0.7, s, s * 0.78, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(col, -25); ctx.fillRect(x - s * 0.5, y - s * 1.62, s, s * 0.32);
    ctx.beginPath(); ctx.ellipse(x, y - s * 1.62, s * 0.64, s * 0.13, 0, 0, TAU); ctx.fillStyle = shade(col, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(x, y - s * 0.72, s * 0.98, s * 0.22, 0, 0, Math.PI); ctx.stroke();
    for (let i = -3; i <= 3; i++) circle(ctx, x + i * s * 0.26, y - s * 0.5 - Math.abs(i) * s * 0.035, s * 0.05, '#D00000');
    for (let i = 0; i < 16; i++) circle(ctx, x + (((i * 37) % 23) / 23 - 0.5) * s * 1.15, y - s * 1.72 - ((i * 17) % 11) / 11 * s * 0.32, s * (0.11 + ((i * 7) % 5) * 0.02), '#FFFDF5');
    [-0.42, 0.12, 0.46].forEach((f) => { ctx.fillStyle = '#FFFDF5'; ctx.beginPath(); ctx.ellipse(x + f * s, y - s * 1.43, s * 0.07, s * 0.2, 0, 0, TAU); ctx.fill(); });
  },
  sugarcane(ctx, { W, H, p }) {
    const col = p.c.find((c) => /^#(2|3|5)[0-9A-F]{5}$/i.test(c)) || '#2B9348';
    const cane = (x0, y0, x1, y1, flip) => {
      ctx.strokeStyle = col; ctx.lineWidth = 20; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = shade(col, -40); ctx.lineWidth = 4; for (let t = 0.12; t < 1; t += 0.16) { const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; ctx.beginPath(); ctx.moveTo(x - 12, y + 2); ctx.lineTo(x + 12, y - 2); ctx.stroke(); }
      [-0.9, -0.3, 0.4].forEach((r) => leaf(ctx, x1, y1 + 10, 120, Math.PI + r * flip, shade(col, 20))); ctx.lineCap = 'butt';
    };
    cane(215, H + 10, 262, H - 340, 1); cane(W - 215, H + 10, W - 262, H - 340, -1);
  },
  wheat(ctx, { W, H }) {
    const sheaf = (x, flip) => {
      for (let s = -2; s <= 2; s++) {
        const x0 = x + s * 14, y0 = H + 10, x1 = x + s * 40 * flip + flip * 30, y1 = H - 300 + Math.abs(s) * 20;
        ctx.strokeStyle = '#C8961E'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0, (y0 + y1) / 2, x1, y1); ctx.stroke();
        for (let g = 0; g < 7; g++) { const t = g * 14; ctx.fillStyle = '#E2B13C'; [[-1], [1]].forEach(([d]) => { ctx.save(); ctx.translate(x1 + d * 7, y1 + t); ctx.rotate(d * 0.5); ctx.beginPath(); ctx.ellipse(0, 0, 6, 12, 0, 0, TAU); ctx.fill(); ctx.restore(); }); }
      }
    };
    sheaf(150, 1); sheaf(W - 150, -1);
  },
  bonfire(ctx, { W, H, R }) {
    const x = W / 2, y = H - 70;
    ctx.fillStyle = '#5A3418'; [[-1], [1]].forEach(([d]) => { ctx.save(); ctx.translate(x, y); ctx.rotate(d * 0.35); ctx.fillRect(-150, -14, 300, 28); ctx.restore(); });
    const glow = ctx.createRadialGradient(x, y - 120, 20, x, y - 120, 320); glow.addColorStop(0, 'rgba(255,170,60,.45)'); glow.addColorStop(1, 'rgba(255,170,60,0)'); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y - 120, 320, 0, TAU); ctx.fill();
    [[1, '#E63946', 140, 250], [0.8, '#FF7B00', 110, 210], [0.6, '#FFC93C', 70, 150], [0.4, '#FFF3B0', 36, 90]].forEach(([_, c, w, h]) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - w, y); ctx.bezierCurveTo(x - w, y - h * 0.5, x - w * 0.2, y - h * 0.6, x, y - h); ctx.bezierCurveTo(x + w * 0.2, y - h * 0.6, x + w, y - h * 0.5, x + w, y); ctx.closePath(); ctx.fill();
    });
    for (let i = 0; i < 26; i++) circle(ctx, x + (R() - 0.5) * 300, y - 260 - R() * 120, 2 + R() * 3, `rgba(255,${180 + Math.floor(R() * 60)},80,${0.5 + R() * 0.5})`);
  },
  pookalam(ctx, { W, H, p }) {
    const c = p.c, cx = W / 2, cy = H + 20, Rr = 385, g = c[4] || GREEN;
    [[1, g, 40], [0.88, c[0], 32], [0.74, c[1], 24], [0.6, c[2], 16], [0.46, c[3] || '#FFFFFF', 12], [0.32, c[0], 8]].forEach(([f, col, n], i) => { circle(ctx, cx, cy, Rr * f * 0.8, col); petalRing(ctx, cx, cy, Rr * f * 0.78, Rr * f, n, col, i % 2 ? Math.PI / n : 0); });
    circle(ctx, cx, cy, Rr * 0.14, c[2]); dotRing(ctx, cx, cy, Rr * 0.24, 16, 6, c[3] || '#FFFFFF');
  },
  modaks(ctx, { W, H }) {
    ctx.fillStyle = '#C9A227'; ctx.beginPath(); ctx.ellipse(W / 2, H - 60, 320, 42, 0, 0, TAU); ctx.fill(); ctx.fillStyle = shade('#C9A227', -30); ctx.beginPath(); ctx.ellipse(W / 2, H - 68, 290, 28, 0, 0, TAU); ctx.fill();
    const modak = (x, y, s) => {
      const g = ctx.createLinearGradient(x, y - s * 1.2, x, y + s * 0.6); g.addColorStop(0, '#FFFBF0'); g.addColorStop(1, '#EBCB8F'); ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x, y - s * 1.25); ctx.bezierCurveTo(x + s * 0.2, y - s * 0.7, x + s * 0.95, y - s * 0.3, x + s * 0.85, y + s * 0.3); ctx.quadraticCurveTo(x, y + s * 0.62, x - s * 0.85, y + s * 0.3); ctx.bezierCurveTo(x - s * 0.95, y - s * 0.3, x - s * 0.2, y - s * 0.7, x, y - s * 1.25); ctx.fill();
      ctx.strokeStyle = 'rgba(150,100,40,.35)'; ctx.lineWidth = 2.5; [-0.55, -0.2, 0.2, 0.55].forEach((f) => { ctx.beginPath(); ctx.moveTo(x, y - s * 1.2); ctx.quadraticCurveTo(x + f * s * 1.2, y - s * 0.3, x + f * s, y + s * 0.38); ctx.stroke(); });
    };
    [[3, H - 105], [2, H - 178], [1, H - 251]].forEach(([n, y]) => { for (let i = 0; i < n; i++) modak(W / 2 + (i - (n - 1) / 2) * 108, y, 56); });
  },
  flute(ctx, { W, H }) {
    const y = H - 110;
    ctx.save(); ctx.translate(W / 2, y); ctx.rotate(-0.12);
    const g = ctx.createLinearGradient(0, -16, 0, 16); g.addColorStop(0, '#E9C46A'); g.addColorStop(1, '#A87B28'); ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(-330, -15, 660, 30, 15); ctx.fill();
    ctx.fillStyle = '#5A3A10'; for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.ellipse(-120 + i * 48, 0, 7, 5, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#C1121F'; ctx.fillRect(-250, -16, 14, 32); ctx.fillRect(230, -16, 14, 32);
    ctx.strokeStyle = '#C1121F'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-243, 16); ctx.quadraticCurveTo(-260, 70, -235, 110); ctx.stroke(); circle(ctx, -235, 115, 9, '#FFB703');
    ctx.restore();
  },
  lotus(ctx, { W, H, p }) {
    const x = W / 2, y = H - 90, pink = p.c.find((c) => /^#(F|E)[0-9A-F]{5}$/i.test(c) && c !== '#FFFFFF') || '#F4A6B7';
    ctx.strokeStyle = alpha(p.ink, 0.25); ctx.lineWidth = 3; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(x, y + 40 + i * 14, 300 - i * 40, 18, 0, 0, TAU); ctx.stroke(); }
    leaf(ctx, x - 140, y + 30, 120, -Math.PI / 2 - 0.2, '#5E9C6B'); leaf(ctx, x + 140, y + 30, 120, Math.PI / 2 + 0.2, '#5E9C6B');
    [[-1.15, 0.8], [1.15, 0.8], [-0.75, 0.95], [0.75, 0.95], [-0.35, 1.05], [0.35, 1.05], [0, 1.1]].forEach(([a, sc]) => {
      ctx.save(); ctx.translate(x, y + 20); ctx.rotate(a * 0.9); const h = 180 * sc;
      const g = ctx.createLinearGradient(0, 0, 0, -h); g.addColorStop(0, shade(pink, -40)); g.addColorStop(1, shade(pink, 25)); ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(48, -h * 0.35, 30, -h * 0.8, 0, -h); ctx.bezierCurveTo(-30, -h * 0.8, -48, -h * 0.35, 0, 0); ctx.fill(); ctx.restore();
    });
  },
  'xmas-tree'(ctx, { W, H, p }) {
    const tree = (x, s) => {
      const base = H - 40; ctx.fillStyle = '#6B4226'; ctx.fillRect(x - s * 0.12, base - s * 0.2, s * 0.24, s * 0.25);
      [[0, 1], [0.35, 0.8], [0.65, 0.6]].forEach(([o, w]) => { ctx.fillStyle = '#1F6F43'; ctx.beginPath(); ctx.moveTo(x - s * w, base - s * 0.2 - o * s * 1.1); ctx.lineTo(x + s * w, base - s * 0.2 - o * s * 1.1); ctx.lineTo(x, base - s * 0.2 - o * s * 1.1 - s * 0.85); ctx.fill(); });
      star(ctx, x, base - s * 1.85, s * 0.18, '#FFD166');
      [[-0.4, 0.45], [0.35, 0.55], [-0.2, 0.95], [0.25, 1.05], [0, 1.4], [-0.55, 0.3], [0.55, 0.32]].forEach(([dx, dy], i) => circle(ctx, x + dx * s, base - s * 0.2 - dy * s, s * 0.06, p.c[i % p.c.length]));
    };
    tree(150, 170); tree(W - 150, 150);
  },
  gifts(ctx, { W, H, p }) {
    [[W / 2 - 130, 150, 130, 0], [W / 2 + 20, 120, 170, 1], [W / 2 + 150, 90, 110, 2]].forEach(([x, w, h, i]) => {
      const y = H - 40 - h; ctx.fillStyle = p.c[i % p.c.length]; ctx.fillRect(x - w / 2, y, w, h);
      ctx.fillStyle = p.c[(i + 1) % p.c.length]; ctx.fillRect(x - 9, y, 18, h); ctx.fillRect(x - w / 2, y + h * 0.3, w, 16);
      ctx.strokeStyle = p.c[(i + 1) % p.c.length]; ctx.lineWidth = 8; ctx.beginPath(); ctx.ellipse(x - 20, y - 12, 22, 12, -0.4, 0, TAU); ctx.ellipse(x + 20, y - 12, 22, 12, 0.4, 0, TAU); ctx.stroke();
    });
  },
  kalash(ctx, { W, H, p }) {
    const x = W / 2, y = H - 50, col = '#C2701E';
    for (let i = -3; i <= 3; i++) leaf(ctx, x + i * 18, y - 190, 120, Math.PI + i * 0.32, GREEN);
    circle(ctx, x, y - 230, 52, '#8B5A2B'); ctx.strokeStyle = '#6E4320'; ctx.lineWidth = 3; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x - 30 + i * 15, y - 278); ctx.lineTo(x - 36 + i * 18, y - 186); ctx.stroke(); }
    const g = ctx.createRadialGradient(x - 40, y - 120, 10, x, y - 90, 140); g.addColorStop(0, shade(col, 70)); g.addColorStop(1, shade(col, -40));
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y - 85, 120, 95, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(col, -20); ctx.fillRect(x - 60, y - 190, 120, 30); ctx.beginPath(); ctx.ellipse(x, y - 190, 80, 16, 0, 0, TAU); ctx.fillStyle = shade(col, 20); ctx.fill();
    ctx.strokeStyle = p.c[1] || '#FFD000'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(x, y - 90, 118, 22, 0, 0, Math.PI); ctx.stroke();
    for (let i = -2; i <= 2; i++) circle(ctx, x + i * 40, y - 60, 7, '#C1121F');
  },
  cake(ctx, { W, H, p }) {
    ctx.fillStyle = alpha(p.ink, 0.15); ctx.beginPath(); ctx.ellipse(W / 2, H - 50, 260, 26, 0, 0, TAU); ctx.fill();
    const layer = (x0, x1, y0, y1, col) => { ctx.fillStyle = col; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x0, y0, x1 - x0, 16); for (let x = x0 + 14; x < x1; x += 34) circle(ctx, x, y0 + 16, 11, '#FFFFFF'); };
    layer(W / 2 - 200, W / 2 + 200, H - 160, H - 50, p.c[0]); layer(W / 2 - 140, W / 2 + 140, H - 250, H - 160, p.c[1]);
    for (let i = 0; i < 5; i++) { const x = W / 2 - 90 + i * 45; ctx.fillStyle = p.c[(i + 2) % p.c.length]; ctx.fillRect(x - 7, H - 320, 14, 70); ctx.fillStyle = 'rgba(255,255,255,.6)'; for (let yy = H - 314; yy < H - 250; yy += 18) ctx.fillRect(x - 7, yy, 14, 6); flame(ctx, x, H - 324, 26); }
  },
  house(ctx, { W, H, p }) {
    const x = W / 2, base = H - 40, w = 380, h = 200;
    ctx.fillStyle = shade(p.c[0], 40); ctx.fillRect(x - w / 2, base - h, w, h);
    ctx.fillStyle = p.c[3] || '#C1121F'; ctx.beginPath(); ctx.moveTo(x - w / 2 - 40, base - h); ctx.lineTo(x, base - h - 130); ctx.lineTo(x + w / 2 + 40, base - h); ctx.fill();
    ctx.fillStyle = '#6B4226'; ctx.fillRect(x - 40, base - 120, 80, 120);
    ctx.fillStyle = p.c[1] || '#FFD000'; ctx.fillRect(x - 150, base - 150, 70, 60); ctx.fillRect(x + 80, base - 150, 70, 60);
    for (let i = 0; i < 7; i++) marigold(ctx, x - 48 + i * 16, base - 126 + Math.sin((i / 6) * Math.PI) * 14, 9, i % 2 ? p.c[0] : p.c[1] || '#FFD000');
    diya(ctx, x - 90, base - 6, 18, '#B4441B', '#FFD27A'); diya(ctx, x + 70, base - 6, 18, '#B4441B', '#FFD27A');
  },
  books(ctx, { W, H, p }) {
    const x = W / 2, base = H - 50;
    [[300, 46, 0], [270, 42, 1], [320, 50, 2]].reduce((y, [w, h, i]) => { ctx.fillStyle = p.c[i % p.c.length]; ctx.fillRect(x - w / 2 + (i - 1) * 14, y - h, w, h); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(x - w / 2 + (i - 1) * 14 + 10, y - h + 8, w - 20, 6); return y - h; }, base);
    circle(ctx, x + 40, base - 170, 34, '#E63946'); leaf(ctx, x + 44, base - 202, 30, 0.6 + Math.PI, GREEN);
    ctx.save(); ctx.translate(x - 170, base - 60); ctx.rotate(-0.5); ctx.fillStyle = '#FFB703'; ctx.fillRect(0, -9, 200, 18); ctx.fillStyle = '#F4D3A1'; ctx.beginPath(); ctx.moveTo(200, -9); ctx.lineTo(230, 0); ctx.lineTo(200, 9); ctx.fill(); ctx.restore();
  },
  'sunrise-water'(ctx, { W, H, p }) {
    const hy = H - 240, col = p.c.find((c) => /^#FF[7-C]/i.test(c)) || '#FF7B00';
    const g = ctx.createRadialGradient(W / 2, hy, 40, W / 2, hy, 420); g.addColorStop(0, alpha(col, 0.5)); g.addColorStop(1, alpha(col, 0)); ctx.fillStyle = g; ctx.fillRect(0, hy - 420, W, 420);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, hy); ctx.clip(); circle(ctx, W / 2, hy, 150, col); ctx.restore();
    const wg = ctx.createLinearGradient(0, hy, 0, H); wg.addColorStop(0, alpha(p.c[2] || '#3A86FF', 0.55)); wg.addColorStop(1, alpha(p.c[2] || '#3A86FF', 0.85)); ctx.fillStyle = wg; ctx.fillRect(0, hy, W, H - hy);
    ctx.strokeStyle = alpha(col, 0.8); ctx.lineWidth = 6; ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) { const w = 260 - i * 26, y = hy + 26 + i * 24; ctx.beginPath(); ctx.moveTo(W / 2 - w / 2, y); ctx.lineTo(W / 2 + w / 2, y); ctx.stroke(); }
    ctx.lineCap = 'butt';
  },
  rakhi(ctx, { W, H, p }) {
    const cy = H - 240;
    [0, 1].forEach((s) => { ctx.strokeStyle = s ? p.c[1] : p.c[0]; ctx.lineWidth = 9; ctx.beginPath(); for (let x = 0; x <= W; x += 4) { const y = cy + Math.sin(x / 38 + s * Math.PI) * 7; x ? ctx.lineTo(x, y) : ctx.moveTo(0, y); } ctx.stroke(); });
    for (let x = 40; x < W; x += 64) if (Math.abs(x - W / 2) > 200) { circle(ctx, x, cy, 10, '#FFFFFF'); ctx.strokeStyle = alpha(p.ink, 0.25); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, cy, 10, 0, TAU); ctx.stroke(); }
    petalRing(ctx, W / 2, cy, 60, 178, 18, p.c[1]); petalRing(ctx, W / 2, cy, 50, 138, 12, p.c[0], Math.PI / 12);
    circle(ctx, W / 2, cy, 92, p.c[2]); dotRing(ctx, W / 2, cy, 80, 22, 7, p.c[3] || '#FFFFFF'); petalRing(ctx, W / 2, cy, 20, 66, 8, p.c[1]);
    circle(ctx, W / 2, cy, 30, p.c[0]); circle(ctx, W / 2 - 10, cy - 10, 9, 'rgba(255,255,255,.75)');
  },
  marigolds(ctx, { W, H, p, R }) {
    for (let i = 0; i < 26; i++) { const t = i / 25, x = t * W, y = H - 40 - Math.sin(t * Math.PI) * 60 - R() * 40; marigold(ctx, x, y, 26 + R() * 14, i % 2 ? p.c[0] : p.c[1] || '#FFD000'); }
    for (let i = 0; i < 10; i++) leaf(ctx, R() * W, H - 20, 70, Math.PI + (R() - 0.5), GREEN);
  },
  tiranga(ctx, { W, H }) {
    const band = (y, col, amp, ph) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, y); for (let x = 0; x <= W; x += 8) ctx.lineTo(x, y + Math.sin(x / 170 + ph) * amp); ctx.lineTo(W, y + 80); for (let x = W; x >= 0; x -= 8) ctx.lineTo(x, y + 80 + Math.sin(x / 170 + ph) * amp); ctx.closePath(); ctx.fill(); };
    band(H - 260, '#FF9933', 26, 0); band(H - 180, '#FFFFFF', 26, 0); band(H - 100, '#138808', 26, 0);
    const cx = W / 2, cy = H - 140 + Math.sin(cx / 170) * 26;
    ctx.strokeStyle = '#000080'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, 34, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.5; for (let i = 0; i < 24; i++) { const [x, y] = pol(34, (i * TAU) / 24); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + x, cy + y); ctx.stroke(); }
  },
  laurel(ctx, { W, H, p }) {
    const cx = W / 2, cy = H - 320, r = 230, col = p.c.find((c) => /^#(F|E|D|C)[0-9A-F]{5}$/i.test(c) && c !== '#FFFFFF') || '#E0B13A';
    [-1, 1].forEach((d) => {
      ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(cx, cy, r, d < 0 ? Math.PI * 0.55 : Math.PI * 0.45, d < 0 ? Math.PI * 1.05 : -Math.PI * 0.05, d > 0); ctx.stroke();
      for (let i = 0; i < 9; i++) { const a = Math.PI / 2 + d * (0.1 + i * 0.13); const [x, y] = pol(r, a); leaf(ctx, cx + x, cy + y, 48, a + (d > 0 ? Math.PI * 0.85 : Math.PI * 0.15) + Math.PI / 2, col); }
    });
    ctx.fillStyle = p.c[1] || '#EF476F'; ctx.beginPath(); ctx.moveTo(cx - 60, cy + r - 10); ctx.lineTo(cx + 60, cy + r - 10); ctx.lineTo(cx + 40, cy + r + 50); ctx.lineTo(cx, cy + r + 25); ctx.lineTo(cx - 40, cy + r + 50); ctx.closePath(); ctx.fill();
    star(ctx, cx, cy + r - 12, 26, col);
  },
};
