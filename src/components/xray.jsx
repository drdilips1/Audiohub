// X-Ray in the player: a quiet line of who and where is in the scene now, and a sheet
// with everyone and every place so far — tap one for each chapter they're in and jump there.
import { useEffect, useState } from 'preact/hooks';
import { toast } from './common.jsx';
import * as player from '../lib/player.js';
import { aiReady } from '../lib/ai.js';
import { subscribeTranscript } from '../lib/transcript.js';
import { loadXray, cachedXray, timeline, inScene } from '../lib/xray.js';
import { knownCharacters } from './story-sheet.jsx';
import { fmtTime } from '../lib/format.js';

const share = (uid, data) => knownCharacters.set({ uid, at: data.at, list: data.people });

/** Lines heard in the last few minutes of the current part. */
function useRecent(s) {
  const [t, setT] = useState(null);
  useEffect(() => subscribeTranscript(setT), []);
  const segs = t?.segments || [];
  return segs.filter((g) => g.start != null && g.start <= s.time + 1 && g.start >= s.time - 180).map((g) => (t?.bookText?.state === 'on' && g.book) || g.text);
}

export function XraySheet({ s }) {
  const [data, setData] = useState(() => cachedXray(s.book.uid));
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('people');
  const [pick, setPick] = useState(null);
  const [q, setQ] = useState('');
  const recent = useRecent(s);
  const load = (force) => {
    setBusy(true);
    loadXray({ force })
      .then((d) => (setData(d), share(s.book.uid, d)))
      .catch((e) => toast(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    if (aiReady()) load(false);
  }, []);
  if (!aiReady()) return <p class="muted">X-Ray uses your AI service. Add a key once in Settings → AI.</p>;
  if (!data)
    return (
      <p class="muted">
        <span class="spinner small" /> Finding who and where…
      </p>
    );
  if (pick) {
    const tl = timeline(pick, data);
    return (
      <div class="xray">
        <button class="pill small" onClick={() => setPick(null)}>
          ‹ Back
        </button>
        <h3>{pick.name}</h3>
        {pick.role && <p class="muted">{pick.role}</p>}
        <p>{pick.about}</p>
        <h4>{tl.length ? `In ${tl.length} ${tl.length === 1 ? 'chapter' : 'chapters'} so far` : 'Not placed in a chapter yet'}</h4>
        <ul class="xray-tl">
          {tl.map((e) => (
            <li>
              <button
                onClick={() => {
                  player.seekGlobal(e.g);
                  toast(`Jumped to ${e.title}`);
                }}
              >
                <b>{e.title}</b>
                <small>{e.said ? `“${e.said.slice(0, 90)}${e.said.length > 90 ? '…' : ''}”` : data.topics?.[e.chapter] || 'From the start of the chapter'}</small>
                <span class="xray-at">{fmtTime(e.g)}</span>
              </button>
            </li>
          ))}
        </ul>
        <small class="muted">Only up to where you are. Moments in quotes are where the name was said (from the transcript).</small>
      </div>
    );
  }
  const now = inScene(data, recent);
  const all = tab === 'people' ? data.people : data.places;
  const list = all.filter((x) => !q || `${x.name} ${(x.aliases || []).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const nowSet = new Set([...now.people, ...now.places].map((x) => x.name));
  return (
    <div class="xray">
      <h3>X-Ray</h3>
      {(now.people.length > 0 || now.places.length > 0) && (
        <div class="xray-now">
          <small class="muted">{now.heard ? 'In this scene' : 'In this chapter'}</small>
          <div>
            {[...now.people, ...now.places].map((x) => (
              <button class={'xray-chip' + (data.places.includes(x) ? ' place' : '')} onClick={() => setPick(x)}>
                {data.places.includes(x) ? '📍 ' : ''}
                {x.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="segmented">
        <button class={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>
          People {data.people.length}
        </button>
        <button class={tab === 'places' ? 'on' : ''} onClick={() => setTab('places')}>
          Places {data.places.length}
        </button>
      </div>
      <input class="story-search" placeholder={tab === 'people' ? 'Find someone' : 'Find a place'} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      <ul class="char-list">
        {list.map((x) => (
          <li onClick={() => setPick(x)} class={nowSet.has(x.name) ? 'here' : ''}>
            <div class="char-head">
              <b>{x.name}</b>
              <span>{x.role || x.about}</span>
            </div>
          </li>
        ))}
      </ul>
      {!list.length && <p class="muted">Nothing here yet.</p>}
      <button class="btn ghost-wide" disabled={busy} onClick={() => load(true)}>
        {busy ? <span class="spinner small" /> : 'Refresh'}
      </button>
    </div>
  );
}
