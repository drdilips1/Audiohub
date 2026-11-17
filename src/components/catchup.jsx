// "You drifted off": the sleep timer stopped the book — what happened in the last minutes
// before it stopped, said out loud (from what was heard, or the ebook), or back to there.
import { useState } from 'preact/hooks';
import { useStore } from '../lib/store.js';
import * as player from '../lib/player.js';
import { aiReady, askAi } from '../lib/ai.js';
import { heardLines, bookTextBefore } from '../lib/transcript.js';
import { speakAnswer, stopAnswer } from '../lib/voiceask.js';
import { fmtTime } from '../lib/format.js';
import { Icon } from './icons.jsx';

const MIN = 10; // minutes before the stop

/** The words of the last MIN minutes before `g` (book seconds), or ''. */
function textBefore(uid, g) {
  const heard = heardLines(uid)
    .map((l) => ({ g: player.trackOffset(l.track) + l.start, text: l.text }))
    .filter((l) => l.g >= g - MIN * 60 && l.g <= g + 5)
    .sort((a, b) => a.g - b.g)
    .map((l) => l.text)
    .join(' ');
  if (heard.split(/\s+/).length > 60) return heard;
  return bookTextBefore(g, MIN * 150) || heard;
}

export function CatchUp({ book }) {
  const all = useStore(player.driftedOff);
  const d = all[book?.uid];
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  // Only the same day, and only while you're still before (or just past) where it stopped.
  const g = player.globalTime();
  if (!d || Date.now() - d.at > 18 * 3600e3 || g > d.g + 120) return null;
  const close = () => (stopAnswer(), player.driftedOff.set((x) => ({ ...x, [book.uid]: undefined })));
  const back = () => {
    player.playAt(Math.max(0, d.g - MIN * 60));
    close();
  };
  const hear = async () => {
    setBusy(true);
    try {
      const text = textBefore(book.uid, d.g);
      const ch = player.chapters().find((c) => d.g >= c.start && d.g < (c.end || Infinity));
      const answer = await askAi(
        `A listener fell asleep listening to the audiobook "${book.title}"${book.author ? ` by ${book.author}` : ''}${ch?.title ? `, in "${ch.title}"` : ''}. ${text ? `This is what was read in the last ${MIN} minutes before it stopped:\n"""${text.slice(-6000)}"""\n` : `There's no text of that part; it stopped ${fmtTime(d.g)} into the book.\n`}In 3 or 4 short spoken sentences, tell them what happened in those minutes, so they can carry on. ${text ? 'Only what is in the text — nothing after it.' : 'Only what you are sure of up to that point — never anything later in the book.'} No preamble.`
      );
      setSaid(answer.trim());
      if (player.getState().playing) player.pause();
      speakAnswer(answer.trim(), () => {});
    } catch (e) {
      setSaid(e.message || "Couldn't get that right now");
    }
    setBusy(false);
  };
  return (
    <div class="catchup">
      <div class="catchup-head">
        <b>☾ You drifted off?</b>
        <button class="icon-btn" aria-label="Dismiss" onClick={close}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <p>{said || `The sleep timer stopped the book at ${fmtTime(d.g)}. Missed the last few minutes?`}</p>
      <div class="catchup-btns">
        {aiReady() && !said && (
          <button class="pill small on" disabled={busy} onClick={hear}>
            {busy ? <span class="spinner small" /> : '▶ What happened'}
          </button>
        )}
        <button class="pill small" onClick={back}>
          Go back {MIN} min
        </button>
      </div>
    </div>
  );
}
