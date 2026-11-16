// Editor: make the card yours. Change the words (or let AI rewrite or translate them),
// colours, artwork, size and photo, then save and send.
import { useEffect, useState } from 'preact/hooks';
import { get, saveCard, set } from '../lib/store.js';
import { back } from '../lib/nav.js';
import { THEMES, MOTIFS, MOTIF_NAMES, FORMATS, sanitizeSpec, designFor } from '../lib/design.js';
import { LANGS, LANG_IDS, dearLine } from '../lib/languages.js';
import { TONES, headingFor, messageFor, signoffFor } from '../lib/messages.js';
import { occasionById, customOccasion } from '../lib/occasions.js';
import { relationById } from '../lib/relations.js';
import { rewriteText, aiMode } from '../lib/ai.js';
import { shareCard, cardText } from '../lib/share.js';
import { readPhoto } from '../lib/photo.js';
import { CardImage, loadPhoto } from '../components/CardImage.jsx';
import { PageHeader, Chip, toast } from '../components/ui.jsx';

const ZONE_NAMES = { top: 'Top', bottom: 'Bottom', frame: 'Border', corners: 'Corners', scatter: 'Sprinkle', bg: 'Background' };
const label = (m) => m.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function Editor({ spec: initial }) {
  const [spec, setSpec] = useState(() => sanitizeSpec(initial));
  const [tab, setTab] = useState('words');
  const [busy, setBusy] = useState('');
  const [hasAi, setHasAi] = useState(false);
  useEffect(() => { aiMode(get('settings')).then((m) => setHasAi(!!m)); }, []);

  const patch = (p) => setSpec((s) => sanitizeSpec({ ...s, ...p }));
  const occ = spec.occasion === 'custom' ? customOccasion(spec.customLabel, spec.theme) : occasionById(spec.occasion) || customOccasion(spec.customLabel || spec.heading, spec.theme);
  const T = THEMES[spec.theme];

  const setLang = async (lang) => {
    if (lang === spec.lang) return;
    if (hasAi) {
      setBusy('Translating…');
      try {
        const r = await rewriteText(spec, { langLabel: LANGS[lang].ai, tone: spec.tone, occasionLabel: occ.en, relationLabel: relationById(spec.relation)?.en }, get('settings'));
        if (r) { patch({ lang, heading: r.heading, message: r.message, signoff: r.signoff }); setBusy(''); return; }
      } catch (e) { toast(e?.message || 'AI could not translate. Using built-in words.'); }
      setBusy('');
    }
    patch({ lang, heading: headingFor(occ, lang), message: messageFor(occ, { lang, relation: spec.relation, tone: spec.tone }), signoff: signoffFor(lang, spec.relation, occ) });
  };

  const rewrite = async (tone) => {
    if (!hasAi) { patch({ tone, message: messageFor(occ, { lang: spec.lang, relation: spec.relation, tone }) }); return; }
    setBusy('Rewriting…');
    try {
      const r = await rewriteText(spec, { langLabel: LANGS[spec.lang].ai, tone, occasionLabel: occ.en, relationLabel: relationById(spec.relation)?.en }, get('settings'));
      if (r) patch({ tone, heading: r.heading, message: r.message, signoff: r.signoff });
    } catch (e) { toast(e?.message || 'AI could not rewrite just now.'); }
    setBusy('');
  };

  const save = () => { const c = saveCard(spec); setSpec(c); toast('Saved to My Cards'); return c; };
  const send = async () => {
    setBusy('Preparing your card…');
    try {
      const c = spec.id ? saveCard(spec) : save();
      const r = await shareCard(c, await loadPhoto(c.photo), '');
      if (r === 'downloaded') toast('Card saved to your downloads');
    } catch (e) { toast('Could not share the card. Try again.'); }
    setBusy('');
  };
  const copy = async () => {
    const t = cardText(spec, dearLine(spec.lang, spec.to)).replace(/\*/g, '');
    try { await navigator.clipboard.writeText(t); toast('Words copied'); } catch { toast('Copy isn’t allowed here'); }
  };
  const del = () => { set('cards', (l) => l.filter((c) => c.id !== spec.id)); toast('Card deleted'); back(); };

  return (
    <div class="screen editor">
      <PageHeader title="Make it yours" sub={occ.en} right={<button class="btn small" onClick={save}>Save</button>} />
      <div class="preview-wrap"><CardImage spec={spec} scale={0.5} class="preview" /></div>
      {busy && <p class="busy" role="status">{busy}</p>}

      <div class="actions">
        <button class="btn primary" onClick={send}>Send card</button>
        <a class="btn whatsapp" href={`https://wa.me/?text=${encodeURIComponent(cardText(spec, dearLine(spec.lang, spec.to)))}`} target="_blank" rel="noopener">WhatsApp words</a>
        <button class="btn ghost" onClick={copy}>Copy words</button>
      </div>

      <div class="tabs" role="tablist">
        {[['words', 'Words'], ['design', 'Design'], ['size', 'Size'], ['photo', 'Photo']].map(([id, t]) => <button role="tab" aria-selected={tab === id ? 'true' : 'false'} class={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{t}</button>)}
      </div>

      {tab === 'words' && (
        <div class="panel">
          <div class="chips-row">{LANG_IDS.map((l) => <Chip small on={spec.lang === l} onClick={() => setLang(l)}>{LANGS[l].native}</Chip>)}</div>
          <label class="field"><span>Heading</span><input class="input" id="e-head" dir="auto" value={spec.heading} onInput={(e) => patch({ heading: e.currentTarget.value })} /></label>
          <label class="field"><span>Message</span><textarea class="input" id="e-msg" dir="auto" rows="4" value={spec.message} onInput={(e) => patch({ message: e.currentTarget.value })} /></label>
          <div class="two">
            <label class="field"><span>To</span><input class="input" id="e-to" dir="auto" value={spec.to} onInput={(e) => patch({ to: e.currentTarget.value })} /></label>
            <label class="field"><span>From</span><input class="input" id="e-from" dir="auto" value={spec.from} onInput={(e) => patch({ from: e.currentTarget.value })} /></label>
          </div>
          <label class="field"><span>Sign-off</span><input class="input" id="e-sign" dir="auto" value={spec.signoff} onInput={(e) => patch({ signoff: e.currentTarget.value })} /></label>
          <p class="hint">{hasAi ? 'Rewrite the words with AI:' : 'Try another tone (built-in words):'}</p>
          <div class="chips-row">{TONES.map((t) => <Chip small on={spec.tone === t.id} onClick={() => rewrite(t.id)}>{t.en}</Chip>)}</div>
        </div>
      )}

      {tab === 'design' && (
        <div class="panel">
          <p class="hint">Colours</p>
          <div class="swatches">
            {T.palettes.map((p) => <button class={`swatch${p.bg[0] === spec.palette.bg[0] ? ' on' : ''}`} style={{ background: `linear-gradient(${p.bg[0]}, ${p.bg[1]})` }} aria-label="Colour set" onClick={() => patch({ palette: p })}><i style={{ background: `conic-gradient(${p.c.slice(0, 4).join(',')})` }} /></button>)}
            <button class="btn ghost small" onClick={() => patch({ ...designFor({ theme: spec.theme, variant: Math.floor(Math.random() * 9), lang: spec.lang }), heading: spec.heading })}>Shuffle design</button>
          </div>
          <p class="hint">Style</p>
          <div class="chips-row">{Object.keys(THEMES).map((t) => <Chip small on={spec.theme === t} onClick={() => patch({ ...designFor({ theme: t, lang: spec.lang }) })}>{label(t)}</Chip>)}</div>
          <p class="hint">Lettering</p>
          <div class="chips-row">
            <Chip small on={spec.font === 'display'} onClick={() => patch({ font: 'display' })}>Festive</Chip>
            <Chip small on={spec.font === 'serif'} onClick={() => patch({ font: 'serif' })}>Classic</Chip>
            {spec.lang === 'en' && <Chip small on={spec.font === 'script'} onClick={() => patch({ font: 'script' })}>Handwritten</Chip>}
          </div>
          <p class="hint">Artwork (tap to add or remove)</p>
          {Object.entries(ZONE_NAMES).map(([z, name]) => (
            <div class="motif-group"><b>{name}</b><div class="chips-row">
              {MOTIF_NAMES.filter((m) => MOTIFS[m].zone === z).map((m) => <Chip small on={spec.motifs.includes(m)} onClick={() => patch({ motifs: spec.motifs.includes(m) ? spec.motifs.filter((x) => x !== m) : [...spec.motifs.filter((x) => MOTIFS[x].zone !== z || MOTIFS[m].zone === 'scatter' || MOTIFS[m].zone === 'corners' || MOTIFS[m].side), m] })}>{label(m)}</Chip>)}
            </div></div>
          ))}
        </div>
      )}

      {tab === 'size' && (
        <div class="panel">
          {Object.entries(FORMATS).map(([id, f]) => <button class={`size-opt${spec.format === id ? ' on' : ''}`} onClick={() => patch({ format: id })}><b>{f.en}</b><span>{f.hint}</span></button>)}
        </div>
      )}

      {tab === 'photo' && (
        <div class="panel">
          <p class="hint">A photo sits in a round frame above the heading. Family photos and old pictures make anniversary and birthday cards special.</p>
          <div class="photo-row">
            {spec.photo && <img src={spec.photo} class="photo-prev" alt="Card photo" />}
            <label class="btn ghost file">{spec.photo ? 'Change photo' : 'Add a photo'}<input type="file" accept="image/*" onChange={async (e) => { const f = e.currentTarget.files?.[0]; if (f) { try { patch({ photo: await readPhoto(f) }); } catch (err) { toast(err.message); } } }} /></label>
            {spec.photo && <button class="link" onClick={() => patch({ photo: null })}>Remove</button>}
          </div>
        </div>
      )}

      {spec.id && <button class="link danger" onClick={del}>Delete this card</button>}
    </div>
  );
}
