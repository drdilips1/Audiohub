// First open: your name, family signature and usual language. Two taps, then you're in.
import { useState } from 'preact/hooks';
import { set } from '../lib/store.js';
import { LANGS, LANG_IDS } from '../lib/languages.js';
import { Chip } from '../components/ui.jsx';

export function Welcome() {
  const [name, setName] = useState('');
  const [family, setFamily] = useState('');
  const [lang, setLang] = useState('hi');
  const done = () => set('settings', (s) => ({ ...s, name: name.trim(), family: family.trim(), lang, onboarded: true }));
  return (
    <div class="screen welcome">
      <h1 class="brand big">Utsav</h1>
      <p class="tagline">Every feeling deserves a beautiful expression.</p>
      <label class="field"><span>Your name</span><input class="input" id="w-name" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="e.g. Rohan" /></label>
      <label class="field"><span>How should cards be signed?</span><input class="input" id="w-family" value={family} onInput={(e) => setFamily(e.currentTarget.value)} placeholder="e.g. Rohan, Neha & Aarav" /></label>
      <p class="hint">Which language do you usually send wishes in?</p>
      <div class="chips-row wrap">{LANG_IDS.map((l) => <Chip on={lang === l} onClick={() => setLang(l)}>{LANGS[l].native}</Chip>)}</div>
      <button class="btn primary wide" onClick={done}>Start</button>
      <button class="link" onClick={done}>Skip for now</button>
    </div>
  );
}
