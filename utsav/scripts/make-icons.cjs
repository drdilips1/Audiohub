// Draws the launcher icons and splash screens from the diya artwork (run: node scripts/make-icons.cjs).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const res = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const files = [];
for (const dir of fs.readdirSync(res)) for (const f of fs.readdirSync(path.join(res, dir))) if (f.endsWith('.png')) files.push(path.join(res, dir, f));
const DIYA = `<g transform="translate(256 318)"><path d="M0 -40 C55 -95 40 -150 0 -215 C-40 -150 -55 -95 0 -40Z" fill="#FFD23F"/><path d="M0 -55 C25 -90 18 -120 0 -150 C-18 -120 -25 -90 0 -55Z" fill="#FFF6D0"/><path d="M-165 -10 C-150 110 150 110 165 -10 Z" fill="#FFB627"/><ellipse cx="0" cy="-10" rx="165" ry="30" fill="#E8890C"/><ellipse cx="0" cy="-14" rx="120" ry="16" fill="#7A2E00"/><circle cx="-60" cy="45" r="9" fill="#C2185B"/><circle cx="0" cy="55" r="9" fill="#C2185B"/><circle cx="60" cy="45" r="9" fill="#C2185B"/></g>`;
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  for (const f of files) {
    const buf = fs.readFileSync(f); const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const name = path.basename(f);
    let svg;
    if (name === 'ic_launcher_foreground.png') svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-128 -128 768 768" width="${w}" height="${h}">${DIYA}</svg>`;
    else if (name.startsWith('ic_launcher')) svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${w}" height="${h}">${name.includes('round') ? '<circle cx="256" cy="256" r="256" fill="#C2185B"/>' : '<rect width="512" height="512" rx="112" fill="#C2185B"/>'}${DIYA}</svg>`;
    else { const s = Math.min(w, h) * 0.32; svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#FFF7F2"/><g transform="translate(${w / 2 - s / 2} ${h / 2 - s / 2}) scale(${s / 512})"><rect width="512" height="512" rx="112" fill="#C2185B"/>${DIYA}</g></svg>`; }
    await pg.setViewportSize({ width: w, height: h });
    await pg.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await pg.screenshot({ path: f, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  }
  await b.close();
  console.log(`drew ${files.length} images`);
})();
