import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../components/icons.jsx';
import { gb } from '../sources/index.js';
import { loadSummary } from '../sources/summaries.js';
import { isCloudEbook, loadCloudEbook } from '../lib/epub.js';
import { progress, settings, summarize, useStore } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { readAloud, attachAloud } from '../lib/readaloud.js';
import { paragraphs, estimate, textBlocks, isSkippable, skipFrontMatter, nativeReader } from '../lib/tts.js';
import { narrate, canNarrate } from '../sources/ttsbooks.js';
import * as player from '../lib/player.js';
import { toast } from '../components/common.jsx';

const THEMES = [
  ['night', 'Night'],
  ['amoled', 'Black'],
  ['sepia', 'Sepia'],
  ['paper', 'Paper'],
];


export function Reader({ book, readAloud: autoAloud }) {
  const st = useStore(settings);
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState(null); // 'toc' | 'style'
  const [pct, setPct] = useState(0);
  const scroller = useRef();
  const [aloud, setAloud] = useState(null); // { playing, index }
  const ctl = useRef(null);
  const [aiBusy, setAiBusy] = useState('');

  // Readable paragraphs, worked out once per book (long ebooks have thousands).
  const blockCache = useRef(null);
  const blocks = () => {
    const root = scroller.current?.querySelector('.reader-text');
    if (!root) return [];
    if (blockCache.current?.root !== root) blockCache.current = { root, list: textBlocks(root) };
    return blockCache.current.list;
  };
  // What Read aloud goes through: contents / index left out when that setting is on.
  const speakBlocks = () => {
    const list = blocks();
    return skipFrontMatter() ? list.filter((el) => !isSkippable(el)) : list;
  };

  // Highlight + follow the paragraph being read (from either engine).
  const lit = useRef(null);
  const aloudHandlers = () => ({
    onIndex: (i, el) => {
      lit.current?.classList.remove('aloud');
      el.classList.add('aloud');
      lit.current = el;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setAloud((a) => ({ playing: a?.playing ?? true, index: i }));
    },
    // Native engine: pause/play from the notification or lock screen shows here too.
    onState: (st) => st.active && setAloud((a) => ({ playing: st.playing, index: a?.index ?? st.para })),
    onDone: () => setAloud((a) => a && { ...a, playing: false }),
    onError: (e) => {
      toast('Voice unavailable: ' + (e?.message || e));
      setAloud((a) => a && { ...a, playing: false });
    },
  });

  const startAloud = (from) => {
    const els = speakBlocks();
    if (!els.length) return;
    // start at the first paragraph visible on screen
    if (from == null) from = Math.max(0, firstVisible(els));
    from = Math.min(Math.max(0, from), els.length - 1);
    // Native engine already reading this book: just move.
    if (ctl.current?.native) {
      ctl.current.seek(from);
      ctl.current.resume();
      setAloud({ playing: true, index: from });
      return;
    }
    ctl.current?.stop();
    player.pause();
    setAloud({ playing: true, index: from });
    ctl.current = readAloud(els, from, aloudHandlers(), { uid: book.uid, title: book.title });
  };
  const pauseAloud = () => {
    if (ctl.current?.native) ctl.current.pause();
    else ctl.current?.stop();
    setAloud((a) => a && { ...a, playing: false });
  };
  const playAloud = (i) => {
    if (ctl.current?.native) {
      ctl.current.resume();
      setAloud((a) => a && { ...a, playing: true });
    } else startAloud(i);
  };
  const closeAloud = () => {
    ctl.current?.stop();
    ctl.current = null;
    scroller.current?.querySelectorAll('.aloud').forEach((x) => x.classList.remove('aloud'));
    setAloud(null);
  };
  // Leaving the reader: the native engine keeps reading (notification controls);
  // the in-page reader stops.
  useEffect(() => () => (ctl.current?.native ? ctl.current.detach() : ctl.current?.stop()), []);

  const listenAsAudiobook = async () => {
    setAiBusy('book');
    try {
      closeAloud();
      const audio = await narrate(book);
      nav.openOverlay('player');
      player.playBook(audio);
      setPanel(null);
    } catch (e) {
      toast(e.message);
    } finally {
      setAiBusy('');
    }
  };

  useEffect(() => {
    let alive = true;
    (book.source === 'sum' ? loadSummary(book) : isCloudEbook(book) ? loadCloudEbook(book) : gb.loadText(book))
      .then((d) => alive && setDoc(d))
      .catch((e) => alive && setError(e.message));
    return () => (alive = false);
  }, [book.uid]);

  useEffect(() => {
    if (!doc) return;
    // Already being read aloud (reader reopened / app came back): follow along.
    setTimeout(async () => {
      const attached = await attachAloud(book.uid, speakBlocks(), aloudHandlers());
      if (attached) ctl.current = attached;
      else if (autoAloud) startAloud();
    }, 400);
    // Opening a book puts it on the shelf (Library → Ebooks, Continue on Home) right away.
    if (doc && !progress.get()[book.uid])
      progress.set((all) => ({ ...all, [book.uid]: { kind: 'text', percent: 0, anchor: 0, finished: false, updatedAt: Date.now(), book: summarize(book) } }));
  }, [doc]);

  // The first of `list` at the top of the screen. Binary search: blocks are in page
  // order, and measuring every one would lay out the whole book.
  const firstVisible = (list) => {
    if (!scroller.current) return -1; // reader already closed
    const top = scroller.current.getBoundingClientRect().top + 60;
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].getBoundingClientRect().bottom < top) lo = mid + 1;
      else hi = mid;
    }
    return list.length ? lo : -1;
  };
  const topBlock = () => firstVisible(blocks());

  // Restore position once the text is rendered: to the exact paragraph when we
  // know it (long ebooks lay out lazily, so a percentage is only approximate).
  useEffect(() => {
    if (!doc || !scroller.current) return;
    const saved = progress.get()[book.uid];
    const el = scroller.current;
    requestAnimationFrame(() => {
      const target = saved?.anchor >= 0 ? blocks()[saved.anchor] : null;
      if (target) {
        target.scrollIntoView({ block: 'start' });
        el.scrollTop -= 70;
      } else if (saved?.percent) el.scrollTop = saved.percent * (el.scrollHeight - el.clientHeight);
    });
  }, [doc]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let t;
    const onScroll = () => {
      const p = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0;
      setPct(p);
      if (chrome && el.scrollTop > 200) setChrome(false);
      clearTimeout(t);
      t = setTimeout(() => {
        progress.set((all) => ({
          ...all,
          [book.uid]: { kind: 'text', percent: p, anchor: topBlock() >= 0 ? topBlock() : all[book.uid]?.anchor ?? 0, finished: p > 0.985, updatedAt: Date.now(), book: summarize(book) },
        }));
      }, 600);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [doc, chrome]);

  const page = (dir) => {
    const el = scroller.current;
    el.scrollBy({ top: dir * (el.clientHeight - 60), behavior: 'smooth' });
  };

  return (
    <div class={`reader theme-${st.readerTheme} font-${st.readerFont}`} style={{ '--rs': st.readerSize + 'px' }}>
      <header class={'reader-bar' + (chrome ? '' : ' hidden')}>
        <button class="icon-btn" onClick={() => nav.back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <div class="reader-title">
          <b>{book.title}</b>
          <span>{book.author}</span>
        </div>
        <button class="icon-btn" onClick={() => setPanel(panel === 'listen' ? null : 'listen')} aria-label="Listen">
          <Icon name="headphones" />
        </button>
        <button class="icon-btn" onClick={() => setPanel(panel === 'toc' ? null : 'toc')} aria-label="Contents">
          <Icon name="list" />
        </button>
        <button class="icon-btn" onClick={() => setPanel(panel === 'style' ? null : 'style')} aria-label="Text settings">
          <Icon name="text" />
        </button>
      </header>

      <div
        class="reader-scroll"
        ref={scroller}
        onClick={(e) => {
          if (e.target.closest('a')) return;
          if (aloud) {
            const i = speakBlocks().findIndex((b) => b.contains(e.target));
            if (i >= 0) return startAloud(i);
          }
          const x = e.clientX / window.innerWidth;
          if (x < 0.22) page(-1);
          else if (x > 0.78) page(1);
          else setChrome(!chrome);
          setPanel(null);
        }}
      >
        {error ? (
          <div class="reader-msg">
            <p>Couldn't open this book: {error}</p>
            {book.link && (
              <a class="btn primary" href={book.link} target="_blank" rel="noopener">
                Open on the web
              </a>
            )}
          </div>
        ) : !doc ? (
          <div class="reader-msg">
            <span class="spinner" />
            <p>Opening {book.title}…</p>
          </div>
        ) : (
          <article class="reader-text" dangerouslySetInnerHTML={{ __html: doc.html }} />
        )}
      </div>

      <footer class={'reader-foot' + (chrome ? '' : ' hidden')}>
        <div class="progress-bar">
          <div style={{ width: pct * 100 + '%' }} />
        </div>
        <span>{Math.round(pct * 100)}%</span>
      </footer>

      {panel === 'listen' && doc && (
        <div class="reader-panel">
          <h3>Listen to this book</h3>
          {canNarrate() && !nativeReader && (
            <button class="listen-opt ai" disabled={!!aiBusy} onClick={listenAsAudiobook}>
              {aiBusy ? <span class="spinner" /> : <Icon name="headphones" size={18} />}
              <div>
                <b>Listen as an audiobook</b>
                <small>
                  Plays in the audiobook player — chapters, speed, sleep timer & lock screen · ~
                  {(() => {
                    const m = estimate(paragraphs(doc.html)).minutes;
                    return m >= 60 ? `${Math.round(m / 60)} h` : `${m} min`;
                  })()}
                </small>
              </div>
            </button>
          )}
          <button
            class="listen-opt"
            onClick={() => {
              setPanel(null);
              startAloud();
            }}
          >
            <Icon name="book" size={18} />
            <div>
              <b>{nativeReader ? 'Listen' : 'Read along here'}</b>
              <small>
                {nativeReader
                  ? 'Natural voice · keeps going with the screen off or the app closed · highlights as it reads'
                  : "Highlights each paragraph as it's spoken · tap any paragraph to jump"}
              </small>
            </div>
          </button>
          <p class="muted small-note">Choose or download a voice in Settings → Voices.</p>
        </div>
      )}
      {aloud && (
        <div class="aloud-bar">
          <button class="icon-btn" onClick={() => startAloud(Math.max(0, aloud.index - 1))} aria-label="Previous paragraph">
            <Icon name="prev" size={20} />
          </button>
          <button class="play-btn small" onClick={() => (aloud.playing ? pauseAloud() : playAloud(aloud.index))} aria-label={aloud.playing ? 'Pause' : 'Play'}>
            <Icon name={aloud.playing ? 'pause' : 'play'} size={20} />
          </button>
          <button class="icon-btn" onClick={() => startAloud(aloud.index + 1)} aria-label="Next paragraph">
            <Icon name="next" size={20} />
          </button>
          <span class="aloud-label">{nativeReader ? 'Keeps reading with the screen off · tap a paragraph to jump' : 'Reading along · tap any paragraph to jump'}</span>
          <button class="icon-btn" onClick={closeAloud} aria-label="Stop reading aloud">
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {panel === 'toc' && doc && (
        <div class="reader-panel">
          <h3>Contents</h3>
          <ol class="toc">
            {doc.headings.length ? (
              doc.headings.map((h) => (
                <li class={'lvl' + h.level}>
                  <button
                    onClick={() => {
                      const el = scroller.current.querySelector('#' + CSS.escape(h.id));
                      el?.scrollIntoView({ behavior: 'smooth' });
                      setPanel(null);
                    }}
                  >
                    {h.text}
                  </button>
                </li>
              ))
            ) : (
              <li class="muted">No chapter headings in this edition.</li>
            )}
          </ol>
        </div>
      )}
      {panel === 'style' && (
        <div class="reader-panel">
          <h3>Text</h3>
          <div class="reader-row">
            <button class="pill" onClick={() => settings.patch({ readerSize: Math.max(13, st.readerSize - 1) })}>
              A−
            </button>
            <span>{st.readerSize}px</span>
            <button class="pill" onClick={() => settings.patch({ readerSize: Math.min(32, st.readerSize + 1) })}>
              A+
            </button>
          </div>
          <div class="reader-row">
            {['serif', 'sans'].map((f) => (
              <button class={'pill' + (st.readerFont === f ? ' active' : '')} onClick={() => settings.patch({ readerFont: f })}>
                {f === 'serif' ? 'Serif' : 'Sans'}
              </button>
            ))}
          </div>
          <label class="reader-toggle">
            <input type="checkbox" checked={st.skipFrontMatter !== false} onChange={(e) => settings.patch({ skipFrontMatter: e.currentTarget.checked })} />
            <span>
              <b>Skip contents & index</b>
              <small>When reading aloud or making an audiobook</small>
            </span>
          </label>
          <div class="reader-row themes">
            {THEMES.map(([k, label]) => (
              <button class={`theme-swatch t-${k}` + (st.readerTheme === k ? ' active' : '')} onClick={() => settings.patch({ readerTheme: k })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
