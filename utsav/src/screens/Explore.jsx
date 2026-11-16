// Explore: every occasion by category, each with a live preview in your language.
import { useMemo, useState } from 'preact/hooks';
import { useStore } from '../lib/store.js';
import { open } from '../lib/nav.js';
import { CATEGORIES, searchOccasions } from '../lib/occasions.js';
import { offlineCards } from '../lib/compose.js';
import { CardImage } from '../components/CardImage.jsx';
import { Chip } from '../components/ui.jsx';

export function Explore() {
  const settings = useStore('settings');
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const lang = settings.lang || 'hi';
  const list = useMemo(() => searchOccasions(q).filter((o) => cat === 'all' || o.cat === cat), [q, cat]);
  const previews = useMemo(() => Object.fromEntries(list.map((o) => [o.id, offlineCards({ occasion: o.id, lang, from: settings.family || settings.name || '' }, 1)[0]])), [list, lang, settings.family, settings.name]);

  return (
    <div class="screen explore">
      <header class="tab-head"><h1>Explore</h1><p>{list.length} occasions, from Lohri to griha pravesh. Tap one to make it yours.</p></header>
      <input class="input" type="search" id="explore-q" placeholder="Search occasions, festivals, regions…" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      <div class="chips-row">
        <Chip small on={cat === 'all'} onClick={() => setCat('all')}>All</Chip>
        {CATEGORIES.map((c) => <Chip small on={cat === c.id} onClick={() => setCat(c.id)}>{c.en}</Chip>)}
      </div>
      <div class="grid">
        {list.map((o) => (
          <button class="grid-card tile" onClick={() => open('results', { req: { occasion: o.id, lang } })}>
            <CardImage spec={previews[o.id]} scale={0.24} lazy />
            <span class="tile-label"><b>{o.en}</b><small>{o.hi}{o.region ? ` · ${o.region}` : ''}</small></span>
          </button>
        ))}
      </div>
      {!list.length && <p class="empty">No occasion matches “{q}”. You can still make a card for it: go to Create and type it in your own words.</p>}
    </div>
  );
}
