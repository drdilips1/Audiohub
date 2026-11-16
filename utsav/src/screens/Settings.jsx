// Settings: your name and family name for the "From" line, your usual language, and
// how the app reaches AI.
import { useEffect, useState } from 'preact/hooks';
import { useStore, set } from '../lib/store.js';
import { LANGS, LANG_IDS } from '../lib/languages.js';
import { MODELS, aiMode } from '../lib/ai.js';
import { PageHeader, Chip, Section, toast } from '../components/ui.jsx';

export function Settings() {
  const s = useStore('settings');
  const upd = (p) => set('settings', (x) => ({ ...x, ...p }));
  const [mode, setMode] = useState(null);
  useEffect(() => { aiMode(s).then(setMode); }, [s.apiKey, s.ai]);
  const [key, setKey] = useState(s.apiKey);

  return (
    <div class="screen settings">
      <PageHeader title="Settings" />
      <Section title="You">
        <label class="field"><span>Your name</span><input class="input" id="s-name" value={s.name} onInput={(e) => upd({ name: e.currentTarget.value })} placeholder="e.g. Rohan" /></label>
        <label class="field"><span>Family signature (used as “From”)</span><input class="input" id="s-family" value={s.family} onInput={(e) => upd({ family: e.currentTarget.value })} placeholder="e.g. Rohan, Neha & Aarav" /></label>
        <p class="hint">Your usual card language</p>
        <div class="chips-row wrap">{LANG_IDS.map((l) => <Chip small on={s.lang === l} onClick={() => upd({ lang: l })}>{LANGS[l].native}</Chip>)}</div>
      </Section>

      <Section title="AI writing and design">
        <p class="hint">
          {mode === 'server' && 'Connected to Utsav AI.'}
          {mode === 'key' && 'Using your own Anthropic API key.'}
          {mode === 'preview' && 'Using Claude in this preview.'}
          {mode === null && 'AI is off: cards use built-in words and designs.'}
        </p>
        <label class="check"><input type="checkbox" checked={s.ai !== 'off'} onChange={(e) => upd({ ai: e.currentTarget.checked ? 'auto' : 'off' })} /> Use AI when available</label>
        <details class="advanced">
          <summary>Use your own API key (for testing)</summary>
          <p class="hint">Paste an Anthropic API key to try AI cards before the Utsav AI server is set up. It is stored only on this phone and sent only to Anthropic.</p>
          <label class="field"><span>Anthropic API key</span><input class="input" id="s-key" type="password" autocomplete="off" value={key} onInput={(e) => setKey(e.currentTarget.value)} placeholder="sk-ant-…" /></label>
          <div class="actions">
            <button class="btn small" onClick={() => { upd({ apiKey: key.trim() }); toast(key.trim() ? 'Key saved on this phone' : 'Key removed'); }}>Save key</button>
            {s.apiKey && <button class="link danger" onClick={() => { setKey(''); upd({ apiKey: '' }); toast('Key removed'); }}>Remove key</button>}
          </div>
          <p class="hint">Model</p>
          <div class="chips-row wrap">{MODELS.map((m) => <Chip small on={s.model === m.id} onClick={() => upd({ model: m.id })}>{m.en}</Chip>)}</div>
        </details>
      </Section>

      <Section title="About">
        <p class="hint">Utsav {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''}. Your people, dates and cards are stored only on this phone. When AI is used, only the card request (occasion, relationship, names and your note) is sent to write the card.</p>
      </Section>
    </div>
  );
}
