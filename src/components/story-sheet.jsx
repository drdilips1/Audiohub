// "Story" sheet in the player: a spoiler-safe recap (read or listen) and a
// character glossary with a timeline slider that never goes past where you are.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { persisted } from '../lib/store.js';
import { aiReady, recap, characters, position } from '../lib/ai.js';
import { speak, stopSpeaking } from '../lib/tts.js';

/** Characters for the current position, shared with the transcript (tap a name). */
export const knownCharacters = persisted('knownCharacters', { uid: '', at: -1, list: [] });

export function StorySheet({ close }) {
  const [tab, setTab] = useState('recap');
  if (!aiReady()) {
    return (
      <div class="story">
        <h3>
          <Icon name="sparkle" size={18} /> Story helper
        </h3>
        <p class="muted">Recaps and the spoiler-free character guide use a free AI service (Groq or OpenRouter). Add a free key once in Settings → AI.</p>
        <button
          class="btn primary"
          onClick={() => {
            close();
            nav.closeOverlay();
            nav.tab('settings');
          }}
        >
          Open Settings
        </button>
      </div>
    );
  }
  return (
    <div class="story">
      <div class="segmented">
        <button class={tab === 'recap' ? 'on' : ''} onClick={() => setTab('recap')}>
          Recap
        </button>
        <button class={tab === 'chars' ? 'on' : ''} onClick={() => setTab('chars')}>
          Characters
        </button>
      </div>
      {tab === 'recap' ? <Recap /> : <Characters />}
    </div>
  );
}

function Recap() {
  const [mode, setMode] = useState(null); // 'story' | 'chapter'
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [fallback, setFallback] = useState(null); // { err, about } when the AI can't answer
  const run = async (m) => {
    setMode(m);
    setText('');
    setFallback(null);
    setBusy(true);
    try {
      setText(await recap(m));
    } catch (e) {
      // No AI right now: show the (spoiler-free) publisher description instead of nothing.
      let about = '';
      try {
        about = position().book.description || '';
      } catch {}
      setFallback({ err: e.message, about });
    } finally {
      setBusy(false);
    }
  };
  const readAloud = async () => {
    if (reading) {
      stopSpeaking();
      setReading(false);
      return;
    }
    player.pause();
    setReading(true);
    try {
      for (const para of text.split(/\n+/).filter((x) => x.trim())) await speak(para);
    } catch {}
    setReading(false);
  };
  useEffect(() => () => stopSpeaking(), []);
  let where = '';
  try {
    where = position().label;
  } catch {}
  return (
    <>
      <p class="muted small">You're at {where}. Nothing after this point is included.</p>
      <div class="story-actions">
        <button class={'pill' + (mode === 'story' ? ' active' : '')} disabled={busy} onClick={() => run('story')}>
          The story so far
        </button>
        <button class={'pill' + (mode === 'chapter' ? ' active' : '')} disabled={busy} onClick={() => run('chapter')}>
          Previous chapter
        </button>
      </div>
      {busy && (
        <p class="muted">
          <span class="spinner small" /> Writing your recap…
        </p>
      )}
      {fallback && (
        <div class="story-fallback">
          <p class="err">{fallback.err}</p>
          {fallback.about && (
            <>
              <p class="muted small">Meanwhile, here's what the book is about:</p>
              <div class="story-text">
                {fallback.about.split(/\n+/).map((p) => (
                  <p>{p}</p>
                ))}
              </div>
            </>
          )}
          <button class="btn ghost-wide" onClick={() => run(mode)}>
            Try again
          </button>
        </div>
      )}
      {text && (
        <>
          <div class="story-text">
            {text.split(/\n+/).map((p) => (
              <p>{p}</p>
            ))}
          </div>
          <button class="btn ghost-wide" onClick={readAloud}>
            <Icon name={reading ? 'pause' : 'headphones'} size={16} /> {reading ? 'Stop reading' : 'Read aloud'}
          </button>
        </>
      )}
    </>
  );
}

function Characters() {
  let pos = null;
  try {
    pos = position();
  } catch {}
  const max = pos ? pos.current : 0;
  const [at, setAt] = useState(max);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!pos) return;
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      characters(at)
        .then((d) => {
          if (!alive) return;
          setData(d);
          if (at === max) knownCharacters.set({ uid: pos.book.uid, at, list: d.list });
        })
        .catch((e) => alive && toast(e.message))
        .finally(() => alive && setBusy(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [at]);
  if (!pos) return <p class="muted">Start a book first.</p>;
  const list = (data?.list || []).filter((c) => !q || `${c.name} ${(c.aliases || []).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div class="timeline">
        <div class="timeline-head">
          <span>Known up to</span>
          <b>{pos.chapters[at]?.title || `Part ${at + 1}`}</b>
        </div>
        {max > 0 && <input type="range" min="0" max={max} step="1" value={at} onInput={(e) => setAt(+e.currentTarget.value)} style={{ '--pct': (at / max) * 100 + '%' }} />}
        <small class="muted">The slider stops at where you are — no spoilers beyond it.</small>
      </div>
      <input class="story-search" placeholder="Find a character" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      {busy && !data && (
        <p class="muted">
          <span class="spinner small" /> Gathering characters…
        </p>
      )}
      <ul class="char-list">
        {list.map((c) => (
          <li class={open === c.name ? 'open' : ''} onClick={() => setOpen(open === c.name ? null : c.name)}>
            <div class="char-head">
              <b>{c.name}</b>
              <span>{c.role}</span>
            </div>
            {open === c.name && <p>{c.about}</p>}
          </li>
        ))}
      </ul>
      {data && !list.length && !busy && <p class="muted">No characters to show yet.</p>}
    </>
  );
}

/** Small card for a character tapped in the transcript. */
export function CharacterCard({ c, close }) {
  return (
    <div class="sheet-backdrop" onClick={close}>
      <div class="sheet char-card" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <h3>{c.name}</h3>
        {c.role && <p class="muted">{c.role}</p>}
        <p>{c.about}</p>
        <small class="muted">Only what's known up to where you are.</small>
      </div>
    </div>
  );
}
