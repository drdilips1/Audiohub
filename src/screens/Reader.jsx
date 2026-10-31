import { pendingFor, clearPending, findQuoteBlock } from '../lib/quoteshare.js';
import { sameWork } from '../lib/works.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../components/icons.jsx';
import { gb } from '../sources/index.js';
import { loadSummary } from '../sources/summaries.js';
import { loadStoryShots } from '../sources/storyshots.js';
import { isCloudEbook, loadCloudEbook } from '../lib/epub.js';
import { progress, settings, summarize, useStore } from '../lib/store.js';
import { nav, useBackClose } from '../lib/nav.js';
import { readAloud, attachAloud } from '../lib/readaloud.js';
import { dragSelect } from '../lib/dragselect.js';
import { trCfg, LANGS, lang, voiceFor, bookTranslation, translateParas } from '../lib/translate.js';
import { paragraphs, estimate, textBlocks, isSkippable, skipFrontMatter, nativeReader, ttsCfg, voiceSpec, speakable, blockText, Reader as ReadAloudNative } from '../lib/tts.js';
import { VoicesCard } from './settings-extra.jsx';
import { narrate, canNarrate } from '../sources/ttsbooks.js';
import * as player from '../lib/player.js';
import { toast } from '../components/common.jsx';
import { HighlightCards, AudioNotes, hasAudioNotes } from '../components/book-notes.jsx';
import { highlights, forWork, addHighlight, updateHighlight, removeHighlight, markText, unmark, selectionParts, growSelection } from '../lib/highlights.js';
import { SelectionBar, AiSheet, HighlightSheet } from '../components/reader-select.jsx';
import { FollowAudio } from '../components/follow-audio.jsx';

// Reading fonts (bundled, so they work offline). Literata is the default serif.
const FONTS = [
  ['serif', 'Literata'],
  ['georgia', 'Classic serif'],
  ['lora', 'Lora'],
  ['sans', 'Sans'],
  ['atkinson', 'Atkinson (easy to read)'],
  ['dyslexic', 'OpenDyslexic'],
];
const LINES = [
  [1.45, 'Tight'],
  [1.72, 'Normal'],
  [1.95, 'Relaxed'],
  [2.25, 'Loose'],
];
const MARGINS = [
  [12, 'Narrow'],
  [24, 'Normal'],
  [44, 'Wide'],
];

const THEMES = [
  ['night', 'Night'],
  ['amoled', 'Black'],
  ['sepia', 'Sepia'],
  ['paper', 'Paper'],
];

/** A reader panel's title with its Close button. */
function PanelHead({ title, onClose }) {
  return (
    <div class="sel-sheet-head">
      <h3>{title}</h3>
      <button class="link-btn" onClick={onClose}>
        Close
      </button>
    </div>
  );
}


export function Reader({ book, readAloud: autoAloud, at = null }) {
  const st = useStore(settings);
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState(null); // 'toc' | 'style'
  const [pct, setPct] = useState(0);
  const scroller = useRef();
  const [aloud, setAloud] = useState(null); // { playing, index }
  // Reading stats: time with the book open and in use (a touch or scroll in the last two
  // minutes), or being read aloud — not a book left open on the table.
  const aloudOn = useRef(false);
  aloudOn.current = !!aloud?.playing;
  useEffect(() => {
    let lastUse = Date.now();
    const used = () => (lastUse = Date.now());
    const el = scroller.current;
    el?.addEventListener('scroll', used, { passive: true });
    el?.addEventListener('touchstart', used, { passive: true });
    const iv = setInterval(() => {
      if (document.hidden) return;
      if (aloudOn.current || Date.now() - lastUse < 120e3) import('../lib/stats.js').then((m) => m.readTick(book, 10));
    }, 10e3);
    return () => {
      clearInterval(iv);
      el?.removeEventListener('scroll', used);
      el?.removeEventListener('touchstart', used);
    };
  }, [book.uid, !!doc]);
  const ctl = useRef(null);
  const [aiBusy, setAiBusy] = useState('');
  // Selected words (long-press) → the action bar; sheet = AI answer or a highlight's note.
  const [sel, setSel] = useState(null);
  const [sheet, setSheet] = useState(null);
  // Back closes what's open (answer sheet, panel, selection bar) before leaving the book.
  useBackClose(!!sheet, () => setSheet(null));
  useBackClose(!!panel, () => setPanel(null));
  useBackClose(!!sel && !sheet, () => {
    window.getSelection()?.removeAllRanges();
    setSel(null);
  });
  // PDFs: the original pages (Pages) or the reflowed text (Text). The page view's
  // code loads only when it's first opened.
  const [pages, setPages] = useState(false);
  const [PagesView, setPagesView] = useState(null);
  const showPages = async (on) => {
    if (on && !PagesView) {
      const m = await import('../components/pdf-pages.jsx');
      setPagesView(() => m.PdfPages);
    }
    setPages(on);
    setPanel(null);
  };
  const savePage = (n, total) =>
    progress.set((all) => ({
      ...all,
      [book.uid]: { ...(all[book.uid] || {}), hidden: false, kind: 'text', pdfPage: n, percent: n / total, finished: n >= total, updatedAt: Date.now(), book: summarize(book) },
    }));

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
      if (trRef.current) keepAhead(el);
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

  // ---- the book in another language: translated as you read (and kept) --------------
  const tr = useStore(trCfg);
  const trTo = tr.books?.[book.uid] || null;
  const trRef = useRef(null); // { to, store } while the book is shown translated
  const originals = useRef(new Map()); // paragraph -> its original HTML
  const trBusy = useRef(new Set());
  const aloudEls = useRef([]);
  const [trWorking, setTrWorking] = useState(false);
  const showTr = (el, text) => {
    if (!originals.current.has(el)) originals.current.set(el, el.innerHTML);
    el.textContent = text;
    el.classList.add('translated');
  };
  const restoreOriginals = () => {
    for (const [el, html] of originals.current) {
      el.innerHTML = html;
      el.classList.remove('translated');
    }
    originals.current.clear();
  };
  /** Translate paragraphs [from, from + n) of the page (those not done yet); returns the new ones. */
  const translateRange = async (from, n) => {
    const t = trRef.current;
    if (!t) return [];
    await t.store.loaded;
    if (trRef.current !== t) return [];
    const list = blocks();
    const need = [];
    for (let i = Math.max(0, from); i < Math.min(list.length, from + n); i++) {
      const done = t.store.get(i);
      if (done) !list[i].classList.contains('translated') && showTr(list[i], done);
      else if (!trBusy.current.has(i) && speakable(list[i].textContent)) need.push(i);
    }
    const added = [];
    while (need.length) {
      // About a page per request: up to 8 paragraphs or 3,000 characters.
      const batch = [];
      let size = 0;
      while (need.length && batch.length < 8 && (size < 3000 || !batch.length)) {
        const i = need.shift();
        batch.push(i);
        size += list[i].textContent.length;
      }
      batch.forEach((i) => trBusy.current.add(i));
      setTrWorking(true);
      try {
        const out = await translateParas(batch.map((i) => list[i].textContent), t.to);
        batch.forEach((i, k) => {
          if (!out[k]) return;
          t.store.set(i, out[k]);
          if (trRef.current === t) {
            showTr(list[i], out[k]);
            added.push(i);
          }
        });
      } catch (e) {
        toast(e.message);
        break;
      } finally {
        batch.forEach((i) => trBusy.current.delete(i));
        setTrWorking(trBusy.current.size > 0);
      }
    }
    return added;
  };
  // On / off / another language: show the translation of what's on screen, or the original.
  useEffect(() => {
    if (!doc) return;
    restoreOriginals();
    trRef.current = trTo ? { to: trTo, store: bookTranslation(book.uid, trTo) } : null;
    if (!trTo) return void requestAnimationFrame(markAll);
    const el = scroller.current;
    let t;
    const onScroll = () => {
      clearTimeout(t);
      t = setTimeout(() => translateRange(Math.max(0, topBlock() - 1), 10), 400);
    };
    translateRange(Math.max(0, topBlock() - 1), 10);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(t);
      el.removeEventListener('scroll', onScroll);
    };
  }, [doc, trTo]);
  // Reading aloud translated: keep about 20 paragraphs ahead translated, and hand the
  // new ones to the voice as they come.
  const keepAhead = (el) => {
    const bi = blocks().indexOf(el);
    if (bi < 0) return;
    translateRange(bi, 20).then((added) => {
      if (!added.length || !ctl.current?.native) return;
      const els = aloudEls.current;
      const paras = added.map((i) => ({ i: els.indexOf(blocks()[i]), t: blockText(blocks()[i]) })).filter((p) => p.i >= 0);
      if (paras.length) ReadAloudNative.addParas({ paras }).catch(() => {});
    });
  };
  const startTranslatedAloud = async (els, from, all) => {
    lit.current?.classList.remove('aloud');
    els[from].classList.add('aloud');
    lit.current = els[from];
    ctl.current?.stop();
    player.pause();
    aloudAll.current = all;
    aloudEls.current = els;
    setAloud({ playing: true, index: from });
    await translateRange(blocks().indexOf(els[from]), 8);
    if (!trRef.current) return;
    const paras = els.map((el) => (el.classList.contains('translated') ? blockText(el) : ''));
    ctl.current = readAloud(els, from, aloudHandlers(), { uid: book.uid, title: book.title, paras, voice: { ...voiceSpec(), engine: 'edge', edgeVoice: voiceFor(trRef.current.to) } });
  };

  // `all`: read from every paragraph, contents / preface included (a tap or chapter there).
  const aloudAll = useRef(false);
  const startAloud = (from, all = false, restart = false) => {
    const els = all ? blocks() : speakBlocks();
    if (!els.length) return;
    // start at the first paragraph visible on screen
    if (from == null) from = Math.max(0, firstVisible(els));
    from = Math.min(Math.max(0, from), els.length - 1);
    if (trRef.current) return startTranslatedAloud(els, from, all);
    // Show the jump straight away (the voice follows within a moment).
    if (els[from]) {
      lit.current?.classList.remove('aloud');
      els[from].classList.add('aloud');
      lit.current = els[from];
    }
    // Native engine already reading this book (same list of paragraphs): just move.
    if (ctl.current?.native && aloudAll.current === all && !restart && !trRef.current) {
      ctl.current.seek(from);
      ctl.current.resume();
      setAloud({ playing: true, index: from });
      return;
    }
    ctl.current?.stop();
    player.pause();
    aloudAll.current = all;
    setAloud({ playing: true, index: from });
    ctl.current = readAloud(els, from, aloudHandlers(), { uid: book.uid, title: book.title });
  };
  const pauseAloud = () => {
    if (ctl.current?.native) ctl.current.pause();
    else ctl.current?.stop();
    setAloud((a) => a && { ...a, playing: false });
  };
  /** Read from this element (a tapped paragraph or a chapter), even in skipped front matter. */
  const readFrom = (el) => {
    const all = blocks();
    const target = all.find((b) => b === el || el.contains(b) || el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!target) return;
    const i = speakBlocks().indexOf(target);
    if (i >= 0) startAloud(i);
    else startAloud(all.indexOf(target), true);
  };
  // A different voice picked while reading: carry on in it from the same paragraph.
  const voiceCfg = useStore(ttsCfg);
  const voiceRate = voiceCfg.rate || 1;
  const voice = JSON.stringify(voiceSpec(voiceCfg));
  const lastVoice = useRef(voice);
  useEffect(() => {
    if (voice === lastVoice.current) return;
    lastVoice.current = voice;
    if (aloud?.playing) startAloud(aloud.index, aloudAll.current, true);
  }, [voice]);
  const playAloud = (i) => {
    if (ctl.current?.native) {
      ctl.current.resume();
      setAloud((a) => a && { ...a, playing: true });
    } else startAloud(i, aloudAll.current);
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
    (book.source === 'sum' ? loadSummary(book) : book.source === 'ss' ? loadStoryShots(book) : isCloudEbook(book) ? loadCloudEbook(book) : gb.loadText(book))
      .then((d) => alive && setDoc(d))
      .catch((e) => {
        // Not a book file after all: don't offer it again.
        if (/isn't a readable|not a readable|unsupported|corrupt/i.test(e.message || '')) import('../lib/epub.js').then((m) => m.markBadEbook(book.uid));
        if (alive) setError(e.message);
      });
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
    // A scanned PDF has no text to reflow: show its pages.
    if (doc.pdf?.scanned) showPages(true);
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
      // A shared quote waiting for this book: open at its paragraph (any edition: found by its words).
      const shared = at == null ? pendingFor(book) : null;
      const sharedAt = shared?.kind === 'text' ? findQuoteBlock(blocks(), shared.quote) : -1;
      if (shared) {
        clearPending();
        toast(sharedAt >= 0 ? 'Opened at the shared quote' : "Couldn't find the shared quote in this edition");
      }
      const target = sharedAt >= 0 ? blocks()[sharedAt] : at != null ? blocks()[at] : saved?.anchor >= 0 ? blocks()[saved.anchor] : null;
      if (target) {
        target.scrollIntoView({ block: 'start' });
        el.scrollTop -= 70;
      } else if (saved?.percent) el.scrollTop = saved.percent * (el.scrollHeight - el.clientHeight);
    });
  }, [doc]);

  // Show this book's highlights in the text.
  const markAll = () => {
    const root = scroller.current?.querySelector('.reader-text');
    if (!root) return;
    unmark(root);
    const list = blocks();
    const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    for (const h of forWork(book, sameWork))
      for (const p of h.parts) {
        // Its paragraph first; else wherever its words are (another copy or edition).
        if (!h.elsewhere && markText(list[p.a], p.t, h.id)) continue;
        const words = norm(p.t);
        const at = words.length > 12 ? list.findIndex((b) => norm(b.textContent).includes(words)) : -1;
        if (at >= 0) markText(list[at], p.t, h.id);
        else if (h.elsewhere) markText(list[p.a], p.t, h.id);
      }
  };
  useEffect(() => {
    if (!doc) return;
    requestAnimationFrame(markAll);
    // A note edited or a highlight removed in the Notes panel (or synced in): redraw the marks.
    return highlights.subscribe(() => requestAnimationFrame(markAll));
  }, [doc]);

  // Long-press selection → the action bar (after the selection settles).
  useEffect(() => {
    if (!doc) return;
    let t;
    const onSel = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = window.getSelection();
        const root = scroller.current?.querySelector('.reader-text');
        if (!s || s.isCollapsed || !s.rangeCount || !root || !root.contains(s.anchorNode)) return setSel(null);
        selAt.current = Date.now();
        const range = s.getRangeAt(0);
        const text = s.toString().trim();
        if (!text) return setSel(null);
        const parts = selectionParts(range, blocks());
        const context = parts.length ? blocks()[parts[0].a]?.textContent || text : text;
        setSel({ text, parts, context, rect: range.getBoundingClientRect(), range: range.cloneRange() });
      }, 250);
    };
    // Press, hold and slide to select (the bar shows once the finger lifts).
    let dragging = false;
    const off = dragSelect(scroller.current, '.reader-text', {
      onStart: () => {
        dragging = true;
        selAt.current = Date.now();
        setSel(null);
      },
      onDone: () => {
        dragging = false;
        selAt.current = Date.now();
        onSel();
      },
    });
    const onSelWhenFree = () => !dragging && onSel();
    document.addEventListener('selectionchange', onSelWhenFree);
    return () => {
      clearTimeout(t);
      off();
      document.removeEventListener('selectionchange', onSelWhenFree);
    };
  }, [doc]);

  const keepHighlight = (parts, note = '') => {
    if (!parts?.length) return;
    const h = addHighlight(book, parts, note);
    const list = blocks();
    for (const p of h.parts) markText(list[p.a], p.t, h.id);
    window.getSelection()?.removeAllRanges();
    setSel(null);
    toast(note ? 'Highlighted with a note' : 'Highlighted');
  };
  const onSelAction = (kind) => {
    const s = sel;
    if (!s) return;
    if (kind === 'highlight') return keepHighlight(s.parts);
    window.getSelection()?.removeAllRanges();
    setSel(null);
    setPanel(null);
    setSheet({ type: 'ai', kind, text: s.text, context: s.context, parts: s.parts });
  };

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

  const selAt = useRef(0); // when words were last selected: a tap then isn't a page turn
  const selecting = () => Date.now() - selAt.current < 900 || !(window.getSelection()?.isCollapsed ?? true);
  const lastTap = useRef(null);
  const tapTimer = useRef(null);
  const downAt = useRef(null);
  const doubleAt = useRef(0);
  const page = (dir) => {
    const el = scroller.current;
    el.scrollBy({ top: dir * (el.clientHeight - 60), behavior: 'smooth' });
  };

  return (
    <div
      class={`reader theme-${st.readerTheme} font-${st.readerFont}${st.readerJustify === false ? ' nojustify' : ''}`}
      style={{ '--rs': st.readerSize + 'px', '--rl': st.readerLine || 1.72, '--rm': (st.readerMargin ?? 24) + 'px' }}
    >
      <header class={'reader-bar' + (chrome ? '' : ' hidden')}>
        <button class="icon-btn" onClick={() => nav.back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <div class="reader-title">
          <b>{book.title}</b>
          <span>{book.author}</span>
        </div>
        {doc?.pdf && (
          <button class="pill small pdf-mode" onClick={() => showPages(!pages)} aria-label={pages ? 'Show as text' : 'Show the original pages'}>
            {pages ? 'Text' : 'Pages'}
          </button>
        )}
        <button
          class={'icon-btn' + (aloud ? ' on' : '')}
          onClick={() => (aloud ? setPanel(panel === 'listen' ? null : 'listen') : (setPanel(null), startAloud()))}
          aria-label={aloud ? 'Voice' : 'Read aloud'}
        >
          <Icon name="headphones" />
        </button>
        <button class="icon-btn" onClick={() => setPanel(panel === 'notes' ? null : 'notes')} aria-label="This book's notes">
          <Icon name="edit" />
        </button>
        <button class="icon-btn" onClick={() => setPanel(panel === 'toc' ? null : 'toc')} aria-label="Contents">
          <Icon name="list" />
        </button>
        <button class="icon-btn" onClick={() => setPanel(panel === 'style' ? null : 'style')} aria-label="Text settings">
          <Icon name="text" />
        </button>
      </header>

      {pages && PagesView && doc?.bytes && (
        <PagesView bytes={doc.bytes} startPage={progress.get()[book.uid]?.pdfPage || 1} onPage={savePage} />
      )}
      <div
        class="reader-scroll"
        style={pages ? { display: 'none' } : null}
        ref={scroller}
        // Double tap on a paragraph: read aloud from there. Detected from the touches
        // themselves: on phones the second tap of a double tap often selects a word
        // instead of producing a click.
        onPointerDown={(e) => (downAt.current = { t: Date.now(), x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const d = downAt.current;
          if (!d || Date.now() - d.t > 350 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 20) return; // a scroll or a long press
          if (selecting()) return (lastTap.current = null); // moving the selection handles
          const now = Date.now();
          const prev = lastTap.current;
          lastTap.current = { at: now, x: e.clientX, y: e.clientY };
          if (!prev || now - prev.at > 400 || Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 50) return;
          lastTap.current = null;
          const x = e.clientX / window.innerWidth;
          if (!aloud && (x < 0.22 || x > 0.78)) return; // double tap at the edges: just page turns
          const block = blocks().find((b) => b.contains(e.target));
          if (!block) return;
          clearTimeout(tapTimer.current);
          doubleAt.current = now;
          setTimeout(() => {
            window.getSelection()?.removeAllRanges();
            setSel(null);
          }, 300);
          readFrom(block);
        }}
        onClick={(e) => {
          if (e.target.closest('a')) return;
          if (Date.now() - doubleAt.current < 500) return; // the second tap of a double tap
          // Finishing or adjusting a selection (or tapping it away): not a page turn.
          if (sel || selecting()) return;
          const mark = e.target.closest('mark.hl');
          if (mark) {
            const h = forWork(book, sameWork).find((x) => x.id === mark.dataset.id);
            if (h) return setSheet({ type: 'hl', h });
          }
          const x = e.clientX / window.innerWidth;
          const tap = () => {
            if (x < 0.22) page(-1);
            else if (x > 0.78) page(1);
            else setChrome((c) => !c);
            setPanel(null);
          };
          // Reading aloud: a tap shows / hides the bars, after a moment in case it is
          // the first tap of a double tap (handled above).
          if (!aloud) return tap();
          clearTimeout(tapTimer.current);
          tapTimer.current = setTimeout(tap, 380);
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

      {doc && !error && <FollowAudio book={book} blocks={blocks} scroller={scroller} ready={!!doc} />}
      {sel && !sheet && <SelectionBar sel={sel} onAction={onSelAction} onGrow={(kind) => growSelection(kind, blocks(), sel.range) || toast('Nothing more to add')} />}
      {sheet?.type === 'ai' && (
        <AiSheet
          kind={sheet.kind}
          text={sheet.text}
          context={sheet.context}
          book={book}
          onClose={() => setSheet(null)}
          onKeep={(answer) => {
            keepHighlight(sheet.parts, answer);
            setSheet(null);
          }}
        />
      )}
      {sheet?.type === 'hl' && (
        <HighlightSheet
          h={sheet.h}
          onClose={() => setSheet(null)}
          onSave={(note) => {
            updateHighlight(sheet.h.home || book.uid, sheet.h.id, { note });
            setSheet(null);
            toast(note ? 'Note saved' : 'Saved');
          }}
          onRemove={() => {
            removeHighlight(sheet.h.home || book.uid, sheet.h.id);
            const root = scroller.current?.querySelector('.reader-text');
            if (root) unmark(root, sheet.h.id);
            setSheet(null);
          }}
          onAi={() => setSheet({ type: 'ai', kind: 'explain', text: sheet.h.text, context: sheet.h.text, parts: sheet.h.parts })}
        />
      )}
      {panel === 'listen' && doc && (
        <div class="reader-panel voice-panel">
          <PanelHead title="Voice" onClose={() => setPanel(null)} />
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
          <VoicesCard />
        </div>
      )}
      {aloud && (
        <div class="aloud-bar">
          <button class="icon-btn" onClick={() => startAloud(Math.max(0, aloud.index - 1), aloudAll.current)} aria-label="Previous paragraph">
            <Icon name="prev" size={20} />
          </button>
          <button class="play-btn small" onClick={() => (aloud.playing ? pauseAloud() : playAloud(aloud.index))} aria-label={aloud.playing ? 'Pause' : 'Play'}>
            <Icon name={aloud.playing ? 'pause' : 'play'} size={20} />
          </button>
          <button class="icon-btn" onClick={() => startAloud(aloud.index + 1, aloudAll.current)} aria-label="Next paragraph">
            <Icon name="next" size={20} />
          </button>
          <button
            class="pill small aloud-rate"
            aria-label="Reading speed"
            onClick={() => {
              const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
              const cur = ttsCfg.get().rate || 1;
              const next = SPEEDS[(SPEEDS.findIndex((r) => r >= cur - 0.001) + 1) % SPEEDS.length];
              ttsCfg.patch({ rate: next });
              if (ctl.current?.native) ctl.current.setRate(next); // reading now: faster at once
            }}
          >
            {+voiceRate.toFixed(2)}×
          </button>
          <span class="aloud-label">{nativeReader ? 'Keeps reading with the screen off · double-tap a paragraph to read from there' : 'Double-tap a paragraph to read from there'}</span>
          <button class="icon-btn" onClick={() => setPanel(panel === 'listen' ? null : 'listen')} aria-label="Choose a voice">
            <Icon name="mic" size={18} />
          </button>
          <button class="icon-btn" onClick={closeAloud} aria-label="Stop reading aloud">
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {panel === 'toc' && doc && (
        <div class="reader-panel">
          <PanelHead title="Contents" onClose={() => setPanel(null)} />
          <ol class="toc">
            {doc.headings.length ? (
              doc.headings.map((h) => (
                <li class={'lvl' + h.level}>
                  <button
                    onClick={() => {
                      const el = scroller.current.querySelector('#' + CSS.escape(h.id));
                      el?.scrollIntoView({ behavior: 'smooth' });
                      setPanel(null);
                      // Reading aloud: the voice moves to the chapter too (preface etc. included).
                      if (aloud && el) readFrom(el);
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
      {panel === 'notes' && doc && (
        <div class="reader-panel book-notes">
          <PanelHead title="This book's notes" onClose={() => setPanel(null)} />
          <HighlightCards
            book={book}
            onOpen={(h) => {
              const m = scroller.current.querySelector(`mark.hl[data-id="${h.id}"]`) || blocks()[h.parts[0].a];
              m?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setPanel(null);
            }}
          />
          <AudioNotes book={book} onPlay={() => setPanel(null)} title="From the audiobook" />
          {!forWork(book, sameWork).length && !hasAudioNotes(book) && (
            <p class="muted">Press and hold on a word or drag across a passage, then tap Highlight. Your highlights and notes for this book — and bookmarks from its audiobook — show here.</p>
          )}
          <button class="link-btn" onClick={() => nav.push('notes')}>
            All highlights & notes
          </button>
        </div>
      )}
      {panel === 'style' && (
        <div class="reader-panel">
          <PanelHead title="Text" onClose={() => setPanel(null)} />
          <div class="reader-row">
            <button class="pill" onClick={() => settings.patch({ readerSize: Math.max(13, st.readerSize - 1) })}>
              A−
            </button>
            <span>{st.readerSize}px</span>
            <button class="pill" onClick={() => settings.patch({ readerSize: Math.min(32, st.readerSize + 1) })}>
              A+
            </button>
          </div>
          <div class="reader-fonts">
            {FONTS.map(([f, label]) => (
              <button class={`font-opt font-${f}` + (st.readerFont === f ? ' active' : '')} onClick={() => settings.patch({ readerFont: f })}>
                {label}
              </button>
            ))}
          </div>
          <div class="reader-row labeled">
            <span>Line spacing</span>
            {LINES.map(([v, label]) => (
              <button class={'pill small' + (Math.abs((st.readerLine || 1.72) - v) < 0.01 ? ' active' : '')} onClick={() => settings.patch({ readerLine: v })}>
                {label}
              </button>
            ))}
          </div>
          <div class="reader-row labeled">
            <span>Margins</span>
            {MARGINS.map(([v, label]) => (
              <button class={'pill small' + ((st.readerMargin ?? 24) === v ? ' active' : '')} onClick={() => settings.patch({ readerMargin: v })}>
                {label}
              </button>
            ))}
          </div>
          <label class="reader-toggle">
            <input type="checkbox" checked={st.readerJustify !== false} onChange={(e) => settings.patch({ readerJustify: e.currentTarget.checked })} />
            <span>
              <b>Justify text</b>
              <small>Straight edges on both sides, with hyphenation</small>
            </span>
          </label>
          <label class="reader-toggle">
            <input type="checkbox" checked={st.skipFrontMatter !== false} onChange={(e) => settings.patch({ skipFrontMatter: e.currentTarget.checked })} />
            <span>
              <b>Skip contents & index</b>
              <small>When reading aloud or making an audiobook</small>
            </span>
          </label>
          <div class="reader-tr">
            <label class="reader-toggle">
              <input
                type="checkbox"
                checked={!!trTo}
                onChange={(e) => trCfg.set((c) => ({ ...c, books: { ...c.books, [book.uid]: e.currentTarget.checked ? c.to : undefined } }))}
              />
              <span>
                <b>Read this book in {lang(tr.to)[1]} {trWorking && <span class="spinner small" />}</b>
                <small>Translated by your AI as you read (and kept), read aloud in a natural {lang(tr.to)[1]} voice</small>
              </span>
            </label>
            <div class="tr-langs one-row">
              {LANGS.map(([code, name, own]) => (
                <button
                  class={'pill small' + (tr.to === code ? ' active' : '')}
                  onClick={() => trCfg.set((c) => ({ ...c, to: code, books: c.books[book.uid] ? { ...c.books, [book.uid]: code } : c.books }))}
                >
                  {own === name ? name : own}
                </button>
              ))}
            </div>
            <div class="reader-row labeled">
              <span>Voice</span>
              <button class={'pill small' + (!tr.male ? ' active' : '')} onClick={() => trCfg.patch({ male: false })}>
                Female
              </button>
              <button class={'pill small' + (tr.male ? ' active' : '')} onClick={() => trCfg.patch({ male: true })}>
                Male
              </button>
            </div>
          </div>
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
