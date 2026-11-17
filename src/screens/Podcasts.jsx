import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../components/icons.jsx';
import { toast, Empty, TopBar, AskButton } from '../components/common.jsx';
import { useStore, progress, useStoreKey, useSelect, persisted } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { fmtDuration } from '../lib/format.js';
import * as player from '../lib/player.js';
import { usePlayer } from '../components/player-ui.jsx';
import * as pod from '../sources/podcasts.js';
import { downloads, canDownload, downloadBook } from '../lib/downloads.js';

const ago = (t) => {
  if (!t) return '';
  const d = Math.round((Date.now() - t) / 86400e3);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
};

// Episode filters: unplayed (show page), short, downloaded, started.
const FILTERS = [
  ['all', 'All'],
  ['short', 'Under 30 min'],
  ['downloaded', 'Downloaded'],
  ['started', 'Started'],
];
// Which episodes are started / finished: changes rarely, unlike the position saves every few seconds.
const progSig = (all) =>
  Object.entries(all || {})
    .filter(([, p]) => p && ((p.time || 0) > 0 || p.finished))
    .map(([k, p]) => (p.finished ? k + '!' : k))
    .join('|');

function passes(ep, f, dls, prog = progress.get()) {
  if (f === 'short') return ep.duration > 0 && ep.duration < 30 * 60;
  if (f === 'downloaded') return dls[ep.uid]?.status === 'done';
  if (f === 'started') return (prog[ep.uid]?.time || 0) > 0 && !prog[ep.uid]?.finished;
  if (f === 'unplayed') return !pod.isPlayed(ep);
  return true;
}
function EpisodeFilters({ value, onChange, extra = [] }) {
  return (
    <div class="chips ep-filters">
      {[...extra, ...FILTERS].map(([k, label]) => (
        <button class={'pill small' + (value === k ? ' active' : '')} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Per-show settings: own speed, skip the intro and the outro. */
function ShowSettings({ feedUrl }) {
  const prefs = useStore(pod.showPrefs)[feedUrl] || {};
  const set = (patch) => pod.setShowPref(feedUrl, patch);
  const secs = [0, 10, 20, 30, 45, 60, 90, 120];
  const label = (n) => (n ? (n < 60 ? `${n}s` : `${n / 60} min`) : 'Off');
  return (
    <div class="show-settings pad">
      <b>Speed for this show</b>
      <div class="chips">
        {[0, 1, 1.2, 1.3, 1.5, 1.75, 2].map((r) => (
          <button class={'pill small' + ((prefs.speed || 0) === r ? ' active' : '')} onClick={() => set({ speed: r })}>
            {r ? `${r}×` : 'Usual'}
          </button>
        ))}
      </div>
      <b>Skip the intro</b>
      <div class="chips">
        {secs.map((n) => (
          <button class={'pill small' + ((prefs.intro || 0) === n ? ' active' : '')} onClick={() => set({ intro: n })}>
            {label(n)}
          </button>
        ))}
      </div>
      <b>Skip the outro</b>
      <div class="chips">
        {secs.map((n) => (
          <button class={'pill small' + ((prefs.outro || 0) === n ? ' active' : '')} onClick={() => set({ outro: n })}>
            {label(n)}
          </button>
        ))}
      </div>
      {canDownload && (
        <>
          <b>Download new episodes by themselves</b>
          <div class="chips">
            {[0, 1, 3, 5, 10].map((n) => (
              <button
                class={'pill small' + ((prefs.autoDl || 0) === n ? ' active' : '')}
                onClick={() => {
                  set({ autoDl: n });
                  if (n) import('../lib/podauto.js').then((m) => m.autoDownload({ refresh: false }));
                }}
              >
                {n ? `Newest ${n}` : 'Off'}
              </button>
            ))}
          </div>
        </>
      )}
      <small class="muted">
        Applies to every episode of this show. The outro skip ends the episode early and moves on to Up Next. New episodes download on Wi-Fi when the app opens; played ones beyond the newest few
        are removed.
      </small>
    </div>
  );
}

export function playEpisode(ep, podcast) {
  nav.openOverlay('player');
  player.playBook(pod.asBook(ep, podcast));
}

/** One episode: play, queue, download, mark played, show notes. */
export function EpisodeRow({ ep, podcast, showShow = false }) {
  const p = useStore(pod.podcasts);
  const prog = useStoreKey(progress, ep.uid);
  const dl = useStore(downloads)[ep.uid];
  const ps = usePlayer();
  const [open, setOpen] = useState(false);
  const vote = useStore(pod.episodeVotes)[ep.uid];
  const played = !!p.played[ep.uid] || !!prog?.finished;
  const queued = p.queue.some((q) => q.uid === ep.uid);
  const current = ps.book?.uid === ep.uid;
  const pct = prog && !prog.finished ? Math.round((prog.percent || 0) * 100) : 0;
  const left = ep.duration && prog && !prog.finished ? ep.duration - (prog.global || prog.time || 0) : 0;
  const art = ep.image || ep.podcast?.cover || podcast?.cover;
  const showName = ep.podcast?.title || ep.show || podcast?.title || '';
  const meta = [showShow && showName, ep.duration ? (left > 60 ? `${fmtDuration(left)} left` : fmtDuration(ep.duration)) : '', ago(ep.date), dl?.status === 'done' ? 'Downloaded' : dl?.status === 'downloading' ? 'Downloading…' : ''].filter(Boolean);
  return (
    <div class={'ep ep2' + (played ? ' played' : '') + (current ? ' current' : '')}>
      <div class="ep-main" onClick={() => setOpen(!open)}>
        {art ? <Thumb class="ep-art" src={art} size={120} /> : <div class="ep-art ep-art-ph">{showName[0] || '♪'}</div>}
        <div class="ep-text">
          <b>{ep.title}</b>
          <small>{meta.join(' · ')}</small>
        </div>
        <button
          class={'ep-ring' + (played ? ' done' : '')}
          aria-label={played ? 'Played — play again' : current && ps.playing ? 'Pause' : 'Play'}
          onClick={(e) => (e.stopPropagation(), current ? player.toggle() : playEpisode(ep, podcast))}
        >
          <svg viewBox="0 0 38 38" aria-hidden="true">
            <circle cx="19" cy="19" r="16" class="ep-ring-track" />
            {pct > 0 && <circle cx="19" cy="19" r="16" class="ep-ring-arc" pathLength="100" stroke-dasharray={`${pct} 100`} transform="rotate(-90 19 19)" />}
            {played && !current ? <path d="m13 19 4 4 8-9" class="ep-ring-tick" /> : current && ps.playing ? <path d="M14.5 13h3v12h-3zM20.5 13h3v12h-3z" class="ep-ring-fill" /> : <path d="M16 13v12l10-6z" class="ep-ring-fill" />}
          </svg>
        </button>
      </div>
      {open && (
        <div class="ep-actions ep2-actions">
          <button class={'pill small' + (queued ? ' active' : '')} onClick={() => (queued ? pod.dequeue(ep.uid) : (pod.enqueue(ep, podcast || ep.podcast), toast('Added to Up next')))}>
            <Icon name={queued ? 'check' : 'list'} size={14} /> {queued ? 'In Up next' : 'Up next'}
          </button>
          {canDownload && dl?.status !== 'done' && (
            <button
              class="pill small"
              disabled={dl?.status === 'downloading'}
              onClick={() =>
                downloadBook(pod.asBook(ep, podcast || ep.podcast))
                  .then(() => toast('Episode downloaded'))
                  .catch((e) => toast(e.message))
              }
            >
              <Icon name="download" size={14} /> Download
            </button>
          )}
          <button class="pill small" onClick={() => pod.markPlayed(ep, !played)}>
            <Icon name="check" size={14} /> {played ? 'Mark unplayed' : 'Mark played'}
          </button>
        </div>
      )}
      {open && (
        <div class="ep-votes">
          <button class={'pill small' + (vote === 1 ? ' active' : '')} onClick={() => pod.voteEpisode(ep, 1)}>
            👍 Liked it
          </button>
          <button class={'pill small' + (vote === -1 ? ' active' : '')} onClick={() => pod.voteEpisode(ep, -1)}>
            👎 Not for me
          </button>
          <button class={'pill small' + (vote === 'no' ? ' active' : '')} onClick={() => (pod.voteEpisode(ep, 'no'), vote !== 'no' && toast('Hidden from new episodes'))}>
            Not interested
          </button>
        </div>
      )}
      {open && ep.notes && <p class="ep-notes">{ep.notes}</p>}
    </div>
  );
}

const podTab = persisted('podTab', 'listen');
const PTABS = [
  ['listen', 'Listen'],
  ['shows', 'Shows'],
  ['discover', 'Discover'],
];

export function Podcasts() {
  const p = useStore(pod.podcasts);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [latest, setLatest] = useState(null);
  const [charts, setCharts] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  // New episodes across subscriptions (cached feeds first, then refreshed).
  useEffect(() => {
    if (!p.subs.length) return setLatest([]);
    let alive = true;
    // Saved episodes at once; feeds that are out of date update in the background.
    const saved = pod.cachedLatest();
    if (saved.length) setLatest(saved);
    pod.refreshAll().then((r) => {
      if (alive) setLatest(r);
      import('../lib/podauto.js').then((m) => m.autoDownload({ refresh: false }));
    });
    return () => (alive = false);
  }, [p.subs.length]);
  useEffect(() => {
    if (p.subs.length) return;
    pod.top().then(setCharts).catch(() => setCharts([]));
  }, [p.subs.length]);
  // Search: podcast names, or subscribe directly when a feed address is pasted.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || /^https?:\/\//i.test(term)) return setResults(null);
    let alive = true;
    const t = setTimeout(() => {
      setSearching(true);
      pod
        .search(term)
        .then((r) => alive && setResults(r))
        .catch(() => alive && setResults([]))
        .finally(() => alive && setSearching(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const refresh = async () => {
    setBusy(true);
    try {
      setLatest(await pod.refreshAll({ fresh: true }));
      toast('Podcasts refreshed');
    } finally {
      setBusy(false);
    }
  };

  const isFeed = /^https?:\/\//i.test(q.trim());
  const [epFilter, setEpFilter] = useState('all');
  const dls = useStore(downloads);
  useSelect(progress, progSig);
  const prog = progress.get();
  useStore(pod.episodeVotes);
  const unplayed = (latest || []).filter((e) => !pod.isPlayed(e) && !pod.isHidden(e) && passes(e, epFilter, dls, prog)).slice(0, 25);
  const picks = latest ? pod.recommendedEpisodes(latest, prog) : [];

  const tab = useStore(podTab);
  const [searchOpen, setSearchOpen] = useState(false);
  const [allQ, setAllQ] = useState(false);
  // New episodes per show (for the number on its artwork).
  const newBy = {};
  for (const e of (latest || []).filter((x) => !pod.isPlayed(x) && !pod.isHidden(x))) {
    const k = e.feedUrl || e.podcast?.feedUrl || '';
    if (k) newBy[k] = (newBy[k] || 0) + 1;
  }
  // The episode you're part-way through.
  const nowEp = (() => {
    const cur = Object.entries(prog)
      .filter(([, x]) => x?.book?.source === 'pod' && !x.finished && (x.time || x.global || 0) > 30)
      .sort((x, y) => (y[1].updatedAt || 0) - (x[1].updatedAt || 0))[0];
    if (!cur) return null;
    const [uid, x] = cur;
    const ep = (latest || []).find((e) => e.uid === uid) || p.queue.find((e) => e.uid === uid);
    return { uid, x, ep };
  })();
  const queueSecs = p.queue.reduce((t, e) => t + (e.duration || 0), 0);
  const [shortLen, setShortLen] = useState('20');
  const shortEps = (latest || [])
    .filter((e) => !pod.isPlayed(e) && !pod.isHidden(e) && e.duration > 0)
    .filter((e) => (shortLen === '20' ? e.duration < 20 * 60 : shortLen === '45' ? e.duration >= 20 * 60 && e.duration < 45 * 60 : e.duration >= 45 * 60))
    .slice(0, 6);
  useEffect(() => {
    if (tab !== 'discover' || charts) return;
    pod.top().then(setCharts).catch(() => setCharts([]));
  }, [tab]);
  const Head = ({ icon, title, onMore, more = 'See all' }) => (
    <div class="d-head">
      <span class="d-ico">
        <Icon name={icon} size={20} />
      </span>
      <h3>{title}</h3>
      {onMore && (
        <button class="d-more" onClick={onMore}>
          {more} <Icon name="arrow" size={15} />
        </button>
      )}
    </div>
  );
  const opml = (
    <section class="d-sec pod-opml">
      <button class="pill small" onClick={() => fileRef.current?.click()}>
        <Icon name="upload" size={14} /> Import from another app (OPML)
      </button>
      {p.subs.length > 0 && (
        <button
          class="pill small"
          onClick={() => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([pod.exportOpml()], { type: 'text/x-opml' }));
            a.download = 'kathava-podcasts.opml';
            a.click();
          }}
        >
          <Icon name="download" size={14} /> Export OPML
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".opml,.xml,text/xml,text/x-opml"
        hidden
        onChange={async (e) => {
          const f = e.currentTarget.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            toast(await pod.importOpml(await f.text()));
          } catch (err) {
            toast(err.message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );

  return (
    <div class="screen podcasts pod2">
      <header class="pod-head">
        <h1 class="screen-title">Podcasts</h1>
        <div class="pod-tools">
          <button class="icon-btn" aria-label="Search podcasts" onClick={() => setSearchOpen(!searchOpen)}>
            <Icon name="search" size={21} />
          </button>
          <AskButton />
          <button class="icon-btn" aria-label="Refresh" disabled={busy} onClick={refresh}>
            {busy ? <span class="spinner small" /> : <Icon name="replay" size={19} />}
          </button>
        </div>
      </header>
      {(searchOpen || q) && (
        <div class="search-box">
          <Icon name="search" size={20} />
          <input value={q} autoFocus placeholder="Search podcasts or paste a feed link" onInput={(e) => setQ(e.currentTarget.value)} enterkeyhint="search" />
          {q && (
            <button class="icon-btn" onClick={() => (setQ(''), setSearchOpen(false))} aria-label="Clear">
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
      )}
      {isFeed && (
        <button class="btn ghost-wide" onClick={() => nav.push('podcast', { show: { feedUrl: q.trim(), title: '' } })}>
          <Icon name="search" size={16} /> Preview this feed
        </button>
      )}
      {searching && !results && <p class="muted pad">Searching…</p>}
      {results ? (
        <section class="d-sec">
          <Head icon="search" title="Results" />
          <ShowGrid shows={results} />
          {!results.length && <p class="muted">No podcasts found.</p>}
        </section>
      ) : (
        <>
          <div class="d-tabs pod-tabs">
            {PTABS.map(([k, l]) => (
              <button class={tab === k ? 'on' : ''} onClick={() => podTab.set(k)}>
                {l}
              </button>
            ))}
          </div>

          {tab === 'listen' && (
            <>
              {nowEp && (
                <section class="d-sec">
                  <Head icon="headphones" title="Now listening" />
                  <button class="d-card pod-now" onClick={() => (nowEp.ep ? playEpisode(nowEp.ep, nowEp.ep.podcast) : nav.openOverlay('player'))}>
                    {nowEp.x.book.cover ? <Thumb class="pod-now-art" src={nowEp.x.book.cover} size={300} /> : <div class="pod-now-art ep-art-ph">♪</div>}
                    <div class="pod-now-m">
                      <em>{nowEp.x.book.author}</em>
                      <b>{nowEp.x.book.title}</b>
                      <div class="pod-now-foot">
                        <div class="d-prog">
                          <i style={{ width: `${Math.round((nowEp.x.percent || 0) * 100)}%` }} />
                        </div>
                        <span>{nowEp.x.total ? `${fmtDuration(Math.max(0, nowEp.x.total - (nowEp.x.global || nowEp.x.time || 0)))} left` : ''}</span>
                      </div>
                    </div>
                    <span class="d-play">
                      <Icon name="play" size={18} />
                    </span>
                  </button>
                </section>
              )}
              {p.subs.length > 0 && (
                <section class="d-sec">
                  <Head icon="podcast" title="Your shows" onMore={() => podTab.set('shows')} />
                  <div class="pod-strip">
                    {p.subs.map((sh) => (
                      <button class="pod-strip-show" onClick={() => nav.push('podcast', { show: sh })}>
                        {sh.cover ? <Thumb src={sh.cover} size={180} /> : <div class="show-ph">{sh.title?.[0]}</div>}
                        {newBy[sh.feedUrl] > 0 && <span class="pod-new">{newBy[sh.feedUrl] > 9 ? '9+' : newBy[sh.feedUrl]}</span>}
                        <small>{sh.title}</small>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {p.queue.length > 0 && (
                <section class="d-sec">
                  <Head icon="list" title="Up next" more={allQ ? 'Less' : 'See all'} onMore={p.queue.length > 3 ? () => setAllQ(!allQ) : null} />
                  <p class="d-note">
                    {p.queue.length} episode{p.queue.length === 1 ? '' : 's'}
                    {queueSecs ? ` · ${fmtDuration(queueSecs)}` : ''}
                  </p>
                  <div class="d-card pod-list">
                    {p.queue.slice(0, allQ ? 30 : 3).map((ep) => (
                      <EpisodeRow ep={ep} showShow />
                    ))}
                  </div>
                </section>
              )}
              {p.subs.length > 0 ? (
                <section class="d-sec">
                  <Head icon="sparkle" title="New episodes" />
                  <EpisodeFilters value={epFilter} onChange={setEpFilter} />
                  {latest === null ? (
                    <p class="muted">
                      <span class="spinner small" /> Checking your podcasts…
                    </p>
                  ) : unplayed.length ? (
                    unplayed.map((ep) => <EpisodeRow ep={ep} podcast={ep.podcast} showShow />)
                  ) : (
                    <p class="muted">{epFilter === 'all' ? "You're all caught up." : 'Nothing new matches this filter.'}</p>
                  )}
                </section>
              ) : (
                <section class="d-sec">
                  <Empty icon="headphones" title="Find your podcasts">
                    Tap the search icon, paste a feed link, or import from another app (Shows tab).
                  </Empty>
                  <button class="btn ghost-wide" onClick={() => podTab.set('discover')}>
                    <Icon name="compass" size={16} /> See top podcasts
                  </button>
                </section>
              )}
            </>
          )}

          {tab === 'shows' && (
            <>
              <section class="d-sec">
                <Head icon="podcast" title={`Your shows${p.subs.length ? ` · ${p.subs.length}` : ''}`} />
                {p.subs.length ? <ShowGrid shows={p.subs} small /> : <p class="muted">No shows yet — search for one, or import from another app below.</p>}
              </section>
              {opml}
            </>
          )}

          {tab === 'discover' && (
            <>
              {picks.length > 0 && (
                <section class="d-sec">
                  <Head icon="star" title="Recommended episodes" />
                  <div class="pod-recs">
                    {picks.slice(0, 10).map((ep) => (
                      <button class="d-card pod-rec" onClick={() => playEpisode(ep, ep.podcast)}>
                        {ep.image || ep.podcast?.cover ? <Thumb class="pod-rec-art" src={ep.image || ep.podcast?.cover} size={400} /> : <div class="pod-rec-art ep-art-ph">♪</div>}
                        <div class="pod-rec-m">
                          <b>{ep.title}</b>
                          <small>
                            {ep.podcast?.title || ep.show}
                            {ep.duration ? ` · ${fmtDuration(ep.duration)}` : ''}
                          </small>
                          {ep.why && <em>{ep.why}</em>}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {(latest || []).length > 0 && (
                <section class="d-sec">
                  <Head icon="clock" title="Short listens" />
                  <div class="d-eq pod-eq3">
                    {[
                      ['20', 'Under 20 min'],
                      ['45', '20–45 min'],
                      ['long', '45 min+'],
                    ].map(([k, l]) => (
                      <button class={shortLen === k ? 'on' : ''} onClick={() => setShortLen(k)}>
                        {l}
                      </button>
                    ))}
                  </div>
                  {shortEps.length ? shortEps.map((ep) => <EpisodeRow ep={ep} podcast={ep.podcast} showShow />) : <p class="muted">Nothing new that length in your shows.</p>}
                </section>
              )}
              <section class="d-sec">
                <Head icon="grid" title="Top podcasts" />
                {charts === null ? <p class="muted">Loading…</p> : <ShowGrid shows={charts} />}
              </section>
            </>
          )}
        </>
      )}
      <div class="footer-space" />
    </div>
  );
}

export function Thumb({ src, size = 200, class: cls = '' }) {
  const [broken, setBroken] = useState(false);
  const small = pod.thumbUrl(src, size);
  return <img class={cls} src={broken ? src : small} alt="" loading="lazy" decoding="async" onError={() => small !== src && !broken && setBroken(true)} />;
}

export function ShowGrid({ shows, small }) {
  return (
    <div class={'show-grid' + (small ? ' small' : '')}>
      {shows.map((s) => (
        <button class="show-card" onClick={() => nav.push('podcast', { show: s })}>
          {s.cover ? <Thumb src={s.cover} size={small ? 160 : 240} /> : <div class="show-ph">{s.title?.[0]}</div>}
          <b>{s.title}</b>
          {!small && <small>{s.author}</small>}
        </button>
      ))}
    </div>
  );
}

/** A show: subscribe, description, all episodes. */
export function Podcast({ show }) {
  const p = useStore(pod.podcasts);
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const subscribed = p.subs.some((s) => s.feedUrl === show.feedUrl);
  useEffect(() => {
    let alive = true;
    pod
      .loadFeed(show.feedUrl)
      .then((f) => alive && setFeed(f))
      .catch((e) => alive && setError(e.message));
    return () => (alive = false);
  }, [show.feedUrl]);
  const info = { ...show, ...(feed?.podcast || {}) };
  const dls = useStore(downloads);
  useSelect(progress, progSig);
  const prog = progress.get();
  const [shown, setShown] = useState(40);
  const [showSet, setShowSet] = useState(false);
  const hasPrefs = !!useStore(pod.showPrefs)[show.feedUrl];
  const eps = (feed?.episodes || []).filter((e) => passes(e, filter, dls, prog));
  return (
    <div class="screen podcast">
      <TopBar title={info.title} />
      <div class="pod-hero">
        {info.cover && <Thumb src={info.cover} size={400} />}
        <div>
          <h2>{info.title}</h2>
          <p class="muted">{info.author}</p>
          <button
            class={'btn ' + (subscribed ? 'outline' : 'primary')}
            disabled={busy}
            onClick={async () => {
              if (subscribed) return pod.unsubscribe(show.feedUrl);
              setBusy(true);
              try {
                toast(`Subscribed to ${await pod.subscribe(show)}`);
              } catch (e) {
                toast(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <span class="spinner small" /> : <Icon name={subscribed ? 'check' : 'plus'} size={16} />} {subscribed ? 'Subscribed' : 'Subscribe'}
          </button>
        </div>
      </div>
      {info.description && <p class="pad pod-desc">{info.description.slice(0, 600)}</p>}
      <div class="pad-x">
        <button class={'pill small' + (hasPrefs ? ' active' : '')} onClick={() => setShowSet(!showSet)}>
          <Icon name="settings" size={14} /> Show settings{hasPrefs ? ' · on' : ''}
        </button>
      </div>
      {showSet && <ShowSettings feedUrl={show.feedUrl} />}
      <div class="pad-x">
        <EpisodeFilters value={filter} onChange={setFilter} extra={[['unplayed', 'Unplayed']]} />
      </div>
      <section class="pad">
        {error ? (
          <p class="err">{/feed|xml|parse/i.test(error) ? "That link isn't a podcast feed (RSS). Check it's the feed address, not the show's web page." : error}</p>
        ) : !feed ? (
          <p class="muted">
            <span class="spinner small" /> Loading episodes…
          </p>
        ) : eps.length ? (
          <>
            {eps.slice(0, shown).map((ep) => (
              <EpisodeRow ep={ep} podcast={info} />
            ))}
            {eps.length > shown && (
              <button class="btn ghost-wide" onClick={() => setShown(shown + 60)}>
                Show more ({eps.length - shown})
              </button>
            )}
          </>
        ) : (
          <p class="muted">No episodes match this filter.</p>
        )}
      </section>
      <div class="footer-space" />
    </div>
  );
}
