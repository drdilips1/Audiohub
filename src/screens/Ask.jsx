import { useEffect, useRef, useState } from 'preact/hooks';
import { TopBar, Cover, toast } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { nav } from '../lib/nav.js';
import { aiReady } from '../lib/ai.js';
import { MODES, STARTERS, LIBRARY_ASKS, ask, quiz, threadFor, clearThread, hearing, ideas, forgetIdea, spoilerLimit, answerSource, hasBookText, keepAnswer } from '../lib/askbook.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { copyText } from '../lib/report.js';

const Web = registerPlugin('InkwellWeb');
const nativeShare = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');
// An answer as plain text (no ** or ### marks), for sharing and copying.
const plain = (t) => String(t || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^#{1,4}\s+/gm, '').replace(/^[*•]\s+/gm, '• ').trim();
async function shareAnswer(book, q, a) {
  const text = `${q ? `Q: ${q.replace(/^[🎧🎙]\s*/u, '')}\n\n` : ''}${plain(a)}${book ? `\n\n— Asked about “${mainTitle(book.title)}”${book.author ? ` by ${book.author}` : ''} in Audiohub` : ''}`;
  if (nativeShare) return Web.shareText({ text, title: 'Share answer' });
  if (navigator.share) return navigator.share({ text }).catch(() => {});
  if (await copyText(text)) toast('Copied — paste it anywhere');
}
import { keyIdeas, summaryBook } from '../sources/summaries.js';
import { mainTitle } from '../lib/match.js';
import { usePlayer } from '../components/player-ui.jsx';
import { useStore, settings } from '../lib/store.js';
import * as player from '../lib/player.js';
import { canListen, listen, speakAnswer, stopAnswer, voiceLang, LANGS, askVoice, canPickVoice, ASK_VOICES, autoRead } from '../lib/voiceask.js';

/**
 * Ask AI about one book (params.book) or about your whole library (no book).
 * params: { book, description, genres, mode, question }
 */
// Questions an Ask screen was opened with that have already been asked: coming back to the
// screen (from the player, another tab) must not ask them again.
const asked = new Set();

export function Ask({ book = null, description = '', genres = [], mode: startMode = '', question = '', here = false, askId = '', voice: spoken = false }) {
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
  // Answers from the book's own text when its ebook is on hand: say so up top.
  const [using, setUsing] = useState('');
  useEffect(() => {
    hasBookText(book).then((y) => y && setUsing('ebook')).catch(() => {});
  }, [book?.uid]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showStarters, setShowStarters] = useState(false);
  const lim = book ? spoilerLimit(book) : null;

  const scrollEnd = () => setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 60);
  const run = async (q, extra = {}) => {
    if (!q.trim() || busy) return;
    if (!aiReady()) {
      toast('Add an AI key in Settings → AI first');
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
      setMsgs([...before, { role: 'user', text: shown }, { role: 'ai', text: a, from: answerSource() }]);
      if (answerSource() === 'ebook') setUsing('ebook');
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
    const id = askId || question;
    if (question && !asked.has(id)) {
      asked.add(id);
      // Asked with the voice button: shown as spoken, and the answer is read out.
      run(question, { ...(here && where ? { where } : {}), ...(spoken ? { voice: true } : {}) });
    } else if (msgs.length) scrollEnd();
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
              <b>Ask about {title}</b>
              <span>
                {[lim ? `up to ${where?.chapter || `${lim.pct}%`} · no spoilers` : '', using === 'ebook' ? 'using your ebook' : 'from what the AI knows'].filter(Boolean).join(' · ')}
              </span>
            </div>
            <button class={'icon-btn ask-set' + (settingsOpen ? ' on' : '')} aria-label="Answer settings" onClick={() => setSettingsOpen(!settingsOpen)}>
              <Icon name="settings" size={18} />
            </button>
          </div>
        ) : (
          <div class="ask-book">
            <div class="ask-cover lib">📚</div>
            <div>
              <b>Ask my books</b>
              <span>Themes, contradictions, what to read next</span>
            </div>
            <button class={'icon-btn ask-set' + (settingsOpen ? ' on' : '')} aria-label="Answer settings" onClick={() => setSettingsOpen(!settingsOpen)}>
              <Icon name="settings" size={18} />
            </button>
          </div>
        )}
        {settingsOpen && (
          <div class="ask-settings">
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
              <option value="phone">Phone voice — instant</option>
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
            {lim && (
              <button class="ask-spoiler" onClick={() => (settings.patch({ aiNoSpoilers: false }), toast('Spoilers allowed — switch back in Settings → AI'))}>
                🙈 No spoilers past {lim.pct}% · tap to allow
              </button>
            )}
            <p class="muted small ask-note">
              {using === 'ebook'
                ? 'Answers come from your ebook’s own text first (the passages that fit the question), then what the AI knows.'
                : 'No ebook attached: answers use what the AI knows about the book, its description and what you’ve heard (live transcript). Attach the ebook (Text → Change) for answers from the book itself.'}
            </p>
          </div>
        )}
      </div>

      {book && where && (
        <div class="pad">
          <button class="ask-hearing" onClick={() => run('What is happening or being explained at this point, and why does it matter?', { where })}>
            🎧 Ask about what I'm hearing <small>{where.label}</small>
          </button>
        </div>
      )}

      {/* Ready-made questions: up front for a new conversation; tucked away once it's going. */}
      {msgs.length > 0 && !showStarters && (
        <div class="pad">
          <button class="link-btn ask-more-q" onClick={() => setShowStarters(true)}>
            💡 More questions to ask
          </button>
        </div>
      )}
      {(showStarters || !msgs.length) && book && (
        <div class="ask-modes">
          {MODES.map((m) => (
            <button class={'ask-mode' + (mode === m.id ? ' on' : '')} onClick={() => setMode(mode === m.id ? '' : m.id)}>
              <span>{m.icon}</span> {m.label}
            </button>
          ))}
        </div>
      )}

      {(showStarters || !msgs.length) && <div class="ask-suggest pad">
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
      </div>}

      {!book && <SavedIdeas />}

      <div class="ask-thread pad">
        {msgs.map((m, i) => (
          <>
            <div class={'ask-msg ' + m.role + (m.error ? ' err' : '')}>
              {m.quiz ? <Quiz questions={m.quiz} /> : m.role === 'ai' ? <Answer text={m.text} /> : m.text}
              {m.role === 'ai' && !m.quiz && !m.error && m.text && (
                <div class="ask-from">
                  <span>{m.from === 'ebook' ? '📖 From your ebook' : m.from === 'heard' ? '🎧 From what you’ve heard' : '✳︎ From what the AI knows'}</span>
                </div>
              )}
            </div>
            {m.role === 'ai' && !m.quiz && !m.error && m.text && (
              <div class="ask-acts">
                <button onClick={() => shareAnswer(book, msgs[i - 1]?.text, m.text)}>
                  <Icon name="upload" size={14} /> Share
                </button>
                <button onClick={async () => toast((await copyText(plain(m.text))) ? 'Copied' : 'Could not copy')}>
                  <Icon name="link" size={14} /> Copy
                </button>
                <button class={speaking === i ? 'on' : ''} onClick={() => say(i, m.text)}>
                  {speaking === i ? '■ Stop' : '🔊 Listen'}
                </button>
                <button onClick={() => (keepAnswer(book, plain(m.text)), toast('Saved to your ideas'))}>
                  <Icon name="bookmark" size={14} /> Save
                </button>
              </div>
            )}
            {i === msgs.length - 1 && m.role === 'ai' && !m.error && !busy && book && (
              <div class="ask-next">
                {['Explain that more simply', 'Give me a real-life example', 'Quiz me'].map((q) => (
                  <button class="ask-q" onClick={() => pick(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
          </>
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
export function Answer({ text }) {
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
