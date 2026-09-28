// Renders public/icon.svg into Android launcher icons, adaptive-icon layers and
// splash screens. Requires Playwright (with a Chromium build) to be available:
//   npx playwright install chromium   # once
//   npm run icons
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs'));
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const res = path.join(root, 'android/app/src/main/res');
const svg = fs.readFileSync(path.join(root, 'public/icon.svg'), 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const defs = inner.match(/<defs>[\s\S]*?<\/defs>/)[0];
const artwork = inner.replace(/<defs>[\s\S]*?<\/defs>/, '').replace(/<rect[^>]*\/>/g, '');

const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const full = (round) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}${round ? '<clipPath id="c"><circle cx="256" cy="256" r="256"/></clipPath><g clip-path="url(#c)">' : '<g>'}<rect width="512" height="512" rx="${round ? 0 : 116}" fill="url(#bg)"/><rect width="512" height="512" rx="${round ? 0 : 116}" fill="url(#glow)"/><g transform="translate(51 51) scale(0.8)">${artwork}</g></g></svg>`;
// Adaptive icons: 108dp canvas, artwork kept inside the 66dp safe zone.
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<g transform="translate(106 106) scale(0.586)">${artwork}</g></svg>`;
const bg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<rect width="512" height="512" fill="url(#bg)"/><rect width="512" height="512" fill="url(#glow)"/></svg>`;
const splash = (w, h) => {
  const s = Math.min(w, h) * 0.28;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><radialGradient id="sg" cx="0.5" cy="0.45" r="0.6"><stop offset="0" stop-color="#3b2a7a"/><stop offset="1" stop-color="#0b0a14"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#sg)"/><g transform="translate(${(w - s) / 2} ${(h - s) / 2}) scale(${s / 512})">${full(false).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g></svg>`;
};

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(markup, w, h, out, transparent = true) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${w}" height="${h}" `)}</body></html>`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
}

for (const [d, k] of Object.entries(DENS)) {
  await render(full(false), 48 * k, 48 * k, `${res}/mipmap-${d}/ic_launcher.png`);
  await render(full(true), 48 * k, 48 * k, `${res}/mipmap-${d}/ic_launcher_round.png`);
  await render(fg, 108 * k, 108 * k, `${res}/mipmap-${d}/ic_launcher_foreground.png`);
  await render(bg, 108 * k, 108 * k, `${res}/mipmap-${d}/ic_launcher_background.png`, false);
}
for (const dir of fs.readdirSync(res).filter((d) => d.startsWith('drawable'))) {
  const f = `${res}/${dir}/splash.png`;
  if (!fs.existsSync(f)) continue;
  const b = fs.readFileSync(f);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  await render(splash(w, h), w, h, f, false);
}
await render(full(false), 512, 512, path.join(root, 'public/icon-512.png'));
await browser.close();
console.log('Icons and splash screens generated.');
