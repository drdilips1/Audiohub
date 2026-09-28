import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../components/icons.jsx';
import { toast, Empty, TopBar } from '../components/common.jsx';
import { useStore, progress, useStoreKey } from '../lib/store.js';
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
  const played = !!p.played[ep.uid] || !!prog?.finished;
  const queued = p.queue.some((q) => q.uid === ep.uid);
  const current = ps.book?.uid === ep.uid;
  const pct = prog && !prog.finished ? Math.round((prog.percent || 0) * 100) : 0;
  const left = ep.duration && prog && !prog.finished ? ep.duration - (prog.global || prog.time || 0) : 0;
  return (
    <div class={'ep' + (played ? ' played' : '') + (current ? ' current' : '')}>
      <div class="ep-main" onClick={() => setOpen(!open)}>
        {showShow && (ep.image || ep.podcast?.cover || podcast?.cover) && <img class="ep-art" src={ep.image || ep.podcast?.cover || podcast?.cover} alt="" loading="lazy" />}
        <div class="ep-text">
          {showShow && <small class="ep-show">{ep.podcast?.title || ep.show || podcast?.title}</small>}
          <b>{ep.title}</b>
          <small>
            {ago(ep.date)}
            {ep.duration ? ` · ${left > 60 ? `${fmtDuration(left)} left` : fmtDuration(ep.duration)}` : ''}
            {played ? ' · Played' : ''}
            {dl?.status === 'done' ? ' · Downloaded' : dl?.status === 'downloading' ? ' · Downloading…' : ''}
          </small>
          {pct > 0 && (
            <div class="progress-mini ep-prog">
              <div style={{ width: pct + '%' }} />
            </div>
          )}
        </div>
      </div>
      <div class="ep-actions">
        <button class="icon-btn ep-play" aria-label={current && ps.playing ? 'Pause' : 'Play'} onClick={() => (current ? player.toggle() : playEpisode(ep, podcast))}>
          <Icon name={current && ps.playing ? 'pause' : 'play'} size={18} />
        </button>
        <button class={'icon-btn' + (queued ? ' on' : '')} aria-label={queued ? 'Remove from Up Next' : 'Add to Up Next'} onClick={() => (queued ? pod.dequeue(ep.uid) : (pod.enqueue(ep, podcast || ep.podcast), toast('Added to Up Next')))}>
          <Icon name={queued ? 'check' : 'list'} size={18} />
        </button>
        {canDownload && dl?.status !== 'done' && (
          <button
            class="icon-btn"
            aria-label="Download"
            disabled={dl?.status === 'downloading'}
            onClick={() =>
              downloadBook(pod.asBook(ep, podcast || ep.podcast))
                .then(() => toast('Episode downloaded'))
                .catch((e) => toast(e.message))
            }
          >
            <Icon name="download" size={18} />
          </button>
        )}
        <button class="icon-btn" aria-label={played ? 'Mark unplayed' : 'Mark played'} onClick={() => pod.markPlayed(ep, !played)}>
          <Icon name="check" size={16} />
        </button>
      </div>
      {open && ep.notes && <p class="ep-notes">{ep.notes}</p>}
    </div>
  );
}

export function Podcasts() {
  const p = useStore(pod.podcasts);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [latest, setLatest] = useState(null);
  const [charts, setCharts] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  // New episodes across subscriptions (cached feeds first, then refreshed).
  useEffect(() => {
    if (!p.subs.length) return setLatest([]);
    let alive = true;
    pod.refreshAll().then((r) => alive && setLatest(r));
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
    const t = setTimeout(() => pod.search(term).then((r) => alive && setResults(r)).catch(() => alive && setResults([])), 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const addFeed = async () => {
    setBusy(true);
    try {
      toast(`Subscribed to ${await pod.subscribe(q.trim())}`);
      setQ('');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
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
  const unplayed = (latest || []).filter((e) => !pod.isPlayed(e)).slice(0, 25);

  return (
    <div class="screen podcasts">
      <header class="pod-head">
        <h1 class="screen-title">Podcasts</h1>
        <div class="pod-tools">
          <button class="icon-btn" aria-label="Refresh" disabled={busy} onClick={refresh}>
            {busy ? <span class="spinner small" /> : <Icon name="down" size={18} />}
          </button>
        </div>
      </header>
      <div class="search-box">
        <Icon name="search" size={20} />
        <input value={q} placeholder="Search podcasts or paste a feed link" onInput={(e) => setQ(e.currentTarget.value)} enterkeyhint="search" />
        {q && (
          <button class="icon-btn" onClick={() => setQ('')} aria-label="Clear">
            <Icon name="close" size={18} />
          </button>
        )}
      </div>
      {isFeed && (
        <button class="btn ghost-wide" disabled={busy} onClick={addFeed}>
          <Icon name="plus" size={16} /> Subscribe to this feed
        </button>
      )}

      {results ? (
        <section class="pad">
          <h3 class="section-label">Results</h3>
          <ShowGrid shows={results} />
          {!results.length && <p class="muted">No podcasts found.</p>}
        </section>
      ) : (
        <>
          {p.queue.length > 0 && (
            <section class="pad">
              <h3 class="section-label">
                <Icon name="list" size={16} /> Up next <small>{p.queue.length}</small>
              </h3>
              {p.queue.slice(0, 20).map((ep) => (
                <EpisodeRow ep={ep} showShow />
              ))}
            </section>
          )}
          {p.subs.length > 0 && (
            <section class="pad">
              <h3 class="section-label">
                <Icon name="headphones" size={16} /> Subscriptions <small>{p.subs.length}</small>
              </h3>
              <ShowGrid shows={p.subs} small />
            </section>
          )}
          {p.subs.length > 0 && (
            <section class="pad">
              <h3 class="section-label">
                <Icon name="sparkle" size={16} /> New episodes
              </h3>
              {latest === null ? (
                <p class="muted">
                  <span class="spinner small" /> Checking your podcasts…
                </p>
              ) : unplayed.length ? (
                unplayed.map((ep) => <EpisodeRow ep={ep} podcast={ep.podcast} showShow />)
              ) : (
                <p class="muted">You're all caught up.</p>
              )}
            </section>
          )}
          {!p.subs.length && (
            <section class="pad">
              <Empty icon="headphones" title="Find your podcasts">
                Search above, paste a feed link, or import an OPML file from another app (AntennaPod, Pocket Casts…).
              </Empty>
              <h3 class="section-label">Top podcasts</h3>
              {charts === null ? <p class="muted">Loading…</p> : <ShowGrid shows={charts} />}
            </section>
          )}
          <section class="pad pod-opml">
            <button class="pill small" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={14} /> Import OPML
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
        </>
      )}
      <div class="footer-space" />
    </div>
  );
}

export function ShowGrid({ shows, small }) {
  return (
    <div class={'show-grid' + (small ? ' small' : '')}>
      {shows.map((s) => (
        <button class="show-card" onClick={() => nav.push('podcast', { show: s })}>
          {s.cover ? <img src={s.cover} alt="" loading="lazy" /> : <div class="show-ph">{s.title?.[0]}</div>}
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
  const eps = (feed?.episodes || []).filter((e) => filter === 'all' || !pod.isPlayed(e));
  return (
    <div class="screen podcast">
      <TopBar title={info.title} />
      <div class="pod-hero">
        {info.cover && <img src={info.cover} alt="" />}
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
      <div class="segmented pad-x">
        <button class={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          All episodes
        </button>
        <button class={filter === 'new' ? 'on' : ''} onClick={() => setFilter('new')}>
          Unplayed
        </button>
      </div>
      <section class="pad">
        {error ? <p class="err">{error}</p> : !feed ? <p class="muted"><span class="spinner small" /> Loading episodes…</p> : eps.map((ep) => <EpisodeRow ep={ep} podcast={info} />)}
      </section>
      <div class="footer-space" />
    </div>
  );
}
