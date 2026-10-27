import { BgImage } from './bg-image.jsx';
import { wallpaperUrl, useCustomWallpaper } from '../lib/wallpaper.js';
import { loadImage } from '../lib/image.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import * as player from '../lib/player.js';
import { isNative as isNativeEngine } from '../lib/engine.js';
import { Cover, toast } from './common.jsx';
import { Icon, SkipIcon } from './icons.jsx';
import { fmtTime } from '../lib/format.js';
import { coverColor } from '../lib/color.js';
import { nav, useBackClose } from '../lib/nav.js';
import { bookmarks, settings, useStore } from '../lib/store.js';
import { openDrive } from './drive-mode.jsx';
import { COMPANION, rememberHere } from '../lib/askbook.js';
import { aiReady } from '../lib/ai.js';
import { TranscriptView } from './transcript-view.jsx';
import { StorySheet } from './story-sheet.jsx';
import { XrayStrip, XraySheet } from './xray.jsx';
import { SceneButton } from './scene-cmd.jsx';
import { Rows as BookmarkRows } from './bookmarks.jsx';
import { HighlightCards, AudioNotes, useBookNoteCount } from './book-notes.jsx';
import { transcriptCfg, stopTranscript } from '../lib/transcript.js';
import { sleepDetectAvailable, setSleepDetect } from '../lib/sleepdetect.js';

export function usePlayer() {
  const [s, setS] = useState(player.getState());
  useEffect(() => player.subscribe(setS), []);
  return s;
}

/** Just which book / part is playing and whether it plays: no redraw on every second of playback. */
export function usePlayerBasics() {
  const pick = (s) => ({ book: s.book ? { uid: s.book.uid } : null, playing: !!s.playing, index: s.index });
  const [v, setV] = useState(() => pick(player.getState()));
  useEffect(
    () =>
      player.subscribe((s) =>
        setV((cur) => (cur.book?.uid === s.book?.uid && cur.playing === !!s.playing && cur.index === s.index ? cur : pick(s)))
      ),
    []
  );
  return v;
}

export function useCoverColor(book) {
  const st = useStore(settings);
  const [c, setC] = useState(null);
  useEffect(() => {
    if (!book || !st.dynamicColor) return setC(null);
    let alive = true;
    loadImage(book.cover)
      .catch(() => '')
      .then((src) => coverColor(src, book.title))
      .then((col) => alive && setC(col));
    return () => (alive = false);
  }, [book?.cover, st.dynamicColor]);
  return c;
}

const prepPct = (st) => Math.max(0, Math.min(100, Math.round((st.progress || 0) * 100)));
const prepLabel = (st) => `${st.provider === 'realdebrid' ? 'Real-Debrid' : 'TorBox'} is downloading · ${prepPct(st)}%`;

function PrepBar({ st }) {
  const pct = prepPct(st);
  return (
    <div class="prep">
      <div class="prep-head">
        <span>{st.provider === 'realdebrid' ? 'Real-Debrid' : 'TorBox'} is still downloading this</span>
        <b>{pct}%</b>
      </div>
      <div class="prep-track">
        <div style={{ width: Math.max(pct, 2) + '%' }} />
      </div>
      <small>{st.state && !/download/i.test(st.state) ? `Status: ${st.state.replace(/_/g, ' ')} · ` : ''}Playback starts by itself when it's done — you can leave this screen.</small>
    </div>
  );
}

export function MiniPlayer() {
  const s = usePlayer();
  const color = useCoverColor(s.book);
  if (!s.book) return null;
  const pct = s.duration ? (s.time / s.duration) * 100 : 0;
  return (
    <div class="mini-player" style={color ? { '--dyn': color } : null} onClick={() => nav.openOverlay('player')}>
      <div class="mini-progress" style={{ width: pct + '%' }} />
      <Cover book={s.book} class="mini-cover" />
      <div class="mini-meta">
        <div class="mini-title">{s.book.title}</div>
        <div class="mini-sub">
          {s.preparing ? (
            <span class="prep-text">{prepLabel(s.preparing)}</span>
          ) : s.error ? (
            <span class="err">{s.error}</span>
          ) : s.loading && s.phase ? (
            <span class="prep-text">{s.phase}</span>
          ) : s.interrupted ? (
            <span class="prep-text">Paused for a call — tap play</span>
          ) : (
            s.tracks[s.index]?.title || s.book.author
          )}
        </div>
      </div>
      <button
        class="icon-btn"
        aria-label="Back"
        onClick={(e) => {
          e.stopPropagation();
          player.skip(-settings.get().skipBack);
        }}
      >
        <SkipIcon seconds={settings.get().skipBack} size={26} />
      </button>
      <button
        class="play-btn small"
        aria-label={s.playing ? 'Pause' : 'Play'}
        onClick={(e) => {
          e.stopPropagation();
          player.toggle();
        }}
      >
        {s.loading ? <span class="spinner" /> : <Icon name={s.playing ? 'pause' : 'play'} size={20} />}
      </button>
      <button
        class="icon-btn mini-close"
        aria-label="Close player"
        onClick={(e) => {
          e.stopPropagation();
          player.stop();
        }}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

const SPEEDS = [0.75, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.6, 1.7, 1.75, 1.8, 1.9, 2, 2.25, 2.5, 3];
const SLEEP = [5, 10, 15, 30, 45, 60, 90];

/** "Chapter 3 of 33 · The Mirror of Erised" (its own title when it says more than the number). */
function chapterLabel(chapters, g) {
  let i = chapters.findIndex((c) => g >= c.start && g < (c.end || Infinity));
  if (i < 0) i = 0;
  const t = String(chapters[i]?.title || '').trim();
  const plain = !t || /^(chapter|part|track)?\s*\d+$/i.test(t);
  return `Chapter ${i + 1} of ${chapters.length}${plain ? '' : ` · ${t}`}`;
}

export function FullPlayer() {
  const s = usePlayer();
  const st = useStore(settings);
  const bms = useStore(bookmarks)[s.book?.uid] || [];
  const noteCount = useBookNoteCount(s.book);
  const color = useCoverColor(s.book);
  const [sheet, setSheet] = useState(null); // 'chapters' | 'speed' | 'sleep' | 'bookmarks'
  // "Welcome back" offered once per book opening.
  const [awayDone, setAwayDone] = useState(false);
  useEffect(() => setAwayDone(false), [s.book?.uid]);
  useBackClose(!!sheet, () => setSheet(null));
  const [scrub, setScrub] = useState(null);
  const [, tick] = useState(0);
  const [drag, setDrag] = useState(0);
  const touch = useRef(null);
  useEffect(() => {
    if (!s.sleepUntil) return;
    const iv = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, [s.sleepUntil]);
  if (!s.book) return null;
  const dur = s.duration || s.tracks[s.index]?.duration || 0;
  const t = scrub ?? s.time;
  const chapters = player.chapters();
  const g = player.globalTime();
  const total = player.totalDuration();
  const showText = useStore(transcriptCfg).open;
  const sleepLeft = s.sleepUntil ? Math.max(0, (s.sleepUntil - Date.now()) / 1000) : 0;

  return (
    <div
      class="full-player"
      style={{ ...(color ? { '--dyn': color } : {}), transform: drag ? `translateY(${drag}px)` : undefined, transition: drag ? 'none' : undefined }}
      onTouchStart={(e) => {
        if (e.target.closest('input,.sheet,.transcript')) return;
        touch.current = e.touches[0].clientY;
      }}
      onTouchMove={(e) => {
        if (touch.current == null) return;
        setDrag(Math.max(0, e.touches[0].clientY - touch.current));
      }}
      onTouchEnd={() => {
        if (touch.current == null) return;
        touch.current = null;
        if (drag > 120) nav.closeOverlay();
        setDrag(0);
      }}
    >
      <PlayerBackground book={s.book} st={st} />
      <header class="fp-top">
        <button class="icon-btn" onClick={() => nav.closeOverlay()} aria-label="Close player">
          <Icon name="down" />
        </button>
        <div class="fp-top-title">
          <small>Now playing</small>
          <span>{s.book.title}</span>
        </div>
        <button
          class="icon-btn"
          onClick={() => {
            nav.closeOverlay();
            nav.push('book', { book: s.book });
          }}
          aria-label="Details"
        >
          <Icon name="list" />
        </button>
      </header>

      {showText ? (
        <TranscriptView s={s} />
      ) : (
        <div class={'fp-art' + (s.playing ? ' playing' : '')}>
          <Cover book={s.book} eager />
        </div>
      )}

      <div class="fp-meta">
        <h2>{s.tracks[s.index]?.title || s.book.title}</h2>
        <p>{s.book.author}</p>
        {/* Chapters: where you are, one tap to the list (used all the time, so not under More). */}
        {chapters.length > 1 && (
          <button class="fp-chapters" onClick={() => setSheet('chapters')}>
            <Icon name="list" size={16} />
            <span>{chapterLabel(chapters, g)}</span>
            <Icon name="chevron" size={14} />
          </button>
        )}
        {s.preparing && <PrepBar st={s.preparing} />}
        {s.interrupted && !s.loading && (
          <div class="loading-line">
            <div class="loading-head">
              <Icon name="pause" size={16} /> Paused — a call or another app is using the audio. Tap play to continue.
            </div>
          </div>
        )}
        {!s.preparing && !s.error && s.loading && (
          <div class="loading-line">
            <div class="loading-head">
              <span class="spinner small" /> {s.phase || 'Loading…'}
            </div>
            <div class="src-progress-track indeterminate">
              <div />
            </div>
          </div>
        )}
        {s.error && !s.preparing && <p class="err">{s.error}</p>}
      </div>

      <XrayStrip s={s} open={() => setSheet('xray')} />

      <div class="fp-scrub">
        <input
          type="range"
          min="0"
          max={dur || 1}
          step="0.5"
          value={t}
          style={{ '--pct': (dur ? (t / dur) * 100 : 0) + '%' }}
          onInput={(e) => setScrub(+e.currentTarget.value)}
          onChange={(e) => {
            player.seek(+e.currentTarget.value);
            setScrub(null);
          }}
        />
        <div class="fp-times">
          <span>{fmtTime(t)}</span>
          {total > dur + 1 && (
            <span class="fp-total">
              {Math.min(99, Math.round((g / total) * 100))}% of book · {s.rate && s.rate !== 1 ? `${fmtTime((total - g) / s.rate)} left at ${s.rate}×` : `${fmtTime(total - g)} left`}
            </span>
          )}
          <span>-{fmtTime(Math.max(0, dur - t))}</span>
        </div>
      </div>

      <div class="fp-controls">
        <button class="icon-btn lg" onClick={() => player.prev()} aria-label="Previous">
          <Icon name="prev" size={24} />
        </button>
        <button class="icon-btn lg" onClick={() => player.skip(-st.skipBack)} aria-label={`Back ${st.skipBack}s`}>
          <SkipIcon seconds={st.skipBack} size={36} />
        </button>
        <button class="play-btn big" onClick={() => player.toggle()} aria-label={s.playing ? 'Pause' : 'Play'}>
          {s.loading ? <span class="spinner" /> : <Icon name={s.playing ? 'pause' : 'play'} size={34} />}
        </button>
        <button class="icon-btn lg" onClick={() => player.skip(st.skipForward)} aria-label={`Forward ${st.skipForward}s`}>
          <SkipIcon seconds={st.skipForward} forward size={36} />
        </button>
        <button class="icon-btn lg" onClick={() => player.next()} aria-label="Next">
          <Icon name="next" size={24} />
        </button>
      </div>

      {s.awayDays > 0 && !awayDone && (
        <div class="welcome-back">
          <span>
            👋 Welcome back — {s.awayDays >= 60 ? `${Math.round(s.awayDays / 30)} months` : s.awayDays >= 21 ? `${Math.round(s.awayDays / 7)} weeks` : `${s.awayDays} days`} since you listened.
          </span>
          <button class="pill small" onClick={() => (setAwayDone(true), setSheet('recap'))}>
            Recap
          </button>
          <button class="icon-btn" aria-label="No thanks" onClick={() => setAwayDone(true)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      <Companion book={s.book} />

      {/* One row of the everyday buttons; the rest under More. */}
      <div class="fp-actions one-row">
        <button class="chip-btn" onClick={() => setSheet('speed')} aria-label="Speed">
          <b>{s.rate}×</b>
        </button>
        <button class={'chip-btn' + (s.sleepUntil || s.sleepEndOfTrack ? ' active' : '')} onClick={() => setSheet('sleep')} aria-label="Sleep timer">
          <Icon name="moon" size={16} />
          {s.sleepUntil ? ` ${fmtTime(sleepLeft)}` : s.sleepEndOfTrack ? ' Ch.' : ''}
        </button>
        <button
          class={'chip-btn' + (showText ? ' active' : '')}
          onClick={() => {
            if (showText) stopTranscript();
            transcriptCfg.set({ open: !showText });
          }}
          aria-label="Transcript"
        >
          <Icon name="text" size={16} /> Text
        </button>
        {s.book.source !== 'pod' && <SceneButton chip />}
        <button
          class="chip-btn"
          aria-label="Add a bookmark (hold for the list)"
          onClick={() => {
            const bm = player.addBookmark();
            toast('Bookmark added');
            // Named after what was being said (from the live transcript), when there is one.
            import('../lib/bookmarkname.js')
              .then((m) => m.nameBookmark(s.book, bm))
              .then((label) => label && toast(`🔖 ${label}`))
              .catch(() => {});
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setSheet('bookmarks');
          }}
        >
          <Icon name="bookmark" size={16} />
          {bms.length ? ` ${bms.length}` : ''}
        </button>
        <button class="chip-btn" onClick={() => setSheet('more')} aria-label="More">
          <Icon name="dots" size={18} stroke={3.5} />
        </button>
      </div>

      {sheet && (
        <div class="sheet-backdrop" onClick={() => setSheet(null)}>
          <div class="sheet" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-handle" />
            {sheet === 'story' && <StorySheet close={() => setSheet(null)} />}
            {sheet === 'recap' && <StorySheet close={() => setSheet(null)} start="story" />}
            {sheet === 'xray' && <XraySheet s={s} />}
            {sheet === 'more' && (
              <div class="fp-more">
                <button onClick={() => (setSheet(null), openDrive())}>
                  <Icon name="car" size={22} />
                  Drive
                </button>
                <button onClick={() => setSheet('xray')}>
                  <Icon name="xray" size={22} />
                  X-Ray
                </button>
                <button onClick={() => setSheet('story')}>
                  <Icon name="sparkle" size={22} />
                  Story
                </button>
                <button onClick={() => setSheet('chapters')}>
                  <Icon name="list" size={22} />
                  Chapters · {chapters.length}
                </button>
                <button onClick={() => setSheet('bookmarks')}>
                  <Icon name="bookmark" size={22} />
                  Notes · {noteCount}
                </button>
                <button
                  onClick={() => {
                    setSheet(null);
                    nav.closeOverlay();
                    player.stop();
                  }}
                >
                  <Icon name="close" size={22} />
                  Stop
                </button>
              </div>
            )}
            {sheet === 'speed' && (
              <>
                <h3>Playback speed</h3>
                {s.book.source !== 'pod' && <p class="muted small">Kept for this book (and the volume boost too); a new book starts with the last you used.</p>}
                <div class="speed-grid">
                  {SPEEDS.map((r) => (
                    <button class={'pill' + (r === s.rate ? ' active' : '')} onClick={() => player.setRate(r)}>
                      {r}×
                    </button>
                  ))}
                </div>
                <input type="range" min="0.5" max="3" step="0.05" value={s.rate} style={{ '--pct': ((s.rate - 0.5) / 2.5) * 100 + '%' }} onInput={(e) => player.setRate(+(+e.currentTarget.value).toFixed(2))} />
                {isNativeEngine && (
                  <>
                    <label class="set-row">
                      <div>
                        <b>Skip silence</b>
                        <small>Cuts the quiet gaps between sentences — saves minutes on chatty podcasts.</small>
                      </div>
                      <input type="checkbox" class="switch" checked={!!st.skipSilence} onChange={(e) => player.setAudio({ skipSilence: e.currentTarget.checked })} />
                    </label>
                    <div class="set-row">
                      <div>
                        <b>Volume boost</b>
                        <small>Makes quiet recordings louder.</small>
                      </div>
                    </div>
                    <div class="chips">
                      {[
                        [0, 'Off'],
                        [3, 'Low'],
                        [6, 'Medium'],
                        [10, 'High'],
                      ].map(([db, label]) => (
                        <button class={'pill small' + ((player.bookPrefs.get()[s.book.uid]?.boost ?? st.boost ?? 0) === db ? ' active' : '')} onClick={() => player.setAudio({ boost: db })}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            {sheet === 'sleep' && (
              <>
                <h3>Sleep timer</h3>
                {sleepDetectAvailable && (
                  <label class="set-row sleep-detect">
                    <div>
                      <b>Pause when I fall asleep</b>
                      <small>If the phone lies still for {(st.sleepDetect?.minutes || 15)} minutes, the book fades out, pauses and rewinds to where you stopped moving.</small>
                    </div>
                    <input type="checkbox" class="switch" checked={!!st.sleepDetect?.on} onChange={(e) => setSleepDetect({ on: e.currentTarget.checked })} />
                  </label>
                )}
                {sleepDetectAvailable && st.sleepDetect?.on && (
                  <div class="chips sleep-detect-min">
                    {[10, 15, 20, 30].map((m) => (
                      <button class={'pill small' + ((st.sleepDetect?.minutes || 15) === m ? ' active' : '')} onClick={() => setSleepDetect({ minutes: m })}>
                        Still {m} min
                      </button>
                    ))}
                  </div>
                )}
                <div class="speed-grid">
                  {SLEEP.map((m) => (
                    <button
                      class="pill"
                      onClick={() => {
                        player.setSleep(m);
                        setSheet(null);
                        toast(`Sleeping in ${m} minutes`);
                      }}
                    >
                      {m} min
                    </button>
                  ))}
                  <button
                    class={'pill' + (s.sleepEndOfTrack ? ' active' : '')}
                    onClick={() => {
                      player.setSleep('track');
                      setSheet(null);
                    }}
                  >
                    End of part
                  </button>
                  {(s.sleepUntil || s.sleepEndOfTrack) && (
                    <button
                      class="pill danger"
                      onClick={() => {
                        player.setSleep(null);
                        setSheet(null);
                      }}
                    >
                      Turn off
                    </button>
                  )}
                </div>
              </>
            )}
            {sheet === 'chapters' && (
              <>
                <h3>Chapters</h3>
                <ol class="chapter-list">
                  {chapters.map((c, i) => {
                    const active = g >= c.start && g < (c.end || Infinity) - 0.01;
                    return (
                      <li class={active ? 'active' : ''}>
                        <button
                          onClick={() => {
                            if (c.track != null) player.jumpTo(c.track);
                            else player.seekGlobal(c.start);
                            setSheet(null);
                          }}
                        >
                          <span class="ch-num">{i + 1}</span>
                          <span class="ch-title">{c.title}</span>
                          <span class="ch-time">{c.end > c.start ? (c.estimated ? '≈ ' : '') + fmtTime(c.end - c.start) : ''}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            {sheet === 'bookmarks' && (
              <div class="book-notes">
                <h3>This book's notes</h3>
                {noteCount === 0 && <p class="muted">Tap 🔖 to bookmark a moment, or long-press a line in the Text view to highlight it. Highlights from its ebook show here too.</p>}
                <BookmarkRows uid={s.book.uid} book={s.book} list={bms} onPlay={() => setSheet(null)} />
                <AudioNotes book={s.book} except={s.book.uid} onPlay={() => setSheet(null)} />
                <HighlightCards
                  book={s.book}
                  title="From the ebook"
                  onOpen={(h) => {
                    setSheet(null);
                    nav.closeOverlay();
                    nav.push('reader', { book: h.book, at: h.parts[0].a });
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Waveform({ playing }) {
  const ref = useRef();
  return (
    <span ref={ref} class={'eq' + (playing ? ' on' : '')}>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** The full player's backdrop, as chosen in Settings → Appearance. */
function PlayerBackground({ book, st }) {
  const kind = st.playerBg || 'cover';
  const custom = useCustomWallpaper(kind === 'photo');
  const dim = Math.max(0, Math.min(0.85, st.playerDim ?? 0.45));
  const wall = kind.startsWith('wall:') ? wallpaperUrl(kind.slice(5)) : kind === 'photo' ? custom : '';
  if (wall) {
    return (
      <div class="fp-bg fp-wall">
        <img src={wall} alt="" />
        <div class="fp-dim" style={{ background: `rgba(4, 3, 10, ${dim})` }} />
      </div>
    );
  }
  if (kind === 'living') {
    return (
      <div class="fp-bg fp-living">
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (kind === 'plain') return <div class="fp-bg fp-plain" />;
  return <div class="fp-bg">{book.cover && <BgImage url={book.cover} />}</div>;
}

/**
 * The AI companion while listening: Ask / Explain / Challenge / Rabbit hole / Related
 * about the part you're hearing (the book pauses; the mini player brings you back),
 * and Remember to keep the idea as a card.
 */
function Companion({ book }) {
  const [saving, setSaving] = useState(false);
  if (!book || book.source === 'pod') return null;
  const go = (question) => {
    if (!aiReady()) {
      toast('Add an AI key in Settings → AI first');
      return;
    }
    player.pause();
    nav.closeOverlay();
    nav.push('ask', { book, description: book.description || '', question, here: !!question, askId: question ? `${Date.now()}` : '' });
  };
  const remember = async () => {
    setSaving(true);
    player.addBookmark('Remembered idea');
    try {
      const card = await rememberHere(book);
      toast(`💾 Saved: ${card.text.slice(0, 90)}${card.text.length > 90 ? '…' : ''}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div class="fp-companion">
      <button class="comp-btn" onClick={() => go('')}>
        <Icon name="sparkle" size={19} />
        Ask
      </button>
      {COMPANION.map(([id, icon, label, q]) => (
        <button class="comp-btn" key={id} onClick={() => go(q)}>
          <Icon name={icon} size={19} />
          {label}
        </button>
      ))}
      <button class="comp-btn" disabled={saving} onClick={remember}>
        {saving ? <span class="spinner small" /> : <Icon name="pin" size={19} />}
        Remember
      </button>
    </div>
  );
}
