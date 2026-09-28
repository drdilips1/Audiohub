// Live transcript panel for the full player: lines appear a little ahead of the
// audio, the current one is highlighted and kept in view; tap a line to jump.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import * as player from '../lib/player.js';
import { knownCharacters, CharacterCard } from './story-sheet.jsx';
import { useStore } from '../lib/store.js';
import { MODELS, transcriptAvailable, subscribeTranscript, follow, installedModels, downloadModel, restartTranscript } from '../lib/transcript.js';

// Wrap known character names in tappable spans.
function withNames(text, names, onTap) {
  if (!names.length) return text;
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(${esc.join('|')})\\b`, 'g');
  const out = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const name = m[0];
    out.push(
      <span
        class="char-link"
        onClick={(e) => {
          e.stopPropagation();
          onTap(name);
        }}
      >
        {name}
      </span>
    );
    last = m.index + name.length;
  }
  out.push(text.slice(last));
  return out;
}

export function TranscriptView({ s }) {
  const [t, setT] = useState(null);
  const chars = useStore(knownCharacters);
  const [card, setCard] = useState(null);
  const list = chars.uid === s.book?.uid ? chars.list : [];
  // Full names, aliases and distinctive first names all link to the same character.
  const lookup = new Map();
  for (const c of list) {
    for (const n of [c.name, ...(c.aliases || []), c.name.split(' ')[0]]) if (n && n.length > 2 && !lookup.has(n)) lookup.set(n, c);
  }
  const names = [...lookup.keys()];
  const box = useRef();
  const userScroll = useRef(0);
  useEffect(() => subscribeTranscript(setT), []);
  useEffect(() => {
    if (transcriptAvailable) follow(s); // start straight away when opened
  }, [s.book?.uid, s.index]);

  const segs = t?.segments || [];
  let active = -1;
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i].start <= s.time + 0.2) {
      active = i;
      break;
    }
  }
  useEffect(() => {
    if (active < 0 || Date.now() - userScroll.current < 4000) return;
    const el = box.current?.querySelector(`[data-i="${active}"]`);
    if (!el) return;
    const b = box.current;
    b.scrollTo({ top: el.offsetTop - b.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
  }, [active]);

  if (!transcriptAvailable) {
    return (
      <div class="transcript empty">
        <p>The live transcript works in the Android app.</p>
      </div>
    );
  }
  if (t?.status === 'no-model') return <ModelPicker />;

  return (
    <div class="transcript" ref={box} onTouchMove={() => (userScroll.current = Date.now())} onWheel={() => (userScroll.current = Date.now())}>
      {segs.length === 0 && (
        <div class="transcript-wait">
          {t?.status === 'error' ? (
            <>
              <p class="err">{t.error || 'The transcript stopped.'}</p>
              <button class="pill small" onClick={restartTranscript}>
                Try again
              </button>
            </>
          ) : (
            <>
              <span class="spinner small" />
              <p>{t?.status === 'loading' ? 'Starting speech recognition…' : 'Listening… the words appear a few seconds ahead of the audio.'}</p>
            </>
          )}
        </div>
      )}
      {segs.map((g, i) => (
        <p data-i={i} class={'tl' + (i === active ? ' on' : i < active ? ' past' : '')} onClick={() => player.seek(g.start)}>
          {withNames(g.text, names, (n) => setCard(lookup.get(n)))}
        </p>
      ))}
      {segs.length > 0 && t?.status === 'error' && <p class="err small">{t.error}</p>}
      {card && <CharacterCard c={card} close={() => setCard(null)} />}
      <div class="transcript-pad" />
    </div>
  );
}

function ModelPicker() {
  const [have, setHave] = useState([]);
  const [busy, setBusy] = useState(null); // { id, pct }
  useEffect(() => {
    installedModels().then((l) => setHave(l.map((m) => m.id)));
  }, []);
  const get = async (m) => {
    setBusy({ id: m.id, pct: 0 });
    try {
      await downloadModel(m, (e) => setBusy({ id: m.id, pct: e.phase === 'unpack' ? 100 : e.total ? Math.round((e.received / e.total) * 100) : 0, phase: e.phase }));
      toast(`${m.name} transcript model ready`);
      restartTranscript();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div class="transcript picker">
      <h3>
        <Icon name="text" size={18} /> Live transcript
      </h3>
      <p class="muted">Read the words as the audiobook plays. Speech is recognised on your phone — download a model once (Wi‑Fi recommended); it works offline after that.</p>
      {MODELS.map((m) => (
        <div class="tm-row">
          <div>
            <b>{m.name}</b>
            <small>
              {m.what} · {m.size}
            </small>
          </div>
          {have.includes(m.id) ? (
            <span class="pill small active">Installed</span>
          ) : busy?.id === m.id ? (
            <span class="pill small">{busy.phase === 'unpack' ? 'Unpacking…' : `${busy.pct}%`}</span>
          ) : (
            <button class="pill small" disabled={!!busy} onClick={() => get(m)}>
              <Icon name="download" size={14} /> Get
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

