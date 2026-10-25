// Live transcript panel for the full player: lines appear a little ahead of the
// audio, the current one is highlighted and kept in view; tap a line to jump.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useBackClose } from '../lib/nav.js';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import * as player from '../lib/player.js';
import { knownCharacters, CharacterCard } from './story-sheet.jsx';
import { useStore } from '../lib/store.js';
import { MODELS, transcriptAvailable, subscribeTranscript, follow, installedModels, downloadModel, restartTranscript, findEbook, takeEbook, ebooksOnPhone, takeOnPhone, heardLines } from '../lib/transcript.js';
import { fmtTime } from '../lib/format.js';

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
      </span>,
    );
    last = m.index + name.length;
  }
  out.push(text.slice(last));
  return out;
}

/** Whether the lines show the ebook's exact words, and a way to get the ebook from your sources. */
function EbookStatus({ b }) {
  const [hits, setHits] = useState(null); // null: not searched; [] none found
  const [mine, setMine] = useState(null); // ebooks already on the phone
  const [busy, setBusy] = useState(''); // 'search' | link being downloaded
  const search = async () => {
    setBusy('search');
    setMine(await ebooksOnPhone());
    try {
      setHits(await findEbook());
    } catch (e) {
      toast(e?.message || String(e));
      setHits([]);
    }
    setBusy('');
  };
  const pickMine = async (eb) => {
    setHits(null);
    setMine(null);
    await takeOnPhone(eb);
  };
  const take = async (h) => {
    setBusy(h.r.link);
    try {
      await takeEbook(h);
      setHits(null);
      setMine(null);
    } catch (e) {
      toast(e?.message || String(e));
    }
    setBusy('');
  };
  if (!b || b.state === 'loading')
    return b ? (
      <div class="tl-bar">
        <span>
          <span class="spinner small" /> Looking for your ebook of this book…
        </span>
      </div>
    ) : null;
  const phoneList = mine?.length > 0 && (
    <div class="tl-ebook-hits">
      <p class="tl-source">On this phone</p>
      {mine.slice(0, 8).map((eb) => (
        <button class="tl-ebook-hit" disabled={busy && busy !== 'search'} onClick={() => pickMine(eb)}>
          <span>
            <b>{eb.title}</b>
            <small>
              {eb.ebookFormat || eb.format || 'Ebook'}
              {eb.author ? ` · ${eb.author}` : ''}
            </small>
          </span>
          <em>Use</em>
        </button>
      ))}
    </div>
  );
  const srcList =
    hits &&
    (hits.length ? (
      <div class="tl-ebook-hits">
        {hits.slice(0, 6).map((h) => (
          <button class="tl-ebook-hit" disabled={!!busy} onClick={() => take(h)}>
            <span>
              <b>{h.r.title || h.file.name}</b>
              <small>
                {h.file.format}
                {h.r.size ? ` · ${(h.r.size / 1048576).toFixed(1)} MB` : ''} · {h.source}
              </small>
            </span>
            {busy === h.r.link ? <span class="spinner small" /> : <em>Download</em>}
          </button>
        ))}
      </div>
    ) : (
      <p class="tl-source">No EPUB of this book in your sources.</p>
    ));
  const open = !!(mine || hits || busy === 'search');
  const close = () => {
    setHits(null);
    setMine(null);
  };
  const sheet = open && (
    <PickSheet close={close}>
      <h3>{b.state === 'on' ? 'Use another ebook' : 'Get the ebook'}</h3>
      <p class="muted small">With the ebook of this book, the transcript shows its exact words.</p>
      {phoneList}
      {busy === 'search' ? (
        <p class="tl-source">
          <span class="spinner small" /> Searching your sources…
        </p>
      ) : (
        hits && <p class="tl-source">From your sources</p>
      )}
      {srcList}
    </PickSheet>
  );
  // A small bar above the text (it doesn't scroll away): which words you're reading, and a way to change it.
  if (b.state === 'on')
    return (
      <div class="tl-bar">
        <span>📖 Ebook{b.title ? `: ${b.title}` : ''}</span>
        <button class="link-btn" disabled={!!busy} onClick={search}>
          Change
        </button>
        {sheet}
      </div>
    );
  return (
    <div class={'tl-bar' + (b.state === 'error' ? ' err' : '')}>
      <span>{b.state === 'error' ? `Couldn't use your ebook: ${b.error}` : 'Heard from the audio, some words may be wrong'}</span>
      <button class="pill small" disabled={!!busy} onClick={search}>
        {busy === 'search' ? <span class="spinner small" /> : 'Get the ebook'}
      </button>
      {sheet}
    </div>
  );
}

function PickSheet({ close, children }) {
  useBackClose(true, close);
  return (
    <div class="sheet-backdrop" onClick={close}>
      <div class="sheet tl-pick" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        {children}
      </div>
    </div>
  );
}

export function TranscriptView({ s }) {
  const [t, setT] = useState(null);
  const chars = useStore(knownCharacters);
  const [card, setCard] = useState(null);
  const [finding, setFinding] = useState(false);
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
    if (transcriptAvailable || s.book?.transcript) follow(s); // start straight away when opened
  }, [s.book?.uid, s.index]);

  const segs = t?.segments || [];
  let active = -1;
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i].start != null && segs[i].start <= s.time + 0.2) {
      active = i;
      break;
    }
  }
  useEffect(() => {
    if (active < 0 || Date.now() - userScroll.current < 4000) return;
    const el = box.current?.querySelector(`[data-i="${active}"]`);
    if (!el) return;
    const b = box.current;
    // In the middle of the text area.
    b.scrollTo({ top: el.offsetTop - b.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
  }, [active]);

  if (!transcriptAvailable && !s.book?.transcript) {
    return (
      <div class="transcript empty">
        <p>The live transcript works in the Android app.</p>
      </div>
    );
  }
  if (t?.status === 'no-model') return <ModelPicker />;

  return (
    <div class="transcript-col">
      <div class="tl-top">
        {!t?.published ? <EbookStatus b={t?.bookText} /> : <span class="tl-grow" />}
        <button class={'icon-btn tl-find-btn' + (finding ? ' active' : '')} aria-label="Search what you've heard" onClick={() => setFinding(!finding)}>
          <Icon name={finding ? 'close' : 'search'} size={18} />
        </button>
      </div>
      {finding && <FindHeard s={s} close={() => setFinding(false)} />}
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
                <p>
                  {t?.published
                    ? 'Loading the transcript from the podcast…'
                    : t?.status === 'loading'
                      ? t.error === 'model'
                        ? 'Loading the speech model…'
                        : t.error === 'audio'
                          ? 'Opening the book’s audio…'
                          : 'Starting speech recognition…'
                      : 'Listening… the words appear a few seconds ahead of the audio.'}
                </p>
              </>
            )}
          </div>
        )}
        {t?.published && segs.length > 0 && <p class="tl-source">Transcript from the podcast</p>}
        {segs.map((g, i) => (
          <p
            data-i={i}
            class={'tl' + (i === active ? ' on' : i < active ? ' past' : '') + (t?.bookText?.state === 'on' && !g.book && !t?.published ? ' heard' : '')}
            onClick={() => g.start != null && player.seek(g.start)}
          >
            {withNames(!t?.published && t?.bookText?.state === 'on' && g.book ? g.book : g.text, names, (n) => setCard(lookup.get(n)))}
          </p>
        ))}
        {segs.length > 0 && t?.status === 'error' && <p class="err small">{t.error}</p>}
        {card && <CharacterCard c={card} close={() => setCard(null)} />}
        <div class="transcript-pad" />
      </div>
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
      await downloadModel(m, (e) =>
        setBusy({
          id: m.id,
          pct: e.phase === 'unpack' ? 100 : e.total ? Math.round((e.received / e.total) * 100) : 0,
          phase: e.phase,
        }),
      );
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

/** Search everything heard of this book so far (all parts); tap a line to play from there. */
function FindHeard({ s, close }) {
  const [q, setQ] = useState('');
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const hits = words.length
    ? heardLines(s.book.uid)
        .filter((l) => words.every((w) => l.text.toLowerCase().includes(w)))
        .slice(0, 40)
    : [];
  const mark = (text) => {
    const w = words.find((x) => text.toLowerCase().includes(x));
    if (!w) return text;
    const i = text.toLowerCase().indexOf(w);
    return [text.slice(0, i), <mark>{text.slice(i, i + w.length)}</mark>, text.slice(i + w.length)];
  };
  return (
    <div class="tl-find">
      <input type="search" autoFocus placeholder="Search what you've heard in this book" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      {words.length > 0 && (
        <div class="tl-find-hits">
          {hits.map((l) => {
            const g = player.trackOffset(l.track) + l.start;
            return (
              <button
                onClick={() => {
                  player.playAt(Math.max(0, g - 3));
                  close();
                }}
              >
                <small>{fmtTime(g)}</small>
                <span>{mark(l.text)}</span>
              </button>
            );
          })}
          {!hits.length && <p class="muted small">Not in what you've heard yet (only parts played with Text on are searchable).</p>}
        </div>
      )}
    </div>
  );
}
