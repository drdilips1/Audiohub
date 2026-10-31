// Live transcript panel for the full player: lines appear a little ahead of the
// audio, the current one is highlighted and kept in view; tap a line to jump.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useBackClose } from '../lib/nav.js';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import * as player from '../lib/player.js';
import { knownCharacters, CharacterCard } from './story-sheet.jsx';
import { useStore, bookmarks } from '../lib/store.js';
import { MODELS, transcriptAvailable, subscribeTranscript, follow, installedModels, downloadModel, restartTranscript, findEbook, takeEbook, ebooksOnPhone, takeOnPhone, heardLines, fixHeard, stopLooking, transcriptCfg } from '../lib/transcript.js';
import { cachedXray } from '../lib/xray.js';
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
  const [query, setQuery] = useState(''); // your own words for the search ('' = the audiobook's title)
  const [sheetOpen, setSheetOpen] = useState(false);
  const run = useRef(0); // the latest search: one from a closed sheet mustn't reopen it
  const search = async (q = '') => {
    const my = ++run.current;
    setSheetOpen(true);
    setBusy('search');
    const onPhone = await ebooksOnPhone(q);
    if (my !== run.current) return;
    setMine(onPhone);
    try {
      const found = await findEbook(q);
      if (my === run.current) setHits(found);
    } catch (e) {
      if (my === run.current) (toast(e?.message || String(e)), setHits([]));
    }
    if (my === run.current) setBusy('');
  };
  const pickMine = async (eb) => {
    close();
    await takeOnPhone(eb);
  };
  // An EPUB / PDF anywhere on the phone (e.g. downloaded in the browser): pick it, it's added and used.
  const pickFile = async () => {
    try {
      const { pickBooks } = await import('../sources/local.js');
      const [eb] = await pickBooks({ books: true });
      if (!eb) return;
      close();
      await takeOnPhone(eb);
      toast(`Using “${eb.title}”`);
    } catch (e) {
      if (e?.message !== 'cancelled') toast(e?.message || String(e));
    }
  };
  const take = async (h) => {
    setBusy(h.r.link);
    try {
      await takeEbook(h);
      close();
    } catch (e) {
      toast(e?.message || String(e));
    }
    setBusy('');
  };
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
                {h.file.format === '?' ? 'Type unknown (checked when picked)' : h.file.format}
                {h.r.size ? ` · ${(h.r.size / 1048576).toFixed(1)} MB` : ''} · {h.source}
              </small>
            </span>
            {busy === h.r.link ? <span class="spinner small" /> : <em>Download</em>}
          </button>
        ))}
      </div>
    ) : (
      <p class="tl-source">No EPUB {query.trim() ? `for “${query.trim()}”` : 'of this book'} in your sources — try other words.</p>
    ));
  const open = sheetOpen;
  // Closing always works, even mid-search (that search is just forgotten).
  const close = () => {
    run.current++;
    setSheetOpen(false);
    setBusy('');
    setHits(null);
    setMine(null);
    setQuery('');
  };
  const sheet = open && (
    <PickSheet close={close}>
      <h3>{b?.state === 'on' ? 'Use another ebook' : 'Get the ebook'}</h3>
      <p class="muted small">With the ebook of this book, the transcript shows its exact words.</p>
      <form
        class="tl-ebook-search"
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
      >
        <input type="search" value={query} placeholder={`Search, e.g. “${player.getState().book?.title || 'title'} book 2”`} onInput={(e) => setQuery(e.currentTarget.value)} />
        <button class="btn primary" disabled={busy === 'search'}>
          Search
        </button>
      </form>
      {phoneList}
      {mine && !mine.length && query.trim() && <p class="tl-source">Nothing on this phone matches “{query.trim()}”.</p>}
      <button class="btn secondary wide tl-pick-file" disabled={!!busy && busy !== 'search'} onClick={pickFile}>
        <Icon name="book" size={15} /> Choose a file from this phone (Downloads…)
      </button>
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
  if (!b) return null;
  if (b.state === 'loading')
    return (
      <div class="tl-bar">
        <span>
          <span class="spinner small" /> Looking for the ebook…
        </span>
        <button class="link-btn" onClick={() => search()}>
          Choose
        </button>
        <button class="link-btn" onClick={stopLooking}>
          Stop
        </button>
        {open && sheet}
      </div>
    );
  // A small bar above the text (it doesn't scroll away): which words you're reading, and a way to change it.
  if (b.state === 'on')
    return (
      <div class="tl-bar">
        <span>📖 Ebook{b.title ? `: ${b.title}` : ''}</span>
        <button class="link-btn" disabled={!!busy} onClick={() => search()}>
          Change
        </button>
        {sheet}
      </div>
    );
  return (
    <div class={'tl-bar' + (b.state === 'error' ? ' err' : '')}>
      <span>{b.state === 'error' ? `Couldn't use your ebook: ${b.error}` : 'Heard from the audio, some words may be wrong'}</span>
      <button class="pill small" disabled={!!busy} onClick={() => search()}>
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
  // Long-press a line to highlight it (a bookmark with its words, in Notes); again to remove.
  const marks = useStore(bookmarks);
  const press = useRef({ timer: 0, fired: false });
  // A highlighted line: its moment falls within the line, or its words are the line's (lines
  // are recognised afresh each time you play, so their exact start can shift a little).
  const squash = (v) => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const quoted = (i) => {
    const g = segs[i];
    const next = segs.slice(i + 1).find((x) => x.start != null)?.start ?? g.start + 15;
    const text = squash(typeof g.book === 'string' ? g.book : g.text);
    return (marks[s.book?.uid] || []).some(
      (b) => b.quote && b.track === s.index && ((b.time >= g.start - 1 && b.time < next) || (text.length > 20 && (text.includes(squash(b.label).slice(0, 60)) || squash(b.label).includes(text.slice(0, 60)))))
    );
  };
  const hold = (start, text) => {
    clearTimeout(press.current.timer);
    press.current.timer = setTimeout(() => {
      press.current.fired = true;
      const added = player.toggleQuote(start, typeof text === 'string' ? text : String(text || ''));
      navigator.vibrate?.(15);
      toast(added ? 'Highlighted — find it in Notes' : 'Highlight removed');
    }, 550);
  };
  const release = () => clearTimeout(press.current.timer);
  const [t, setT] = useState(null);
  const chars = useStore(knownCharacters);
  const [card, setCard] = useState(null);
  // The player's Find button opens the text with the search ready.
  const [finding, setFinding] = useState(() => !!transcriptCfg.get().find);
  useEffect(() => {
    if (transcriptCfg.get().find) transcriptCfg.set({ ...transcriptCfg.get(), find: false });
  }, []);
  const list = chars.uid === s.book?.uid ? chars.list : [];
  // Full names, aliases and distinctive first names all link to the same character.
  const lookup = new Map();
  for (const c of list) {
    for (const n of [c.name, ...(c.aliases || []), c.name.split(' ')[0]]) if (n && n.length > 2 && !lookup.has(n)) lookup.set(n, c);
  }
  const names = [...lookup.keys()];
  // Everyone the book has (X-Ray's cast and places too): misheard names are put right.
  const xr = s.book?.uid ? cachedXray(s.book.uid) : null;
  const allNames = [...names, ...(xr ? [...xr.people, ...xr.places].flatMap((x) => [x.name, ...(x.aliases || [])]) : [])];
  const heard = (text) => (typeof text === 'string' ? fixHeard(text, allNames) : text);
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
            class={'tl' + (i === active ? ' on' : i < active ? ' past' : '') + (t?.bookText?.state === 'on' && !g.book && !t?.published ? ' heard' : '') + (g.start != null && quoted(i) ? ' hl' : '')}
            onClick={() => (press.current.fired ? (press.current.fired = false) : g.start != null && player.seek(g.start))}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={() => g.start != null && hold(g.start, !t?.published && t?.bookText?.state === 'on' && g.book ? g.book : heard(g.text))}
            onPointerUp={release}
            onPointerLeave={release}
            onPointerCancel={release}
          >
            {withNames(!t?.published && t?.bookText?.state === 'on' && g.book ? g.book : heard(g.text), names, (n) => setCard(lookup.get(n)))}
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
