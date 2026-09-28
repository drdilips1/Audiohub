import { BgImage } from '../components/bg-image.jsx';
import { useEffect, useState } from 'preact/hooks';
import { Cover, SourceBadge, Row, toast } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { getDetails, findEditions, ia, hc, sourceOf } from '../sources/index.js';
import { library, progress, toggleLibrary, useStore } from '../lib/store.js';
import { fmtDuration, fmtTime } from '../lib/format.js';
import { nav } from '../lib/nav.js';
import * as qb from '../sources/qbit.js';
import { canSendToKindle, sendToKindle, shareEbook } from '../lib/kindle.js';
import { cloudReaderBook } from '../lib/epub.js';
import { openSearch } from './Discover.jsx';
import { mainTitle } from '../lib/match.js';
import { SourceResults } from '../components/source-results.jsx';
import { useRatings } from '../lib/ratings.js';
import { myRatings, rateKey, rateBook, clearRating, VERDICTS, PARTS, REASONS } from '../lib/taste.js';
import { narrate, canNarrate } from '../sources/ttsbooks.js';
import { nativeReader } from '../lib/tts.js';
import { downloads, canDownload, downloadBook, cancelDownload, removeDownload, fmtBytes } from '../lib/downloads.js';
import { sourceAddons } from '../sources/sourceaddons.js';
import * as player from '../lib/player.js';
import { usePlayer, useCoverColor } from '../components/player-ui.jsx';
import { RelatedRows } from '../components/related.jsx';
import { openUrl, openExternal, keyIdeas, savedSummary, summaryBook, aiReady } from '../sources/summaries.js';

// Books you already have (cloud, server, addons) can still show other copies from source addons.
const OTHER_SOURCES = new Set(['tb', 'rd', 'abs', 'addon']);

export function Book({ book: initial }) {
  const [book, setBook] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [editions, setEditions] = useState(null);
  const saved = !!useStore(library)[initial.uid];
  const allProgress = useStore(progress);
  const ps = usePlayer();
  const color = useCoverColor(book);
  const isCurrent = ps.book?.uid === book.uid;
  const [hcStatus, setHcStatus] = useState(null);
  const [listenBusy, setListenBusy] = useState(false);
  const [showParts, setShowParts] = useState(null);
  const [qbBusy, setQbBusy] = useState(false);
  const [kindleBusy, setKindleBusy] = useState(false);
  useStore(qb.qbitSent);
  const dl = useStore(downloads)[initial.uid];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getDetails(initial)
      .then((d) => alive && setBook(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    if (initial.kind === 'discover') findEditions(initial).then((e) => alive && setEditions(e));
    if (hc.connected()) hc.knownStatus(initial).then((st) => alive && setHcStatus(st || 0)).catch(() => alive && setHcStatus(0));
    return () => (alive = false);
  }, [initial.uid]);

  const listen = (opts) => {
    if (isCurrent && !opts) return player.toggle();
    nav.openOverlay('player');
    player.playBook(book, opts);
  };
  const canListen = book.kind === 'audio';
  // Ebook files in your TorBox / Real-Debrid: EPUB opens in the reader.
  const cloudEbooks = book.ebooks || [];
  const cloudEpub = cloudEbooks.find((e) => e.format === 'EPUB');
  const readBook = cloudEpub ? cloudReaderBook(book, cloudEpub) : book;
  const canRead = book.kind === 'text' && (book.readUrl || cloudEpub);
  const prog = allProgress[canRead ? readBook.uid : initial.uid];
  const tracks = book.tracks || [];
  const partsOpen = showParts ?? tracks.length <= 5;
  const pct = prog ? Math.round((prog.percent || 0) * 100) : 0;
  const authorKey = (book.author || '').split(',')[0].trim();

  return (
    <div class="screen book" style={color ? { '--dyn': color } : null}>
      <div class="book-hero">
        <div class="book-hero-bg">{book.cover && <BgImage url={book.cover} />}</div>
        <header class="topbar transparent">
          <button class="icon-btn glass" onClick={() => nav.back()} aria-label="Back">
            <Icon name="back" />
          </button>
          <span />
          <button
            class={'icon-btn glass' + (saved ? ' liked' : '')}
            aria-label={saved ? 'Remove from library' : 'Save to library'}
            onClick={() => {
              toggleLibrary(book);
              toast(saved ? 'Removed from library' : 'Saved to library');
            }}
          >
            <Icon name="heart" fill={saved} />
          </button>
        </header>
        <div class="book-hero-content">
          <Cover book={book} class="book-cover" eager />
          <h1>{book.title}</h1>
          {book.author && <p class="book-author">{book.author}</p>}
          <div class="book-meta">
            <SourceBadge uid={book.uid} book={book} />
            {book.year && <span>{book.year}</span>}
            {book.duration > 0 && <span>{fmtDuration(book.duration)}</span>}
            {tracks.length > 1 && <span>{tracks.length} parts</span>}
            {book.narrator && <span>Narrated by {book.narrator}</span>}
            {book.series && <span>{book.series}</span>}
            {book.language && <span>{book.language}</span>}
          </div>
          <RatingsRow book={book} />
        </div>
      </div>

      <div class="book-actions">
        {canListen && (
          <button class="btn primary big" disabled={loading && !book.tracks} onClick={() => listen()}>
            {loading && !isCurrent ? <span class="spinner" /> : <Icon name={isCurrent && ps.playing ? 'pause' : 'play'} size={18} />}
            {isCurrent && ps.playing ? 'Pause' : pct > 0 && !prog.finished ? `Resume · ${pct}%` : 'Listen now'}
          </button>
        )}
        {canSendToKindle(book) && (
          <button
            class="btn secondary big kindle-btn"
            disabled={kindleBusy}
            onClick={async () => {
              setKindleBusy(true);
              try {
                await sendToKindle(book);
              } catch (e) {
                toast(e.message);
              } finally {
                setKindleBusy(false);
              }
            }}
          >
            {kindleBusy ? <span class="spinner" /> : <Icon name="upload" size={18} />} Send to Kindle
          </button>
        )}
        {canRead && (
          <button class="btn primary big" onClick={() => nav.push('reader', { book: readBook })}>
            <Icon name="book" size={18} /> {pct > 0 ? `Continue · ${pct}%` : 'Read'}
          </button>
        )}
        {canRead && (
          <button
            class="btn secondary big"
            disabled={listenBusy}
            onClick={async () => {
              // Android: the native engine reads in the reader (keeps going screen-off);
              // elsewhere, without a voice set up, read along in the browser.
              if (nativeReader || !canNarrate()) return nav.push('reader', { book: readBook, readAloud: true });
              setListenBusy(true);
              try {
                const audio = await narrate(readBook);
                nav.openOverlay('player');
                player.playBook(audio);
              } catch (e) {
                toast(e.message);
              } finally {
                setListenBusy(false);
              }
            }}
          >
            {listenBusy ? <span class="spinner" /> : <Icon name="headphones" size={18} />} Listen
          </button>
        )}
        {book.link && (
          <a class="btn ghost" href={book.link} target="_blank" rel="noopener">
            <Icon name="external" size={16} />
          </a>
        )}
      </div>
      {cloudEbooks.length > 0 && <CloudEbooks book={book} files={cloudEbooks} />}
      {((canListen && canDownload && book.source !== 'tts') || (book.hash && (book.source === 'tb' || book.source === 'rd') && qb.available)) && (
        <div class="book-tools">
          {canListen && canDownload && book.source !== 'tts' &&
            (!dl || dl.status === 'error' ? (
              <button
                class="tool"
                disabled={loading && !book.tracks && !book.resolveTracks}
                onClick={() => downloadBook(book).then(() => toast('Downloaded — plays offline now')).catch((e) => e.message !== 'cancelled' && toast(e.message))}
              >
                <span class="tool-icon">
                  <Icon name="download" size={18} />
                </span>
                <span class="tool-text">
                  <b>{dl?.status === 'error' ? 'Retry download' : 'Offline'}</b>
                  <small>{dl?.status === 'error' ? dl.error || 'Download failed' : 'Save to this phone'}</small>
                </span>
              </button>
            ) : dl.status === 'done' ? (
              <button class="tool done" onClick={() => confirm('Remove the download from this phone?') && removeDownload(book.uid).then(() => toast('Download removed'))}>
                <span class="tool-icon">
                  <Icon name="check" size={18} />
                </span>
                <span class="tool-text">
                  <b>On this phone</b>
                  <small>{fmtBytes(dl.bytes)} · tap to remove</small>
                </span>
              </button>
            ) : (
              <button class="tool busy" onClick={() => confirm('Stop downloading?') && cancelDownload(book.uid)}>
                <span class="tool-icon">
                  <span class="spinner small" />
                </span>
                <span class="tool-text">
                  <b>
                    Part {Math.min((dl.done || 0) + 1, dl.total || 1)} of {dl.total || '…'}
                    {dl.currentTotal > 0 ? ` · ${Math.round((dl.current / dl.currentTotal) * 100)}%` : ''}
                  </b>
                  <span class="progress-bar">
                    <span style={{ width: `${dl.total ? (((dl.done || 0) + (dl.currentTotal ? dl.current / dl.currentTotal : 0)) / dl.total) * 100 : 2}%` }} />
                  </span>
                </span>
              </button>
            ))}
          {book.hash && (book.source === 'tb' || book.source === 'rd') && qb.available && (
            <button
              class={'tool' + (qb.wasSent(book.hash) ? ' done' : '')}
              disabled={qbBusy}
              onClick={async () => {
                if (!qb.configured()) return toast('Set up your home server first (Settings → Home server)');
                if (qb.wasSent(book.hash) && !confirm('Already sent to your home server. Send it again?')) return;
                const have = !qb.wasSent(book.hash) && (await qb.onServer(book).catch(() => 'down'));
                if (have === 'down' && !confirm("Couldn't reach your Audiobookshelf to check whether you already have this. Send it home anyway?")) return;
                if (have && have !== 'down' && !confirm(`Your Audiobookshelf already has “${have.title}”. Send it home again anyway?`)) return;
                setQbBusy(true);
                try {
                  toast(await qb.send(book));
                } catch (e) {
                  toast(e.message);
                } finally {
                  setQbBusy(false);
                }
              }}
            >
              <span class="tool-icon">{qbBusy ? <span class="spinner small" /> : <Icon name={qb.wasSent(book.hash) ? 'check' : 'server'} size={18} />}</span>
              <span class="tool-text">
                <b>Home server</b>
                <small>{qb.wasSent(book.hash) ? 'Sent · tap to resend' : 'Send to qBittorrent'}</small>
              </span>
            </button>
          )}
        </div>
      )}
      {pct > 0 && (
        <div class="progress-bar book-progress">
          <div style={{ width: pct + '%' }} />
        </div>
      )}

      {!loading && book.source !== 'sum' && book.source !== 'pod' && <MyRating book={book} />}

      {error && <p class="err pad">Couldn't load details: {error}</p>}

      {book.description && (
        <section class="pad">
          <p class={'description' + (expanded ? ' open' : '')} onClick={() => setExpanded(!expanded)}>
            {book.description}
          </p>
          {book.description.length > 280 && (
            <button class="link-btn" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </section>
      )}

      {book.metaSource && <p class="muted pad meta-credit">Details from {book.metaSource}</p>}
      {book.subjects?.length > 0 && (
        <div class="chips pad">
          {book.subjects.slice(0, 8).map((s) => (
            <span class="pill small">{s}</span>
          ))}
        </div>
      )}

      {hc.connected() && hcStatus !== null && (
        <section class="pad">
          <h3 class="section-label">Hardcover</h3>
          <div class="chips">
            {[
              [hc.STATUS.want, 'Want to read'],
              [hc.STATUS.reading, 'Reading'],
              [hc.STATUS.read, 'Read'],
            ].map(([code, label]) => (
              <button
                class={'pill small' + (hcStatus === code ? ' active' : '')}
                onClick={async () => {
                  try {
                    setHcStatus(await hc.setStatus(book, code));
                    toast(`Hardcover: ${label}`);
                  } catch (e) {
                    toast(e.message);
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {book.kind === 'discover' && (
        <section class="pad">
          <h3 class="section-label">Where to listen or read</h3>
          {!editions ? (
            <p class="muted">Searching your server, cloud, addons and free sources…</p>
          ) : ['server', 'cloud', 'addons', 'audio', 'text'].every((k) => !editions[k].length) && !sourceAddons().length ? (
            <>
              <p class="muted">
                Not found in {editions.searched.join(', ')}. Your TorBox and Real-Debrid search only covers files already in your account, so add the book there first (Settings → TorBox → add a magnet or link) or install an addon that searches for it.
              </p>
              <button class="btn ghost-wide" onClick={() => openSearch(mainTitle(book.title))}>
                <Icon name="search" size={16} /> Search everything for “{mainTitle(book.title)}”
              </button>
            </>
          ) : null}
        </section>
      )}
      {editions?.server?.length > 0 && <Row title="On your server" subtitle="Audiobookshelf" icon="server" items={editions.server} />}
      {editions?.cloud?.length > 0 && <Row title="In your cloud" subtitle="TorBox / Real-Debrid" icon="download" items={editions.cloud} />}
      {editions?.addons?.length > 0 && <Row title="From your addons" subtitle="Addon results" icon="puzzle" items={editions.addons} />}
      {book.kind === 'discover' && sourceAddons().length > 0 && (
        <SourceResults title={mainTitle(book.title)} author={(book.author || '').split(',')[0].trim()} book={book} />
      )}
      {((book.kind === 'audio' && OTHER_SOURCES.has(book.source)) || book.kind === 'text') && sourceAddons().length > 0 && !loading && (
        <section class="pad">
          <h3 class="section-label">
            <Icon name="puzzle" size={16} /> Other sources
          </h3>
          <SourceResults title={mainTitle(book.title)} author={(book.author || '').split(',')[0].trim()} book={book} heading={false} />
        </section>
      )}
      {editions?.audio?.length > 0 && <Row title="Free audiobooks" subtitle="LibriVox / Internet Archive" icon="headphones" items={editions.audio} />}
      {editions?.text?.length > 0 && <Row title="Free ebooks" subtitle="Project Gutenberg" icon="book" items={editions.text} />}

      {tracks.length > 0 && (
        <section class="pad">
          <button class="section-label parts-toggle" onClick={() => setShowParts(!partsOpen)}>
            <Icon name="library" size={16} /> {tracks.length} {tracks.length === 1 ? 'part' : 'parts'}
            {tracks.length > 5 && <Icon name={partsOpen ? 'up' : 'down'} size={16} />}
          </button>
          <ol class="chapter-list flat">
            {tracks.map((t, i) => {
              // Folded: only the part you're on (or the first) is listed.
              const here = isCurrent ? ps.index : prog?.track || 0;
              if (!partsOpen && i !== here) return null;
              const active = isCurrent && ps.index === i;
              const done = prog && (prog.track > i || prog.finished);
              return (
                <li class={(active ? 'active ' : '') + (done ? 'done' : '')}>
                  <button onClick={() => listen({ index: i, time: 0 })}>
                    <span class="ch-num">{active && ps.playing ? <span class="eq on"><i /><i /><i /></span> : done ? <Icon name="check" size={14} /> : i + 1}</span>
                    <span class="ch-title">{t.title}</span>
                    <span class="ch-time">{t.duration ? fmtTime(t.duration) : ''}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {authorKey && sourceOf(book.uid) === 'ia' && (
        <Row
          title={`More from ${authorKey}`}
          icon="sparkle"
          load={() => ia.query(`creator:("${authorKey.replace(/"/g, '')}")`, { rows: 15 }).then((r) => r.filter((b) => b.uid !== book.uid))}
          deps={[book.uid, authorKey]}
        />
      )}
      {!loading && book.source !== 'sum' && <Summaries book={book} />}
      {!loading && <RelatedRows book={book} />}
      <div class="footer-space" />
    </div>
  );
}

/** Key ideas (Tanga / Blinkist style): made by your AI service on request, then kept. */
function Summaries({ book }) {
  const [sum, setSum] = useState(() => savedSummary(book));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const have = savedSummary(book);
    setSum(have);
    setErr('');
    // Written straight away when an AI service is set up (then kept, so only once per book).
    if (!have && aiReady()) make();
  }, [book.uid]);
  const make = async () => {
    setBusy(true);
    setErr('');
    try {
      setSum(await keyIdeas(book));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const sb = summaryBook(book);
  return (
    <section class="pad summaries">
      <h3 class="section-label">
        <Icon name="text" size={16} /> Key ideas
      </h3>
      <div class="sum-card">
        {sum ? (
          <>
            <div class="sum-head">
              <b>{sum.tagline || 'The book in a few minutes'}</b>
              <small>
                {sum.ideas.length} key ideas · {sum.minutes} min read{sum.fromDescription ? ' · from the publisher’s description' : ''}
              </small>
            </div>
            <p class="sum-about">{sum.about}</p>
            <ol class="sum-ideas">
              {sum.ideas.map((i) => (
                <li>{i.title}</li>
              ))}
            </ol>
            <div class="sum-actions">
              <button class="btn primary" onClick={() => nav.push('reader', { book: sb })}>
                <Icon name="book" size={16} /> Read
              </button>
              <button class="btn secondary" onClick={() => nav.push('reader', { book: sb, readAloud: true })}>
                <Icon name="headphones" size={16} /> Listen
              </button>
            </div>
          </>
        ) : aiReady() ? (
          <>
            <p class="muted">The main ideas of this book in about 10 minutes — to read, or to listen to with your voice.</p>
            {err && <p class="err">{err}</p>}
            <button class="btn primary" disabled={busy} onClick={make}>
              {busy ? <span class="spinner" /> : <Icon name="sparkle" size={16} />} {busy ? 'Writing the summary…' : 'Get key ideas'}
            </button>
          </>
        ) : (
          <p class="muted">
            Key ideas are written by a free AI service —{' '}
            <button class="link-btn" onClick={() => nav.tab('settings')}>
              add a Groq key in Settings → AI
            </button>
            .
          </p>
        )}
      </div>
    </section>
  );
}

/** Ebook files in the user's TorBox / Real-Debrid item. */
function CloudEbooks({ book, files }) {
  const [busy, setBusy] = useState('');
  const share = async (f, i) => {
    setBusy('s' + i);
    try {
      await shareEbook(f, book);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };
  return (
    <section class="pad cloud-ebooks">
      <h3 class="section-label">
        <Icon name="book" size={16} /> Ebook files
      </h3>
      {files.map((f, i) => (
        <div class="cloud-ebook">
          <span class="fmt-chip">{f.format}</span>
          <div class="cloud-ebook-name">
            <b>{f.name}</b>
            {f.size > 1e5 && <small>{fmtBytes(f.size)}</small>}
          </div>
          {f.format === 'EPUB' && (
            <button class="pill small" onClick={() => nav.push('reader', { book: cloudReaderBook(book, f) })}>
              Read
            </button>
          )}
          <button class="pill small ghost" disabled={busy === 's' + i} onClick={() => share(f, i)} aria-label="Send to Kindle or open in another app">
            {busy === 's' + i ? <span class="spinner small" /> : <Icon name="upload" size={14} />} Kindle / app
          </button>
        </div>
      ))}
      <p class="muted small">"Kindle / app" opens Android's share menu: pick Kindle to send it there, or any reader app (Play Books, ReadEra, Moon+).</p>
    </section>
  );
}

const fmtK = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));

/** Ratings across services and awards, as a row of badges: "4.6 (1.2k)"; tap one for its reviews. */
function RatingsRow({ book }) {
  const { goodreads, awards, why } = useRatings(book);
  if (!goodreads && !awards.length) return why ? <p class="ratings-why">No rating found — {why}</p> : null;
  const Badge = ({ r, cls, logo, digits }) => (
    <button class={'rt ' + cls} title={`${r.from} — ${r.count.toLocaleString()} ratings. Tap for reviews`} onClick={() => r.url && openExternal(r.url)}>
      <span class="rt-logo">{logo}</span>
      <b>{r.rating.toFixed(digits)}</b>
      {r.count > 0 && <small>({fmtK(r.count)})</small>}
    </button>
  );
  return (
    <div class="ratings-row">
      {goodreads && <Badge r={goodreads} cls="rt-goodreads" logo="g" digits={2} />}
      {awards.map((a) => (
        <span class={'rt rt-award rt-' + a.kind} title={a.label}>
          <span class="rt-trophy">{a.kind === 'audie' ? '🏆' : '🎧'}</span>
          <b>{a.label}</b>
        </span>
      ))}
    </div>
  );
}

/** Your own verdict: how you found it, the story and the narration, and why if it didn't work. Feeds your picks. */
function MyRating({ book }) {
  const all = useStore(myRatings);
  const mine = all[rateKey(book)];
  const r = mine?.verdict ? mine : null;
  const [open, setOpen] = useState(false);
  const down = r && (r.verdict === 'dislike' || r.verdict === 'dnf');
  const Chips = ({ label, field, options }) => (
    <div class="myrate-row">
      <span class="myrate-label">{label}</span>
      <div class="chips">
        {options.map(([k, text]) => (
          <button class={'pill small' + (r?.[field] === k ? ' active' : '')} onClick={() => rateBook(book, { [field]: r?.[field] === k ? '' : k })}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <section class="myrate pad">
      <div class="myrate-head">
        <h3>Your verdict</h3>
        {r && (
          <button class="link-btn" onClick={() => (clearRating(book), setOpen(false))}>
            Clear
          </button>
        )}
      </div>
      <div class="myrate-verdicts">
        {VERDICTS.map(([k, emoji, label]) => (
          <button
            class={'myrate-v' + (r?.verdict === k ? ' on' : '')}
            title={label}
            onClick={() => {
              rateBook(book, { verdict: k });
              setOpen(true);
            }}
          >
            <span class="myrate-emoji">{emoji}</span>
            <small>{label}</small>
          </button>
        ))}
      </div>
      {r && (open || r.story || r.narration || r.reasons?.length) && (
        <div class="myrate-more">
          <Chips label="Story" field="story" options={PARTS} />
          {book.kind !== 'text' && <Chips label="Narration" field="narration" options={PARTS} />}
          {down && (
            <div class="myrate-row">
              <span class="myrate-label">Why</span>
              <div class="chips">
                {REASONS.map((x) => {
                  const on = (r.reasons || []).includes(x);
                  return (
                    <button class={'pill small' + (on ? ' active' : '')} onClick={() => rateBook(book, { reasons: on ? r.reasons.filter((y) => y !== x) : [...(r.reasons || []), x] })}>
                      {x}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <p class="muted small">Your ratings shape the picks in For you and on Home. Narrators you mark weak are kept out.</p>
        </div>
      )}
    </section>
  );
}
