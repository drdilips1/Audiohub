// Home: one box to describe the card you want, what's coming up, quick everyday
// wishes, today's fresh good-morning card, and your recent cards.
import { useMemo, useState } from 'preact/hooks';
import { useStore } from '../lib/store.js';
import { open, go } from '../lib/nav.js';
import { upcoming, todayYmd, whenText, shortDate } from '../lib/calendar.js';
import { occasionById } from '../lib/occasions.js';
import { offlineCards } from '../lib/compose.js';
import { CardImage } from '../components/CardImage.jsx';
import { Section, Icon } from '../components/ui.jsx';

const EXAMPLES = [
  'A beautiful birthday card for my elder sister, emotional but not too sentimental',
  'Wish my boss on his retirement, classy and respectful',
  'Diwali greeting from our family, traditional but sophisticated',
  'Anniversary wish for my wife, romantic and personal',
  'माँ के लिए जन्मदिन का प्यारा सा कार्ड',
  'Lohri wishes for my Punjabi friends, fun and colourful',
];

const QUICK = ['goodmorning', 'birthday', 'thankyou', 'congrats', 'anniversary', 'getwell', 'goodnight', 'sorry'];

export function Home() {
  const settings = useStore('settings');
  const people = useStore('people');
  const custom = useStore('custom');
  const moved = useStore('moved');
  const cards = useStore('cards');
  const [text, setText] = useState('');
  const today = todayYmd();
  const soon = useMemo(() => upcoming({ from: today, days: 75, people, custom, moved }).slice(0, 10), [today, people, custom, moved]);
  const lang = settings.lang || 'hi';
  const from = settings.family || settings.name || '';

  // A fresh good-morning card each day, in your language.
  const daily = useMemo(() => {
    const day = Number(today.replace(/-/g, '')) % 97;
    const theme = new Date().getHours() >= 19 ? 'goodnight' : 'goodmorning';
    return offlineCards({ occasion: theme, lang, from }, 1, day % 3)[0];
  }, [today, lang, from]);

  const hello = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const create = (t) => { const v = (t ?? text).trim(); if (v) open('results', { req: { note: v } }); };

  return (
    <div class="screen home">
      <header class="home-head">
        <div>
          <p class="eyebrow">{hello}{settings.name ? `, ${settings.name}` : ''}</p>
          <h1 class="brand">Utsav</h1>
        </div>
        <button class="icon-btn" aria-label="Settings" onClick={() => open('settings')}>{Icon.gear}</button>
      </header>

      <form class="ask" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <label for="ask" class="ask-label">Who are you wishing, and for what?</label>
        <textarea id="ask" rows="3" value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder={EXAMPLES[0]} />
        <div class="ask-row">
          <button class="btn primary" type="submit" disabled={!text.trim()}>{Icon.create} Create my card</button>
          <button class="btn ghost" type="button" onClick={() => go('create')}>Step by step</button>
        </div>
        <div class="examples">
          {EXAMPLES.slice(1).map((e) => <button type="button" class="example" onClick={() => { setText(e); create(e); }}>{e}</button>)}
        </div>
      </form>

      {soon.length > 0 && (
        <Section title="Coming up" action={<button class="link" onClick={() => go('occasions')}>All dates</button>}>
          <div class="h-scroll">
            {soon.map((e) => {
              const occ = occasionById(e.occasion);
              const req = { occasion: e.occasion === 'custom' ? null : e.occasion, customOccasion: e.kind === 'custom' ? e.label : null, theme: e.theme, relation: e.relation || occ?.rel || null, to: e.kind === 'person' ? e.name : '', from, lang, number: e.years || null };
              return (
                <button class={`soon${e.daysLeft === 0 ? ' today' : ''}`} onClick={() => open('results', { req })}>
                  <span class="soon-when">{whenText(e.daysLeft)}</span>
                  <span class="soon-name">{e.label}</span>
                  <span class="soon-date">{shortDate(e.date)}{e.approx ? ' · approx.' : ''}{e.years ? ` · turns ${e.years}` : ''}</span>
                  <span class="soon-cta">Make card →</span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Quick wishes">
        <div class="quick">
          {QUICK.map((id) => { const o = occasionById(id); return <button class="quick-btn" onClick={() => open('results', { req: { occasion: id, lang, from } })}><b>{o.en}</b><small>{o.hi}</small></button>; })}
        </div>
      </Section>

      <Section title="Today’s fresh wish" action={<button class="link" onClick={() => open('editor', { spec: daily })}>Edit & send</button>}>
        <button class="daily" onClick={() => open('editor', { spec: daily })}><CardImage spec={daily} scale={0.4} /></button>
      </Section>

      {cards.length > 0 && (
        <Section title="Recent cards" action={<button class="link" onClick={() => go('mycards')}>See all</button>}>
          <div class="h-scroll">
            {cards.slice(0, 8).map((c) => <button class="thumb" onClick={() => open('editor', { spec: c })}><CardImage spec={c} scale={0.22} lazy /></button>)}
          </div>
        </Section>
      )}
    </div>
  );
}
