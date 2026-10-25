import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon, SkipIcon } from './icons.jsx';
import { Cover, toast } from './common.jsx';
import { usePlayer } from './player-ui.jsx';
import * as player from '../lib/player.js';
import { nav } from '../lib/nav.js';
import { persisted, useStore } from '../lib/store.js';
import { aiReady } from '../lib/ai.js';
import { ask, threadFor, hearing } from '../lib/askbook.js';
import { mainTitle } from '../lib/match.js';
import { fmtTime } from '../lib/format.js';
import { canListen, listen, speakAnswer, stopAnswer, voiceLang } from '../lib/voiceask.js';

let pendingListen = false;
/** Open driving mode; `listenNow` starts listening for a question straight away ('scene': for a scene to play). */
export function openDrive(listenNow = false) {
  pendingListen = listenNow;
  nav.openOverlay('drive');
}

// After an answer, listen again for a follow-up (nothing said → the book carries on).
export const driveCfg = persisted('driveMode', { followUp: true });

/**
 * Driving mode: huge controls and one big "Ask" area — a single tap anywhere on it
 * pauses the book, listens, answers out loud (short), then the book carries on.
 * `listenNow` starts listening straight away (from the "Ask while driving" shortcut).
 */
export function DriveMode() {
  const s = usePlayer();
  const cfg = useStore(driveCfg);
  const lang = useStore(voiceLang);
  const [phase, setPhase] = useState('idle'); // idle | listening | thinking | speaking
  const [said, setSaid] = useState('');
  const [answer, setAnswer] = useState('');
  const alive = useRef(true);
  const resumeAfter = useRef(false);

  // Keep the screen on while driving.
  useEffect(() => {
    let lock = null;
    const grab = () => navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    grab();
    const onVis = () => document.visibilityState === 'visible' && grab();
    document.addEventListener('visibilitychange', onVis);
    if (pendingListen) setTimeout(() => (pendingListen === 'scene' ? sceneNow() : askNow()), 500);
    pendingListen = false;
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', onVis);
      lock?.release?.().catch(() => {});
      stopAnswer();
    };
  }, []);

  const carryOn = () => {
    setPhase('idle');
    if (resumeAfter.current && !player.getState().playing) player.toggle();
    resumeAfter.current = false;
  };

  // Voice command button in driving mode: a command, a book to play, or a question.
  const sceneNow = async (preset = '', playingBefore = null) => {
    if (!canListen() && !preset) return toast('Voice input is not available on this device');
    if (!aiReady()) return toast('Add an AI key in Settings → AI first');
    stopAnswer();
    const wasPlaying = playingBefore ?? player.getState().playing;
    if (wasPlaying) player.pause();
    let q = preset;
    if (!q) {
      setPhase('listening-scene');
      try {
        q = (await listen('Say a book or a command')).trim();
      } catch (e) {
        toast(e.message || 'Voice input failed');
      }
    }
    if (!alive.current) return;
    if (!q) {
      setPhase('idle');
      if (wasPlaying) player.toggle();
      return;
    }
    setSaid(q);
    setAnswer('');
    setPhase('scene');
    try {
      const { runCommand } = await import('../lib/voicecmd.js');
      const r = await runCommand(q, () => {});
      if (!alive.current) return;
      setPhase('idle');
      if (r.question || r.find) {
        // A question, or books to find: answered out loud here (short, for driving).
        setPhase('thinking');
        const book = r.find ? null : r.book;
        let a = '';
        try {
          a = await ask(book, q, { msgs: threadFor(book), description: book?.description || '', where: hearing(book), drive: true, voice: true });
        } catch (e) {
          a = e.message || "Sorry, I couldn't get an answer right now.";
        }
        if (!alive.current) return;
        setAnswer(a);
        setPhase('speaking');
        speakAnswer(a, () => {
          if (!alive.current) return;
          setPhase('idle');
          if (wasPlaying && !player.getState().playing) player.toggle();
        });
        return;
      }
      if (r.message) {
        // A control: the book carries on (unless you asked to pause).
        if (wasPlaying && r.action !== 'pause' && !player.getState().playing) player.toggle();
        toast(r.message);
      } else toast(`▶ ${r.scene || r.book.title}${r.where ? ` · ${r.where}` : ''}`);
    } catch (e) {
      if (!alive.current) return;
      setAnswer(e.message);
      setPhase('speaking');
      speakAnswer(e.message, () => {
        if (!alive.current) return;
        setPhase('idle');
        if (wasPlaying && !player.getState().playing) player.toggle();
      });
    }
  };

  const askNow = async (followUp = false) => {
    if (!canListen()) return toast('Voice input is not available on this device');
    if (!aiReady()) return toast('Add an AI key in Settings → AI first');
    stopAnswer();
    if (!followUp) resumeAfter.current = resumeAfter.current || player.getState().playing;
    if (player.getState().playing) player.pause();
    const book = player.getState().book;
    setPhase('listening');
    let q = '';
    try {
      q = (await listen(book ? `Ask about ${mainTitle(book.title)}` : 'Ask about your books')).trim();
    } catch (e) {
      toast(e.message || 'Voice input failed');
    }
    if (!alive.current) return;
    if (!q) return carryOn();
    // A command ("back 30 seconds", "play Sapiens"): done, not answered.
    const { isCommand } = await import('../lib/voicecmd.js');
    if (isCommand(q)) {
      const before = resumeAfter.current;
      resumeAfter.current = false;
      return sceneNow(q, before);
    }
    setSaid(q);
    setAnswer('');
    setPhase('thinking');
    let a = '';
    try {
      a = await ask(book, q, { msgs: threadFor(book), description: book?.description || '', where: hearing(book), drive: true });
    } catch (e) {
      a = e.message || "Sorry, I couldn't get an answer right now.";
    }
    if (!alive.current) return;
    setAnswer(a);
    setPhase('speaking');
    speakAnswer(a, () => {
      if (!alive.current) return;
      if (driveCfg.get().followUp) askNow(true);
      else carryOn();
    });
  };

  // One tap on the big area: ask; while listening/answering, a tap stops and the book carries on.
  const onBig = () => {
    if (phase === 'idle') return askNow();
    stopAnswer();
    carryOn();
  };

  const book = s.book;
  const ch = book ? player.chapters().find((c) => player.globalTime() >= c.start && player.globalTime() < (c.end || Infinity)) : null;
  const status = {
    idle: book ? 'Tap anywhere here to ask about this book' : 'Tap anywhere here to ask about your books',
    listening: 'Listening… ask your question',
    'listening-scene': 'Listening… which scene?',
    scene: 'Finding the scene…',
    thinking: 'Thinking…',
    speaking: 'Answering — tap to stop',
  }[phase];

  return (
    <div class="drive">
      <header class="drive-top">
        <button class="drive-exit" onClick={() => nav.closeOverlay()} aria-label="Exit driving mode">
          <Icon name="close" size={26} /> Exit
        </button>
        <div class="drive-now">
          {book ? (
            <>
              <Cover book={book} class="drive-cover" />
              <div>
                <b>{mainTitle(book.title)}</b>
                <small>{ch?.title ? `${ch.title} · ` : ''}{fmtTime(player.globalTime())}</small>
              </div>
            </>
          ) : (
            <div>
              <b>Nothing playing</b>
              <small>Start a book, or ask about your library</small>
            </div>
          )}
        </div>
      </header>

      {book && (
        <div class="drive-controls">
          <button onClick={() => player.skip(-30)} aria-label="Back 30 seconds">
            <SkipIcon seconds={30} size={56} />
          </button>
          <button class="drive-play" onClick={() => player.toggle()} aria-label={s.playing ? 'Pause' : 'Play'}>
            {s.loading ? <span class="spinner" /> : <Icon name={s.playing ? 'pause' : 'play'} size={64} />}
          </button>
          <button onClick={() => player.skip(30)} aria-label="Forward 30 seconds">
            <SkipIcon seconds={30} forward size={56} />
          </button>
        </div>
      )}

      <button class="drive-scene" disabled={phase !== 'idle'} onClick={() => sceneNow()}>
        🎙 <b>Voice command</b>
        <small>a book · “back 30 seconds” · “next chapter” · a question</small>
      </button>

      <button class={'drive-ask ' + phase} onClick={onBig} aria-label={status}>
        <span class="drive-mic">{phase === 'thinking' || phase === 'scene' ? <span class="spinner" /> : '🎙'}</span>
        <b>{status}</b>
        {said && phase !== 'idle' && <small class="drive-said">“{said}”</small>}
        {phase === 'idle' && <small class="drive-said">Commands work here too: “back 30 seconds”, “next chapter”, “play Sapiens”</small>}
        {answer && phase === 'speaking' && <p class="drive-answer">{answer.replace(/[*_#`]/g, '')}</p>}
      </button>

      <div class="drive-opts">
        <label>
          <input type="checkbox" class="switch" checked={cfg.followUp} onChange={(e) => driveCfg.set({ ...cfg, followUp: e.currentTarget.checked })} />
          Listen for a follow-up after each answer
        </label>
        <button class="drive-lang" onClick={() => voiceLang.set(lang === 'hi-IN' ? 'en-IN' : 'hi-IN')}>
          {lang === 'hi-IN' ? 'हिंदी' : 'English'}
        </button>
      </div>
    </div>
  );
}
