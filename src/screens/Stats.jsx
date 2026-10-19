import { useMemo, useState } from 'preact/hooks';
import { TopBar, Cover } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { useStore, progress } from '../lib/store.js';
import { listenLog, summary, flush } from '../lib/stats.js';
import { nav } from '../lib/nav.js';

const hm = (s) => {
  const m = Math.round((s || 0) / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hourLabel = (h) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
const PARTS = [
  [5, 12, 'mornings'],
  [12, 17, 'afternoons'],
  [17, 21, 'evenings'],
  [21, 29, 'late at night'],
];

/** Listening stats: how much, when, what, and your streak. */
export function Stats() {
  flush(); // include what's been heard in the last few seconds
  const log = useStore(listenLog);
  const prog = useStore(progress);
  const s = useMemo(summary, [log, prog]);
  const since = s.since ? new Date(s.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const peak = s.hours.indexOf(Math.max(...s.hours));
  const part = PARTS.find(([a, b]) => (peak >= a && peak < b) || (peak + 24 >= a && peak + 24 < b))?.[2];
  const avg30 = s.last30.reduce((a, d) => a + d.s, 0) / 30;
  return (
    <div class="screen stats-screen">
      <TopBar title="Listening stats" ask={false} />

      <div class="st-tiles">
        <Tile label="Today" value={hm(s.today)} />
        <Tile label="This week" value={hm(s.week)} />
        <Tile label="Last 30 days" value={hm(s.month)} />
        <Tile label="All time" value={hm(s.total)} />
      </div>

      <div class="st-card st-streak">
        <div>
          <b>{s.streak}</b>
          <span>day streak</span>
        </div>
        <div>
          <b>{s.best}</b>
          <span>best streak</span>
        </div>
        <div>
          <b>{s.activeDays}</b>
          <span>days listened</span>
        </div>
      </div>

      <section class="st-card">
        <h3>Last 30 days</h3>
        <p class="st-note">{avg30 > 0 ? `About ${hm(avg30)} a day on average` : 'Your daily listening shows here'}</p>
        <Bars
          values={s.last30.map((d) => d.s)}
          labels={s.last30.map((d, i) => (i % 7 === 2 || i === 29 ? new Date(d.day + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''))}
          tips={s.last30.map((d) => `${new Date(d.day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${hm(d.s)}`)}
          highlight={29}
        />
      </section>

      <section class="st-card">
        <h3>Time of day</h3>
        <p class="st-note">{s.total > 0 && part ? `You listen most ${part}` : 'When you listen, by hour'}</p>
        <Bars values={s.hours} labels={s.hours.map((_, h) => (h % 6 === 0 ? hourLabel(h) : ''))} tips={s.hours.map((v, h) => `${hourLabel(h)}–${hourLabel((h + 1) % 24)} · ${hm(v)}`)} highlight={s.total ? peak : -1} />
      </section>

      <section class="st-card">
        <h3>Days of the week</h3>
        <Bars values={s.weekdays} labels={WEEKDAYS} tips={s.weekdays.map((v, i) => `${WEEKDAYS[i]} · ${hm(v)}`)} highlight={s.total ? s.weekdays.indexOf(Math.max(...s.weekdays)) : -1} />
      </section>

      <div class="st-tiles">
        <Tile label="Average speed" value={`${s.avgSpeed.toFixed(2).replace(/0$/, '')}×`} />
        <Tile label="Time saved by speed" value={hm(s.saved)} />
        <Tile label="Finished this year" value={String(s.finishedThisYear)} />
        <Tile label="Books started" value={String(s.started)} />
      </div>

      {s.topBooks.length > 0 && (
        <section class="st-card">
          <h3>Most listened</h3>
          {s.topBooks.map(({ book, s: secs }) => (
            <button class="st-row" onClick={() => nav.push('book', { book })}>
              <Cover book={book} />
              <div>
                <b>{book.title}</b>
                <small>{book.author}</small>
                <div class="st-meter">
                  <div style={{ width: `${Math.max(4, (secs / s.topBooks[0].s) * 100)}%` }} />
                </div>
              </div>
              <em>{hm(secs)}</em>
            </button>
          ))}
        </section>
      )}

      {s.topAuthors.length > 1 && (
        <section class="st-card">
          <h3>Top authors</h3>
          {s.topAuthors.map(([name, secs]) => (
            <div class="st-author">
              <span>{name}</span>
              <div class="st-meter">
                <div style={{ width: `${Math.max(4, (secs / s.topAuthors[0][1]) * 100)}%` }} />
              </div>
              <em>{hm(secs)}</em>
            </div>
          ))}
        </section>
      )}

      {s.finished.length > 0 && (
        <section class="st-card">
          <h3>Finished · {s.finishedAll}</h3>
          {s.finished.map(({ book, at }) => (
            <button class="st-row" onClick={() => nav.push('book', { book })}>
              <Cover book={book} />
              <div>
                <b>{book.title}</b>
                <small>{book.author}</small>
              </div>
              <em>{at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}</em>
            </button>
          ))}
        </section>
      )}

      <p class="st-foot">
        <Icon name="info" size={14} /> Listening time is counted on this phone{since ? ` since ${since}` : ' from now on'}. Books started and finished include everything before.
      </p>
      <div class="footer-space" />
    </div>
  );
}

function Tile({ label, value }) {
  return (
    <div class="st-tile">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/** Single-series bar chart; tap a bar to read its value. */
function Bars({ values, labels, tips, highlight = -1 }) {
  const [sel, setSel] = useState(-1);
  const max = Math.max(...values, 1);
  const n = values.length;
  const W = 100 / n;
  return (
    <div class="st-bars">
      <div class="st-tip">{sel >= 0 ? tips[sel] : ' '}</div>
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label={tips.join('; ')}>
        <line x1="0" x2="100" y1="49.75" y2="49.75" class="st-base" />
        {values.map((v, i) => {
          const h = v > 0 ? Math.max(1.5, (v / max) * 46) : 0;
          return (
            <g onClick={() => setSel(sel === i ? -1 : i)}>
              <rect x={i * W} y="0" width={W} height="50" fill="transparent" />
              {h > 0 && <rect x={i * W + W * 0.18} y={49.5 - h} width={W * 0.64} height={h} rx={Math.min(1.2, W * 0.3)} class={'st-bar' + (i === sel ? ' sel' : i === highlight ? ' hi' : '')} />}
            </g>
          );
        })}
      </svg>
      <div class="st-labels" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {labels.map((l) => (
          <span>{l}</span>
        ))}
      </div>
    </div>
  );
}
