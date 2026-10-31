// The player's History (More → History): what happened while you listened, newest first,
// grouped into listening sessions. Tap an entry to go back to where you were then.
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { useStore } from '../lib/store.js';
import { fmtTime } from '../lib/format.js';
import * as player from '../lib/player.js';
import { playHistory, clearHistory } from '../lib/history.js';

const KIND = {
  play: ['play', 'Played'],
  pause: ['pause', 'Paused'],
  back: ['prev', 'Skipped back'],
  forward: ['next', 'Skipped forward'],
  seek: ['chevron', 'Jumped'],
  chapter: ['list', 'Changed chapter'],
  sleep: ['moon', 'Sleep timer stopped it'],
  bookmark: ['bookmark', 'Went to a bookmark'],
};
const SESSION_GAP = 30 * 60e3; // a pause longer than this starts a new session

const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (t) => {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(Date.now() - 86400e3);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

export function HistorySheet({ book, close }) {
  const all = useStore(playHistory);
  const list = all[book.uid] || [];
  // Sessions: runs of events without a long gap; newest first, events newest first.
  const sessions = [];
  for (const e of list) {
    const cur = sessions[sessions.length - 1];
    if (!cur || e.t - cur.end > SESSION_GAP) sessions.push({ start: e.t, end: e.t, items: [e] });
    else (cur.items.push(e), (cur.end = e.t));
  }
  sessions.reverse();
  const go = (g) => {
    player.playAt(Math.max(0, g));
    toast(`Playing from ${fmtTime(g)}`);
    close();
  };
  return (
    <div class="history">
      <div class="history-head">
        <h3>History</h3>
        {list.length > 0 && (
          <button class="link-btn" onClick={() => confirm('Clear this book’s history?') && clearHistory(book.uid)}>
            Clear
          </button>
        )}
      </div>
      {!list.length ? (
        <p class="muted">Plays, pauses, skips, jumps and sleep-timer stops show here with where you were — tap one to go back there.</p>
      ) : (
        <>
          <p class="muted small">Tap an entry to play from where you were at that moment.</p>
          {sessions.map((s, si) => (
            <section class={'history-session' + (si % 2 ? ' alt' : '')}>
              <div class="history-day">
                {day(s.start)} · {clock(s.start)}
                {s.end - s.start > 60e3 ? `–${clock(s.end)}` : ''}
              </div>
              {[...s.items].reverse().map((e) => {
                const [icon, label] = KIND[e.type] || ['chevron', e.type];
                return (
                  <button class="history-row" onClick={() => go(e.g)}>
                    <span class="history-icon">
                      <Icon name={icon} size={15} />
                    </span>
                    <span class="history-what">
                      <b>
                        {label}
                        {e.n > 1 ? ` ×${e.n}` : ''}
                      </b>
                      <small>
                        at {fmtTime(e.g)}
                        {e.to != null && Math.abs(e.to - e.g) > 1 ? ` → ${fmtTime(e.to)}` : ''}
                        {e.ch ? ` · ${e.ch}` : ''}
                      </small>
                    </span>
                    <span class="history-time">{clock(e.t)}</span>
                  </button>
                );
              })}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
