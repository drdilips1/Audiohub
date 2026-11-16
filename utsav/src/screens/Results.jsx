// Results: several finished cards for one request. Built-in designs show at once, and
// AI-written, AI-designed cards replace them when they arrive (a few seconds).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { get, useStore } from '../lib/store.js';
import { open } from '../lib/nav.js';
import { parseRequest } from '../lib/intent.js';
import { offlineCards, fromAi, aiRequest, occasionOf } from '../lib/compose.js';
import { generateCards, aiMode } from '../lib/ai.js';
import { relationById } from '../lib/relations.js';
import { LANGS, LANG_IDS } from '../lib/languages.js';
import { TONES, hasOwnWords } from '../lib/messages.js';
import { CardImage } from '../components/CardImage.jsx';
import { PageHeader, Chip } from '../components/ui.jsx';

export function Results({ req: initial }) {
  const settings = useStore('settings');
  const start = useMemo(() => {
    const parsed = initial.note ? parseRequest(initial.note, { lang: settings.lang }) : {};
    const from = initial.from ?? (parsed.from || (parsed.fromFamily ? settings.family : '') || settings.family || settings.name || '');
    return { lang: settings.lang || 'en', tone: 'warm', ...parsed, ...Object.fromEntries(Object.entries(initial).filter(([, v]) => v != null && v !== '')), from };
  }, [initial]);
  const [req, setReq] = useState(start);
  const [extra, setExtra] = useState(0);
  const [ai, setAi] = useState({ state: 'idle', cards: [], error: '' });

  const offline = useMemo(() => offlineCards(req, 4 + extra * 4), [req, extra]);
  const occ = occasionOf(req);

  useEffect(() => {
    let live = true;
    (async () => {
      const mode = await aiMode(get('settings'));
      if (!mode) { setAi({ state: 'off', cards: [], error: '' }); return; }
      setAi({ state: 'loading', cards: [], error: '' });
      try {
        const { cards } = await generateCards(aiRequest(req), get('settings'));
        if (live) setAi({ state: 'done', cards: cards.map((c, i) => fromAi(c, req, i)), error: '' });
      } catch (e) {
        if (live) setAi({ state: 'error', cards: [], error: e?.message || 'The AI could not answer just now.' });
      }
    })();
    return () => { live = false; };
  }, [req]);

  const update = (patch) => { setExtra(0); setReq((r) => ({ ...r, ...patch })); };
  const shown = [...ai.cards, ...offline];
  const rel = relationById(req.relation);

  return (
    <div class="screen results">
      <PageHeader title={occ.en} sub={[rel ? `For your ${rel.en.toLowerCase()}` : '', req.to].filter(Boolean).join(' · ') || 'Pick a design, then make it yours'} />

      <div class="chips-row" aria-label="Language">
        {LANG_IDS.map((l) => <Chip small on={req.lang === l} onClick={() => update({ lang: l })}>{LANGS[l].native}</Chip>)}
      </div>
      <div class="chips-row" aria-label="Tone">
        {TONES.map((t) => <Chip small on={req.tone === t.id} onClick={() => update({ tone: t.id })}>{t.en}</Chip>)}
      </div>

      <p class={`ai-note ${ai.state}`}>
        {ai.state === 'loading' && 'Writing and designing cards for you…'}
        {ai.state === 'done' && `AI made the first ${ai.cards.length} cards for you. The rest use built-in designs.`}
        {ai.state === 'error' && `${ai.error} These cards use built-in words.`}
        {ai.state === 'off' && (hasOwnWords(occ, req.lang)
          ? 'Built-in words and designs. Turn on AI in Settings for wording written just for this person.'
          : `We don’t have hand-written ${LANGS[req.lang].name} words for this occasion yet, so these use a general wish. Turn on AI in Settings for proper wording.`)}
      </p>

      <div class="grid">
        {ai.state === 'loading' && [0, 1, 2].map(() => <div class="card-skel" />)}
        {shown.map((s, i) => (
          <button class="grid-card" onClick={() => open('editor', { spec: s })}>
            <CardImage spec={s} scale={0.3} lazy={i > 3} />
            {s.source === 'ai' && <span class="badge">AI</span>}
          </button>
        ))}
      </div>
      <button class="btn ghost wide" onClick={() => setExtra((n) => n + 1)}>More designs</button>
    </div>
  );
}
