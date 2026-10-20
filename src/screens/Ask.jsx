import { useEffect, useRef, useState } from 'preact/hooks';
import { TopBar, Cover, toast } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { nav } from '../lib/nav.js';
import { aiReady } from '../lib/ai.js';
import { MODES, STARTERS, LIBRARY_ASKS, ask, quiz, threadFor, clearThread, hearing, ideas, forgetIdea } from '../lib/askbook.js';
import { keyIdeas, summaryBook } from '../sources/summaries.js';
import { mainTitle } from '../lib/match.js';
import { usePlayer } from '../components/player-ui.jsx';
import { useStore } from '../lib/store.js';
import * as player from '../lib/player.js';
import { canListen, listen, speakAnswer, stopAnswer, voiceLang, LANGS, askVoice, canPickVoice, ASK_VOICES, autoRead } from '../lib/voiceask.js';

/**
 * Ask AI about one book (params.book) or about your whole library (no book).
 * params: { book, description, genres, mode, question }
 */
export function Ask({ book = null, description = '', genres = [], mode: startMode = '', question = '', here = false }) {
  const [msgs, setMsgs] = useState(() => threadFor(book));
  const [mode, setMode] = useState(startMode);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const endRef = useRef(null);
  const ps = usePlayer();
  const lang = useStore(voiceLang);
  const voiceId = useStore(askVoice);
  const readAloud = useStore(autoRead);
  const [speaking, setSpeaking] = useState(-1); // index of the answer being read aloud
  const say = (i, t) => {
    stopAnswer();
    if (speaking === i) return setSpeaking(-1);
    setSpeaking(i);
    speakAnswer(t, () => setSpeaking((x) => (x === i ? -1 : x)));
  };
  useEffect(() => () => stopAnswer(), []);
  const where = hearing(book);
  const opts = { description, genres, mode };

  const scrollEnd = () => setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 60);
  const run = async (q, extra = {}) => {
    if (!q.trim() || busy) return;
    if (!aiReady()) {
      toast('Add a free AI key in Settings → AI first');
      return nav.tab('settings');
    }
    const shown = extra.where ? `🎧 ${q} (at ${extra.where.label})` : extra.voice ? `🎙 ${q}` : q;
    const before = msgs;
    setMsgs([...before, { role: 'user', text: shown }]);
    setText('');
    setBusy('ask');
    scrollEnd();
    try {
      const a = await ask(book, q, { ...opts, ...extra, msgs: before });
      setMsgs([...before, { role: 'user', text: shown }, { role: 'ai', text: a }]);
      // Answers are read aloud (always for spoken questions); the audiobook pauses meanwhile.
      if (extra.voice || autoRead.get()) {
        if (player.getState().playing) player.pause();
        say(before.length + 1, a);
      }
    } catch (e) {
      setMsgs([...before, { role: 'user', text: shown }, { role: 'ai', text: e.message, error: true }]);
    } finally {
      setBusy('');
      scrollEnd();
    }
  };
  const runQuiz = async () => {
    if (busy) return;
    if (!aiReady()) return nav.tab('settings');
    const before = msgs;
    setMsgs([...before, { role: 'user', text: 'Quiz me' }]);
    setBusy('quiz');
    scrollEnd();
    try {
      const qs = await quiz(book, { ...opts, msgs: before });
      setMsgs([...before, { role: 'user', text: 'Quiz me' }, { role: 'ai', text: '', quiz: qs }]);
    } catch (e) {
      setMsgs([...before, { role: 'user', text: 'Quiz me' }, { role: 'ai', text: e.message, error: true }]);
    } finally {
      setBusy('');
      scrollEnd();
    }
  };
  const makeBlinks = async () => {
    if (busy || !book) return;
    setBusy('blinks');
    try {
      await keyIdeas(book, { description });
      nav.push('reader', { book: summaryBook(book) });
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };
  const pick = (q) => (/^quiz me/i.test(q) ? runQuiz() : run(q));
  const voice = async () => {
    if (busy) return;
    stopAnswer();
    setSpeaking(-1);
    try {
      const heard = (await listen(book ? `Ask about ${mainTitle(book.title)}` : 'Ask about your books')).trim();
      if (heard) run(heard, { voice: true });
    } catch (e) {
      toast(e.message || 'Voice input failed');
    }
  };

  useEffect(() => {
    if (question) run(question, here && where ? { where } : {});
    else if (msgs.length) scrollEnd();
  }, []);

  const current = MODES.find((m) => m.id === mode);
  const title = book ? mainTitle(book.title) : 'Ask my books';
  return (
    <div class="screen ask">
      <TopBar
        ask={false}
        title={title}
        right={
          msgs.length > 0 && (
            <button
              class="icon-btn"
              aria-label="New conversation"
              onClick={() => {
                clearThread(book);
                setMsgs([]);
              }}
            >
              <Icon name="trash" size={18} />
            </button>
          )
        }
      />
      <div class="ask-hero pad">
        {book ? (
          <div class="ask-book">
            <Cover book={book} class="ask-cover" />
            <div>
              <small>✨ ASK AI</small>
              <b>{title}</b>
              {book.author && <span>{book.author}</span>}
            </div>
          </div>
        ) : (
          <div class="ask-book">
            <div class="ask-cover lib">📚</div>
            <div>
              <small>✨ ASK MY BOOKS</small>
              <b>Your whole library</b>
              <span>Themes, contradictions, what to read next</span>
            </div>
          </div>
        )}
        {canPickVoice && (
          <label class="ask-voice">
            🔊 Answer voice
            <select
              value={voiceId}
              onChange={(e) => {
                stopAnswer();
                setSpeaking(-1);
                askVoice.set(e.currentTarget.value);
              }}
            >
              <option value="">Same as Settings → Voices</option>
              {ASK_VOICES.map(([id, name, desc]) => (
                <option value={id}>
                  {name} — {desc}
                </option>
              ))}
            </select>
          </label>
        )}
        <label class="ask-voice ask-autoread">
          🔊 Read answers aloud
          <input type="checkbox" class="switch" checked={readAloud} onChange={(e) => (autoRead.set(e.currentTarget.checked), e.currentTarget.checked || (stopAnswer(), setSpeaking(-1)))} />
        </label>
        <p class="muted small ask-note">
          Answers use what the AI knows about {book ? 'the book' : 'your books'} and {book ? 'its description' : 'your listening history'} — it doesn't have the audio or text itself, and will say when it isn't sure.
        </p>
      </div>

      {book && where && (
        <div class="pad">
          <button class="ask-hearing" onClick={() => run('What is happening or being explained at this point, and why does it matter?', { where })}>
            🎧 Ask about what I'm hearing <small>{where.label}</small>
          </button>
        </div>
      )}

      {book && (
        <div class="ask-modes">
          {MODES.map((m) => (
            <button class={'ask-mode' + (mode === m.id ? ' on' : '')} onClick={() => setMode(mode === m.id ? '' : m.id)}>
              <span>{m.icon}</span> {m.label}
            </button>
          ))}
        </div>
      )}

      <div class="ask-suggest pad">
        {(book ? current?.asks || STARTERS : LIBRARY_ASKS).map((q) => (
          <button class="ask-q" disabled={!!busy} onClick={() => pick(q)}>
            💡 {q}
          </button>
        ))}
        {book && mode === 'summarize' && (
          <button class="ask-q" disabled={!!busy} onClick={makeBlinks}>
            {busy === 'blinks' ? <span class="spinner small" /> : '📚'} Blinks — key ideas to read or listen to
          </button>
        )}
      </div>

      {!book && <SavedIdeas />}

      <div class="ask-thread pad">
        {msgs.map((m, i) => (
          <div class={'ask-msg ' + m.role + (m.error ? ' err' : '')}>
            {m.quiz ? <Quiz questions={m.quiz} /> : m.role === 'ai' ? <Answer text={m.text} /> : m.text}
            {m.role === 'ai' && !m.quiz && !m.error && m.text && (
              <button class={'ask-speak' + (speaking === i ? ' on' : '')} onClick={() => say(i, m.text)} aria-label={speaking === i ? 'Stop reading' : 'Read aloud'}>
                {speaking === i ? '■ Stop' : '🔊 Listen'}
              </button>
            )}
          </div>
        ))}
        {busy && busy !== 'blinks' && (
          <div class="ask-msg ai typing">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        class={'ask-input' + (ps.book ? ' with-mini' : '')}
        onSubmit={(e) => {
          e.preventDefault();
          run(text);
        }}
      >
        {canListen() && (
          <>
            <button type="button" class="ask-lang" onClick={() => voiceLang.set(lang === 'hi-IN' ? 'en-IN' : 'hi-IN')} title={LANGS.find(([k]) => k === lang)?.[1]}>
              {lang === 'hi-IN' ? 'हिं' : 'EN'}
            </button>
            <button type="button" class="ask-mic" disabled={!!busy} onClick={voice} aria-label="Ask by voice">
              🎙
            </button>
          </>
        )}
        <input value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder={book ? 'Ask anything about this book…' : 'Ask anything about your books…'} />
        <button class="ask-send" disabled={!text.trim() || !!busy} aria-label="Send">
          ➤
        </button>
      </form>
      <div class="footer-space" />
    </div>
  );
}

/** Light formatting for answers: paragraphs, bullet/numbered lists, **bold**, ### headings. */
function Answer({ text }) {
  const inline = (s) =>
    String(s)
      .split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g)
      .map((p) => (/^\*\*[^*]+\*\*$/.test(p) ? <b>{p.slice(2, -2)}</b> : /^(\*[^*]+\*|_[^_]+_)$/.test(p) ? <i>{p.slice(1, -1)}</i> : p));
  const blocks = [];
  let list = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    const bullet = /^([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) blocks.push((list = { list: true, ordered: /\d/.test(bullet[1]), items: [] }));
      list.items.push(bullet[2]);
      continue;
    }
    list = null;
    if (!line) continue;
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(h ? { h: h[1] } : { p: line });
  }
  return (
    <div class="ask-answer">
      {blocks.map((b) =>
        b.list ? (
          b.ordered ? (
            <ol>{b.items.map((i) => <li>{inline(i)}</li>)}</ol>
          ) : (
            <ul>{b.items.map((i) => <li>{inline(i)}</li>)}</ul>
          )
        ) : b.h ? (
          <h4>{inline(b.h)}</h4>
        ) : (
          <p>{inline(b.p)}</p>
        )
      )}
    </div>
  );
}

/** Tap an answer; it shows right or wrong and why. */
function Quiz({ questions }) {
  const [picked, setPicked] = useState({});
  const score = Object.entries(picked).filter(([i, a]) => questions[i].answer === a).length;
  const done = Object.keys(picked).length === questions.length;
  return (
    <div class="quiz">
      <b class="quiz-title">🧠 Quiz</b>
      {questions.map((q, i) => (
        <div class="quiz-q">
          <p>
            {i + 1}. {q.q}
          </p>
          {q.options.map((o, j) => {
            const chosen = picked[i] === j;
            const reveal = picked[i] != null;
            return (
              <button
                class={'quiz-opt' + (reveal && j === q.answer ? ' right' : '') + (chosen && j !== q.answer ? ' wrong' : '')}
                disabled={reveal}
                onClick={() => setPicked((p) => ({ ...p, [i]: j }))}
              >
                <span>{'ABCD'[j]}</span> {o}
              </button>
            );
          })}
          {picked[i] != null && q.why && <small class="quiz-why">{q.why}</small>}
        </div>
      ))}
      {done && (
        <p class="quiz-score">
          {score} / {questions.length} {score === questions.length ? '— perfect! 🎉' : score >= questions.length / 2 ? '— nicely done' : '— worth another listen'}
        </p>
      )}
    </div>
  );
}

/** Ideas saved with "Remember" in the player: a quiet, foldable list (Ask my books also reads them). */
function SavedIdeas() {
  const list = useStore(ideas) || [];
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  return (
    <div class="pad saved-ideas">
      <button class="links-toggle" onClick={() => setOpen(!open)}>
        <span>
          💾 Saved ideas <small>{list.length}</small>
        </span>
        <Icon name={open ? 'up' : 'down'} size={16} />
      </button>
      {open &&
        list.map((c) => (
          <div class="idea-card">
            <p>{c.text}</p>
            <small>
              {c.title}
              {c.where ? ` · ${c.where}` : ''}
            </small>
            <button class="link-btn" onClick={() => forgetIdea(c.t)}>
              Remove
            </button>
          </div>
        ))}
    </div>
  );
}
