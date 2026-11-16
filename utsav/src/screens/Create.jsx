// Create, step by step: who you're wishing, the occasion (any occasion, typed in your
// own words if it isn't listed), language, tone, names and an optional photo.
import { useState } from 'preact/hooks';
import { useStore } from '../lib/store.js';
import { open } from '../lib/nav.js';
import { RELATIONS } from '../lib/relations.js';
import { searchOccasions, occasionById } from '../lib/occasions.js';
import { LANGS, LANG_IDS } from '../lib/languages.js';
import { TONES } from '../lib/messages.js';
import { Chip, Section } from '../components/ui.jsx';
import { readPhoto } from '../lib/photo.js';

const POPULAR = ['birthday', 'anniversary', 'diwali', 'holi', 'rakhi', 'eid', 'christmas', 'newyear', 'wedding', 'congrats', 'thankyou', 'goodmorning', 'retirement', 'housewarming', 'newbaby', 'getwell'];

export function Create({ preset = {} }) {
  const settings = useStore('settings');
  const [relation, setRelation] = useState(preset.relation || null);
  const [occasion, setOccasion] = useState(preset.occasion || null);
  const [custom, setCustom] = useState('');
  const [q, setQ] = useState('');
  const [lang, setLang] = useState(settings.lang || 'hi');
  const [tone, setTone] = useState('warm');
  const [to, setTo] = useState('');
  const [from, setFrom] = useState(settings.family || settings.name || '');
  const [photo, setPhoto] = useState(null);
  const [note, setNote] = useState('');

  const found = q.trim() ? searchOccasions(q).slice(0, 12) : POPULAR.map(occasionById);
  const ready = occasion || custom.trim();

  const submit = () => open('results', { req: { relation, occasion: custom.trim() ? null : occasion, customOccasion: custom.trim() || null, lang, tone, to: to.trim(), from: from.trim(), photo, note: note.trim() || undefined } });

  return (
    <div class="screen create">
      <header class="tab-head"><h1>Create a card</h1><p>Four quick choices. Any occasion works.</p></header>

      <Section title="1. Who are you wishing?">
        <div class="chips">
          {RELATIONS.map((r) => <Chip on={relation === r.id} onClick={() => setRelation(relation === r.id ? null : r.id)}>{r.en}<small>{r.hi}</small></Chip>)}
        </div>
      </Section>

      <Section title="2. What’s the occasion?">
        <input class="input" type="search" id="occ-search" placeholder="Search: Diwali, Lohri, promotion, griha pravesh…" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        <div class="chips">
          {found.map((o) => <Chip on={occasion === o.id && !custom} onClick={() => { setOccasion(o.id); setCustom(''); }}>{o.en}<small>{o.hi}</small></Chip>)}
        </div>
        <label class="field">
          <span>Not listed? Type your own</span>
          <input class="input" id="occ-custom" placeholder="e.g. Pihu’s first day at school, Shop’s 10th year" value={custom} onInput={(e) => setCustom(e.currentTarget.value)} />
        </label>
      </Section>

      <Section title="3. Language and tone">
        <div class="chips">{LANG_IDS.map((l) => <Chip on={lang === l} onClick={() => setLang(l)}>{LANGS[l].native}</Chip>)}</div>
        <div class="chips">{TONES.map((t) => <Chip on={tone === t.id} onClick={() => setTone(t.id)}>{t.en}</Chip>)}</div>
      </Section>

      <Section title="4. Names and a personal touch">
        <div class="two">
          <label class="field"><span>To</span><input class="input" id="to" value={to} onInput={(e) => setTo(e.currentTarget.value)} placeholder="Name (optional)" /></label>
          <label class="field"><span>From</span><input class="input" id="from" value={from} onInput={(e) => setFrom(e.currentTarget.value)} placeholder="You or your family" /></label>
        </div>
        <label class="field"><span>Anything personal to mention? (used by AI)</span><input class="input" id="note" value={note} onInput={(e) => setNote(e.currentTarget.value)} placeholder="e.g. she just finished her MBA, loves gardening" /></label>
        <div class="photo-row">
          {photo ? <img src={photo} alt="Chosen photo" class="photo-prev" /> : null}
          <label class="btn ghost file">{photo ? 'Change photo' : 'Add a photo'}<input type="file" accept="image/*" onChange={async (e) => { const f = e.currentTarget.files?.[0]; if (f) setPhoto(await readPhoto(f)); }} /></label>
          {photo && <button class="link" onClick={() => setPhoto(null)}>Remove</button>}
        </div>
      </Section>

      <div class="sticky-cta"><button class="btn primary wide" disabled={!ready} onClick={submit}>{ready ? 'Make my cards' : 'Pick an occasion to continue'}</button></div>
    </div>
  );
}
