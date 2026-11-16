import { THEMES, designFor, sanitizeSpec } from '/src/lib/design.js';
import { drawCard, ensureFonts } from '/src/lib/render.js';
import { fontsHref, LANG_IDS } from '/src/lib/languages.js';
import { OCCASIONS } from '/src/lib/occasions.js';
import { headingFor, messageFor, signoffFor } from '/src/lib/messages.js';
document.getElementById('f').href = fontsHref();
const params = new URLSearchParams(location.search); const variant = +(params.get('v')||0); const fmt = params.get('fmt')||'post';
let i = 0;
for (const theme of Object.keys(THEMES)) {
  const occ = OCCASIONS.find(o => o.theme === theme) || OCCASIONS[0];
  const lang = LANG_IDS[i++ % LANG_IDS.length];
  const spec = sanitizeSpec({ ...designFor({ theme, variant, lang }), lang, format: fmt, heading: headingFor(occ, lang), message: messageFor(occ, { lang, relation: 'sister' }), signoff: signoffFor(lang, 'sister', occ), to: 'Priya', from: 'Rohan & family' });
  await ensureFonts(spec);
  const c = document.createElement('canvas'); drawCard(c, spec, { scale: 0.3 }); c.style.width = '200px'; c.title = theme; document.body.append(c);
}
window.done = true;
