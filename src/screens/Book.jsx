import { metaNow, lookup, metaFixes } from "../lib/meta.js";
import { preferredCopy, preferredFor, setPreferred, judge, workKey } from "../lib/editions.js";
import { findOwned, localSrc as phoneSrc } from "../sources/index.js";
import { BgImage } from "../components/bg-image.jsx";
import { BookBookmarks } from '../components/bookmarks.jsx';
import { useEffect, useRef, useState } from "preact/hooks";
import {
  Cover,
  SourceBadge,
  Row,
  BookCard,
  toast,
} from "../components/common.jsx";
import { Icon } from "../components/icons.jsx";
import {
  getDetails,
  findEditions,
  ia,
  hc,
  sourceOf,
} from "../sources/index.js";
import { library, progress, toggleLibrary, useStore } from "../lib/store.js";
import { BookTags } from "../components/book-tags.jsx";
import { fmtDuration, fmtTime } from "../lib/format.js";
import { nav, useBackClose } from "../lib/nav.js";
import * as qb from "../sources/qbit.js";
import { canSendToKindle, sendToKindle, shareEbook } from "../lib/kindle.js";
import { cloudReaderBook } from "../lib/epub.js";
import { openSearch } from "./Discover.jsx";
import { mainTitle, searchTitle, matches, surname } from "../lib/match.js";
import { STARTERS } from "../lib/askbook.js";
import { SourceResults } from "../components/source-results.jsx";
import { FixDetails } from "../components/fix-details.jsx";
import { Available } from "../components/available.jsx";
import { SeriesCard } from "../components/series-card.jsx";
import { useRatings, useGoodreads } from "../lib/ratings.js";
import {
  myRatings,
  rateKey,
  rateBook,
  clearRating,
  VERDICTS,
  PARTS,
  REASONS,
} from "../lib/taste.js";
import { narrate, canNarrate } from "../sources/ttsbooks.js";
import { nativeReader } from "../lib/tts.js";
import {
  downloads,
  canDownload,
  downloadBook,
  cancelDownload,
  removeDownload,
  fmtBytes,
} from "../lib/downloads.js";
import { sourceAddons } from "../sources/sourceaddons.js";
import * as player from "../lib/player.js";
import { usePlayerBasics, useCoverColor } from "../components/player-ui.jsx";
import { RelatedRows } from "../components/related.jsx";
import { openExternal } from "../sources/summaries.js";
import { useStoryShots, chooseStoryShots } from "../sources/storyshots.js";
import { finishLine } from "../lib/stats.js";
import { absUploads } from "../lib/absupload.js";

// Books you already have (cloud, server, addons) can still show other copies from source addons.
const OTHER_SOURCES = new Set(["tb", "rd", "abs", "addon"]);

/** "Send to Audiobookshelf" under way (or failed) for this book. */
function AbsSending({ uid }) {
  const u = useStore(absUploads)[uid];
  if (!u || (u.status === 'done' && Date.now() - (u.at || 0) > 6 * 3600e3)) return null;
  const text =
    u.status === 'downloading' ? 'Sending to Audiobookshelf: downloading to the phone first…'
    : u.status === 'uploading' ? `Sending to Audiobookshelf: uploading ${Math.round((u.pct || 0) * 100)}%`
    : u.status === 'done' ? `On your Audiobookshelf${u.library ? ` (${u.library})` : ''} ✓`
    : `Couldn't send to Audiobookshelf: ${u.error || 'unknown error'}`;
  return <p class={'book-finish' + (u.status === 'error' ? ' bad' : '')}>{text}</p>;
}

export function Book({ book: initial }) {
  const [book, setBook] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const gr = useGoodreads(book);
  const [editions, setEditions] = useState(null);
  const saved = !!useStore(library)[initial.uid];
  const allProgress = useStore(progress);
  const ps = usePlayerBasics();
  const color = useCoverColor(book);
  const isCurrent = ps.book?.uid === book.uid;
  const [hcStatus, setHcStatus] = useState(null);
  const [listenBusy, setListenBusy] = useState(false);
  const [showParts, setShowParts] = useState(null);
  const [qbBusy, setQbBusy] = useState(false);
  const [kindleBusy, setKindleBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  useStore(qb.qbitSent);
  const dl = useStore(downloads)[initial.uid];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getDetails(initial)
      .then((d) => {
        if (!alive) return;
        setBook(d);
        // Fetch the audio link now, so Play starts at once.
        if (d.kind === "audio" && player.getState().book?.uid !== d.uid) player.prepare(d);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    if (initial.kind === "discover")
      findEditions(initial).then((e) => alive && setEditions(e));
    if (hc.connected())
      hc.knownStatus(initial)
        .then((st) => alive && setHcStatus(st || 0))
        .catch(() => alive && setHcStatus(0));
    return () => (alive = false);
  }, [initial.uid]);

  // Details you edited by hand (⋯ → Edit title, author, narrator): shown at once.
  useEffect(
    () =>
      metaFixes.subscribe((all) => {
        const f = all?.[initial.uid];
        if (f?.edited) setBook((b) => ({ ...b, title: f.title || b.title, author: f.author ?? b.author, narrator: f.narrator ?? b.narrator, series: f.series ?? b.series, year: f.year || b.year }));
      }),
    [initial.uid],
  );
  const listen = (opts) => {
    if (isCurrent && !opts) return player.toggle();
    nav.openOverlay("player");
    // The copy you chose to play first (Your copies): that one, exactly.
    const pref = preferredFor(book);
    if (pref && pref.uid !== book.uid)
      return getDetails(pref)
        .then((d) => player.playBook(d, { ...(opts || {}), exact: true }))
        .catch(() => player.playBook(book, opts));
    player.playBook(book, pref?.uid === book.uid ? { ...(opts || {}), exact: true } : opts);
  };
  const canListen = book.kind === "audio";
  // Ebook files in your TorBox / Real-Debrid: EPUB opens in the reader.
  const cloudEbooks = book.ebooks || [];
  const cloudEpub = cloudEbooks.find((e) => e.format === "EPUB");
  const readBook = cloudEpub ? cloudReaderBook(book, cloudEpub) : book;
  // Phone ebooks, saved ones and direct links open in the reader too (Read, never Play).
  const canRead = book.kind === "text" && (book.readUrl || cloudEpub || book.ebookUrl || /#ebook$/.test(book.uid));
  const prog = allProgress[canRead ? readBook.uid : initial.uid];
  const tracks = book.tracks || [];
  const partsOpen = showParts ?? tracks.length <= 5;
  const pct = prog ? Math.round((prog.percent || 0) * 100) : 0;
  const authorKey = (book.author || "").split(",")[0].trim();
  // What Sources search with: a cloud / phone file's tidy title and author (found or picked —
  // "The Selfish Gene Unabridged 2_005" with no author is "The Selfish Gene", Richard Dawkins),
  // so its results aren't all "loose matches".
  const found = metaNow(book) || metaNow(initial);
  const fileNamed = ["tb", "rd", "loc", "addon"].includes(book.source);
  const srcTitle = searchTitle((found?.fixed || fileNamed) && found?.title ? found.title : book.title);
  const srcAuthor = ((found?.fixed || !book.author) && found?.author ? found.author : book.author || "").split(",")[0].trim();

  return (
    <div class="screen book" style={color ? { "--dyn": color } : null}>
      <div class="book-hero">
        <div class="book-hero-bg">
          {book.cover && <BgImage url={book.cover} />}
        </div>
        <header class="topbar transparent">
          <button
            class="icon-btn glass"
            onClick={() => nav.back()}
            aria-label="Back"
          >
            <Icon name="back" />
          </button>
          <span />
          <div class="topbar-right">
            {book.source !== "pod" && (
              <button
                class="icon-btn glass"
                aria-label="More"
                onClick={() => setMenu(true)}
              >
                <Icon name="more" stroke={3.2} />
              </button>
            )}
          </div>
        </header>
        <div class="book-hero-content">
          <Cover book={book} class="book-cover" eager />
          <h1>{book.title}</h1>
          {book.author && <p class="book-author">{book.author}</p>}
          {book.narrator && (
            <p class="book-narrator">Read by {book.narrator}</p>
          )}
          <HeroFacts book={book} tracks={tracks} />
          <div class="book-meta">
            <SourceBadge uid={book.uid} book={book} />
            {book.series && <span>{book.series}</span>}
          </div>
          {!loading &&
            !book.cover &&
            book.source !== "pod" &&
            book.source !== "sum" && (
              <FixDetails
                book={book}
                onFixed={(f) => setBook((b) => ({ ...b, ...f }))}
              />
            )}
        </div>
      </div>

      <div class="book-body">
      {book.source !== "pod" && book.source !== "sum" && (
        <Available book={book} editions={editions} />
      )}
      {book.source !== "pod" && book.source !== "sum" && <SeriesCard book={book} />}
      <StoryShotsLink book={book} />
      <div class="book-actions">
        {book.kind === "discover" && (
          <button
            class="btn primary big"
            onClick={() =>
              document
                .getElementById("where-to-get")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            <Icon name="headphones" size={18} /> Where to get it
          </button>
        )}
        {canListen && (
          <button
            class="btn primary big"
            disabled={loading && !book.tracks}
            onClick={() => listen()}
          >
            {loading && !isCurrent ? (
              <span class="spinner" />
            ) : (
              <Icon
                name={isCurrent && ps.playing ? "pause" : "play"}
                size={18}
              />
            )}
            {isCurrent && ps.playing
              ? "Pause"
              : pct > 0 && !prog.finished
                ? `Resume · ${pct}%`
                : "Listen now"}
          </button>
        )}
        {canRead && (
          <button
            class="btn primary big"
            onClick={() => nav.push("reader", { book: readBook })}
          >
            <Icon name="book" size={18} />{" "}
            {pct > 0 ? `Continue · ${pct}%` : "Read"}
          </button>
        )}
        {canRead && (
          <button
            class="btn secondary big"
            disabled={listenBusy}
            onClick={async () => {
              // Android: the native engine reads in the reader (keeps going screen-off);
              // elsewhere, without a voice set up, read along in the browser.
              if (nativeReader || !canNarrate())
                return nav.push("reader", { book: readBook, readAloud: true });
              setListenBusy(true);
              try {
                const audio = await narrate(readBook);
                nav.openOverlay("player");
                player.playBook(audio);
              } catch (e) {
                toast(e.message);
              } finally {
                setListenBusy(false);
              }
            }}
          >
            {listenBusy ? (
              <span class="spinner" />
            ) : (
              <Icon name="headphones" size={18} />
            )}{" "}
            Listen
          </button>
        )}
        {/* Quiet squares beside the main button: save to phone, your library, Kindle. */}
        {canListen && canDownload && book.source !== "tts" && book.source !== "loc" && (
          <button
            class={"btn secondary big sq" + (dl?.status === "done" ? " ok" : "")}
            aria-label={dl?.status === "done" ? "On this phone — remove" : dl?.status === "downloading" ? "Stop downloading" : "Download to this phone"}
            disabled={!dl && loading && !book.tracks && !book.resolveTracks}
            onClick={() => {
              if (dl?.status === "done") return confirm("Remove the download from this phone?") && removeDownload(book.uid).then(() => toast("Download removed"));
              if (dl?.status === "downloading") return confirm("Stop downloading?") && cancelDownload(book.uid);
              downloadBook(book, { resume: !!dl })
                .then(() => downloads.get()[book.uid]?.status === "done" && toast("Downloaded — plays offline now"))
                .catch((e) => e.message !== "cancelled" && toast(e.message));
            }}
          >
            {dl?.status === "downloading" ? <span class="spinner small" /> : <Icon name={dl?.status === "done" ? "check" : "download"} size={20} />}
          </button>
        )}
        {book.source !== "pod" && (
          <button
            class={"btn secondary big sq" + (saved ? " liked" : "")}
            aria-label={saved ? "Remove from library" : "Add to library"}
            onClick={() => {
              toggleLibrary(book);
              toast(saved ? "Removed from your library" : "Added to your library");
            }}
          >
            <Icon name="heart" size={20} fill={saved} />
          </button>
        )}
        {canSendToKindle(book) && (
          <button
            class="btn secondary big sq"
            aria-label="Send to Kindle"
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
            {kindleBusy ? <span class="spinner small" /> : <Icon name="upload" size={20} />}
          </button>
        )}
      </div>
      {cloudEbooks.length > 0 && (
        <CloudEbooks book={book} files={cloudEbooks} />
      )}
      {/* Downloading: how far it is (the square beside Play starts and stops it). */}
      {dl?.status === "downloading" && (
        <div class="book-dl">
          <span>
            Saving to this phone · part {Math.min((dl.done || 0) + 1, dl.total || 1)} of {dl.total || "…"}
            {dl.currentTotal > 0 ? ` · ${Math.round((dl.current / dl.currentTotal) * 100)}%` : ""}
          </span>
          <span class="progress-bar">
            <span style={{ width: `${dl.total ? (((dl.done || 0) + (dl.currentTotal ? dl.current / dl.currentTotal : 0)) / dl.total) * 100 : 2}%` }} />
          </span>
        </div>
      )}
      {(dl?.status === "error" || dl?.status === "paused") && (
        <p class="book-dl-note">
          {dl.status === "error" ? dl.error || "The download stopped" : `${dl.done || 0} of ${dl.total || "?"} parts saved`} — tap <Icon name="download" size={13} /> to {dl.status === "error" ? "try again" : "carry on"}
        </p>
      )}
      {(book.hash &&
          (book.source === "tb" || book.source === "rd") &&
          qb.available) && (
        <div class="book-tools">
          {book.hash &&
            (book.source === "tb" || book.source === "rd") &&
            qb.available && (
              <button
                class={"tool" + (qb.wasSent(book.hash) ? " done" : "")}
                disabled={qbBusy}
                onClick={async () => {
                  if (!qb.configured())
                    return toast(
                      "Set up your home server first (Settings → Home server)",
                    );
                  if (
                    qb.wasSent(book.hash) &&
                    !confirm("Already sent to your home server. Send it again?")
                  )
                    return;
                  const have =
                    !qb.wasSent(book.hash) &&
                    (await qb.onServer(book).catch(() => "down"));
                  if (
                    have === "down" &&
                    !confirm(
                      "Couldn't reach your Audiobookshelf to check whether you already have this. Send it home anyway?",
                    )
                  )
                    return;
                  if (
                    have &&
                    have !== "down" &&
                    !confirm(
                      `Your Audiobookshelf already has “${have.title}”. Send it home again anyway?`,
                    )
                  )
                    return;
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
                <span class="tool-icon">
                  {qbBusy ? (
                    <span class="spinner small" />
                  ) : (
                    <Icon
                      name={qb.wasSent(book.hash) ? "check" : "server"}
                      size={18}
                    />
                  )}
                </span>
                <span class="tool-text">
                  <b>Home server</b>
                  <small>
                    {qb.wasSent(book.hash)
                      ? "Sent · tap to resend"
                      : "Send to qBittorrent"}
                  </small>
                </span>
              </button>
            )}
        </div>
      )}
      {pct > 0 && (
        <div class="book-prog">
          <small>
            {prog.finished ? "Finished" : `${pct}% ${canRead ? "read" : "listened"}`}
            {!prog.finished && !canRead && book.duration > 0 ? ` · ${fmtDuration(book.duration * (1 - pct / 100))} left` : ""}
          </small>
          <div class="progress-bar book-progress">
            <div style={{ width: pct + "%" }} />
          </div>
        </div>
      )}
      {book.partsCheck && <BookCheck check={book.partsCheck} />}
      {canListen && <CopiesCheck book={book} />}
      <AbsSending uid={initial.uid} />
      {pct > 0 && !prog.finished && !canRead && finishLine(initial.uid) && <p class="book-finish">{finishLine(initial.uid)}</p>}

      {error &&
        (book.source === 'abs' ? (
          <p class="err pad">Your Audiobookshelf server isn't answering ({error}). Play still works: it uses your copy on the phone or in TorBox / Real-Debrid when there is one.</p>
        ) : (
          <p class="err pad">Couldn't load details: {error}</p>
        ))}

      <Description
        text={bestDescription(book.description, gr?.description)}
        expanded={expanded}
        setExpanded={setExpanded}
      />
      {book.source !== "sum" && book.source !== "pod" && (
        <AskCard
          book={book}
          description={bestDescription(book.description, gr?.description)}
          genres={(gr?.genres || []).map((g) => g.name)}
        />
      )}
      {gr && <GoodreadsCard gr={gr} />}

      {book.metaSource && (
        <p class="muted pad meta-credit">Details from {book.metaSource}</p>
      )}
      {book.subjects?.length > 0 && !gr?.genres?.length && (
        <div class="chips pad">
          {book.subjects.slice(0, 8).map((s) => (
            <span class="pill small">{s}</span>
          ))}
        </div>
      )}

      {/* Your verdict and your tags: one line, just above the source results. */}
      {!loading && book.source !== "sum" && book.source !== "pod" && (
        <MyRating book={book}>
          <BookTags book={book} inline />
        </MyRating>
      )}
      {book.kind === "discover" && (
        <section class="pad" id="where-to-get">
          <h3 class="section-label">Where to listen or read</h3>
          {!editions ? (
            <p class="muted">
              Searching your server, cloud, addons and free sources…
            </p>
          ) : ["server", "cloud", "addons", "audio", "text"].every(
              (k) => !editions[k].length,
            ) && !sourceAddons().length ? (
            <>
              <p class="muted">
                Not found{editions.searched.length ? ` in ${editions.searched.join(", ")}` : ""}. Your TorBox and
                Real-Debrid search only covers files already in your account, so
                add the book there first (Settings → TorBox → add a magnet or
                link) or install an addon that searches for it.
              </p>
              <button
                class="btn ghost-wide"
                onClick={() => openSearch(mainTitle(book.title))}
              >
                <Icon name="search" size={16} /> Search everything for “
                {mainTitle(book.title)}”
              </button>
            </>
          ) : null}
        </section>
      )}
      <YourCopies editions={editions} />
      {book.kind === "discover" && sourceAddons().length > 0 && !loading && (
        <SourceResults
          title={srcTitle}
          author={srcAuthor}
          book={book}
        />
      )}
      {((book.kind === "audio" && OTHER_SOURCES.has(book.source)) ||
        book.kind === "text") &&
        sourceAddons().length > 0 &&
        !loading && (
          <section class="pad">
            <SourceResults
              title={srcTitle}
              author={srcAuthor}
              book={book}
            />
          </section>
        )}
      {editions?.audio?.length > 0 && (
        <Row
          title="Free audiobooks"
          subtitle="LibriVox / Internet Archive"
          icon="headphones"
          items={editions.audio}
        />
      )}
      {editions?.text?.length > 0 && (
        <Row
          title="Free ebooks"
          subtitle="Project Gutenberg"
          icon="book"
          items={editions.text}
        />
      )}

      <BookBookmarks book={book} />

      {tracks.length > 0 && (
        <section class="pad">
          <button
            class="section-label parts-toggle"
            onClick={() => setShowParts(!partsOpen)}
          >
            <Icon name="library" size={16} />
            <span class="parts-sum">
              <b>
                {tracks.length} {tracks.length === 1 ? "file" : "files"}
              </b>
              {!partsOpen && (
                <small>
                  {/* Folded: which file you're on — the list opens on tap. */}
                  you're on {(isCurrent ? ps.index : prog?.track || 0) + 1} ·{" "}
                  {tracks[isCurrent ? ps.index : prog?.track || 0]?.title}
                </small>
              )}
            </span>
            {tracks.length > 5 && (
              <span class="parts-more">
                {partsOpen ? "Hide" : "Show all"}
                <Icon name={partsOpen ? "up" : "down"} size={14} />
              </span>
            )}
          </button>
          {partsOpen && <ol class="chapter-list flat">
            {tracks.map((t, i) => {
              // Folded: only the part you're on (or the first) is listed.
              const here = isCurrent ? ps.index : prog?.track || 0;
              if (!partsOpen && i !== here) return null;
              const active = isCurrent && ps.index === i;
              const done = prog && (prog.track > i || prog.finished);
              return (
                <li class={(active ? "active " : "") + (done ? "done" : "")}>
                  <button onClick={() => listen({ index: i, time: 0 })}>
                    <span class="ch-num">
                      {active && ps.playing ? (
                        <span class="eq on">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : done ? (
                        <Icon name="check" size={14} />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span class="ch-title">{t.title}</span>
                    <span class="ch-time">
                      {t.duration ? fmtTime(t.duration) : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>}
        </section>
      )}

      {authorKey && sourceOf(book.uid) === "ia" && (
        <Row
          title={`More from ${authorKey}`}
          icon="sparkle"
          load={() =>
            ia
              .query(`creator:("${authorKey.replace(/"/g, "")}")`, { rows: 15 })
              .then((r) => r.filter((b) => b.uid !== book.uid))
          }
          deps={[book.uid, authorKey]}
        />
      )}
      {!loading && <RelatedRows book={book} />}
      <div class="footer-space" />
      </div>
      {menu && (
        <BookMenu
          book={book}
          onClose={() => setMenu(false)}
          onFixed={(f) => setBook((b) => ({ ...b, ...f }))}
          hcStatus={hcStatus}
          setHcStatus={setHcStatus}
        />
      )}
    </div>
  );
}

/** "Audio summary on StoryShots", when they have one: opens it in their app. */
function StoryShotsLink({ book }) {
  const ss = useStoryShots(book, { always: true });
  if (!ss) return null;
  return (
    <button class="ss-link" onClick={() => chooseStoryShots(book, ss)}>
      <span class={"ss-badge" + (ss.ep ? "" : " outline")}>S</span>{" "}
      {ss.ep ? "StoryShots audio summary" : "Summary in StoryShots"}
    </button>
  );
}

/** Ebook files in the user's TorBox / Real-Debrid item. */
function CloudEbooks({ book, files }) {
  const [busy, setBusy] = useState("");
  const share = async (f, i) => {
    setBusy("s" + i);
    try {
      await shareEbook(f, book);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy("");
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
          {(f.format === "EPUB" || f.format === "PDF") && (
            <button
              class="pill small"
              onClick={() =>
                nav.push("reader", { book: cloudReaderBook(book, f) })
              }
            >
              Read
            </button>
          )}
          <button
            class="pill small ghost"
            disabled={busy === "s" + i}
            onClick={() => share(f, i)}
            aria-label="Send to Kindle or open in another app"
          >
            {busy === "s" + i ? (
              <span class="spinner small" />
            ) : (
              <Icon name="upload" size={14} />
            )}{" "}
            Kindle / app
          </button>
        </div>
      ))}
      <p class="muted small">
        "Kindle / app" opens Android's share menu: pick Kindle to send it there,
        or any reader app (Play Books, ReadEra, Moon+).
      </p>
    </section>
  );
}

const fmtK = (n) =>
  n >= 1e6
    ? (n / 1e6).toFixed(1) + "M"
    : n >= 1000
      ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + "k"
      : String(n);

/** Ratings across services and awards, as a row of badges: "4.6 (1.2k)"; tap one for its reviews. */
/** Rating · length · year in one strip, Apple Books style. Tap the rating for reviews. */
/**
 * Your copies of this book, side by side: where, narrator, length, format — each compared with
 * the full audiobook's length (Audible): FULL, ABRIDGED?, MAYBE INCOMPLETE, OTHER NARRATOR.
 * Tap the circle to choose the copy Play uses. Shown when there's more than one, or one is short.
 */
function CopiesCheck({ book }) {
  const local = useStore(phoneSrc.localCfg);
  const prefs = useStore(preferredCopy);
  const [owned, setOwned] = useState(null);
  const [full, setFull] = useState(null);
  useEffect(() => {
    let alive = true;
    setOwned(null);
    setFull(null);
    findOwned(book).then((o) => alive && setOwned(o), () => alive && setOwned({ server: [], cloud: [] }));
    lookup(book).then((m) => alive && setFull(m && m.runtime > 0 ? m : null), () => {});
    return () => (alive = false);
  }, [book.uid]);
  const t = mainTitle(book.title || "");
  const sn = surname(book.author || "");
  const same = (b) => b && b.kind !== "text" && matches(t, `${b.title || ""} ${b.rawName || ""}`) && (!sn || !b.author || surname(b.author) === sn);
  const seen = new Set();
  const copies = [book, ...(local.books || []).filter(same), ...(owned?.server || []).filter(same), ...(owned?.cloud || []).filter(same)].filter((c) => c?.uid && !seen.has(c.uid) && seen.add(c.uid));
  const judged = copies.map((c) => ({ c, j: judge(c, full) }));
  const short = judged.some(({ j }) => j.tag === "abridged" || j.tag === "incomplete");
  if (copies.length < 2 && !short) return null;
  const pref = prefs[workKey(book)]?.uid || "";
  const WHERE = { loc: "On this phone", abs: "Your Audiobookshelf", tb: "TorBox", rd: "Real-Debrid", url: "Link" };
  const TAG = { full: ["FULL", "ok"], abridged: ["ABRIDGED?", "warn"], incomplete: ["MAYBE INCOMPLETE", "bad"] };
  const hm = (s) => fmtDuration(s);
  return (
    <section class="copies-check">
      <h4>
        Your copies · {copies.length}
        {full?.runtime > 0 && <small> · full audiobook {hm(full.runtime)}</small>}
      </h4>
      {judged.map(({ c, j }, k) => {
        const chosen = pref ? pref === c.uid : k === 0;
        const note =
          j.tag === "abridged" ? `About ${Math.round(j.ratio * 100)}% of the full audiobook's length — probably a shortened edition.`
          : j.tag === "incomplete" ? `${hm(Math.max(0, full.runtime - j.len))} shorter than the full audiobook — parts may be missing.`
          : "";
        return (
          <div class={"cc-copy" + (chosen ? " on" : "")}>
            <div class="cc-top">
              <b>{WHERE[c.source] || c.addonName || "Copy"}</b>
              <button class={"cc-radio" + (chosen ? " on" : "")} aria-label="Play this copy first" onClick={() => (setPreferred(book, c), toast(`Play uses ${WHERE[c.source] || "this copy"} for this book`))} />
            </div>
            <small class="cc-meta">{[c.narrator && `Read by ${c.narrator}`, j.len > 0 && hm(j.len), c.format].filter(Boolean).join(" · ") || "Length not known yet"}</small>
            {j.ratio > 0 && (
              <div class="cc-bar">
                <span>
                  <i class={TAG[j.tag]?.[1] || ""} style={{ width: Math.min(100, Math.round(j.ratio * 100)) + "%" }} />
                </span>
                <small>{j.tag === "full" ? "complete" : `${Math.round(j.ratio * 100)}% length`}</small>
              </div>
            )}
            <div class="cc-tags">
              {TAG[j.tag] && <span class={"cc-tag " + TAG[j.tag][1]}>{TAG[j.tag][0]}</span>}
              {j.otherNarrator && <span class="cc-tag">OTHER NARRATOR</span>}
              {c.partsCheck?.missing?.length > 0 && <span class="cc-tag">PART{c.partsCheck.missing.length > 1 ? "S" : ""} {c.partsCheck.missing.slice(0, 3).join(", ")} MISSING</span>}
              {chosen && copies.length > 1 && <span class="cc-tag">PLAYS FIRST</span>}
            </div>
            {note && <small class="cc-note">{note}</small>}
          </div>
        );
      })}
      {!full && copies.length > 1 && <small class="cc-foot">The full audiobook's length wasn't found, so copies aren't compared yet.</small>}
    </section>
  );
}

/**
 * Book check (multipart books): a part missing from the numbering, duplicate copies skipped,
 * parts put back in number order. Shown only when there's something to say.
 */
function BookCheck({ check }) {
  const items = [];
  const list = (ns) => (ns.length > 3 ? `${ns.slice(0, 3).join(", ")}…` : ns.join(ns.length === 2 ? " and " : ", "));
  if (check.missing?.length)
    items.push({
      warn: true,
      title: check.missing.length === 1 ? `Part ${check.missing[0]} seems to be missing` : `Parts ${list(check.missing)} seem to be missing`,
      sub: "The numbering skips them — the player says so when it gets there. Another copy (Available, Sources) may have them.",
    });
  if (check.dupes?.length)
    items.push({ title: `${check.dupes.length} duplicate part${check.dupes.length === 1 ? "" : "s"} skipped`, sub: check.dupes.slice(0, 3).map((n) => `“${n}”`).join(", ") });
  else if (check.dupesFound?.length && check.kept)
    items.push({ warn: true, title: `${check.dupesFound.length} duplicate part${check.dupesFound.length === 1 ? "" : "s"}`, sub: "Left as they are while you're in the middle of the book — skipped when you start it again" });
  if (check.reordered) items.push({ title: "Parts put back in order", sub: "By their numbers, not the file names' sort or dates" });
  else if (check.outOfOrder && check.kept) items.push({ warn: true, title: "Some parts are out of order", sub: "Left as they are while you're in the middle of the book — put in order when you start it again" });
  if (!items.length) return null;
  return (
    <section class="book-check">
      <h4>
        Book check <small>· when it opened</small>
      </h4>
      {items.map((x) => (
        <div class="bc-item">
          <span class={"bc-ic" + (x.warn ? " warn" : "")}>{x.warn ? "!" : <Icon name="check" size={13} />}</span>
          <div>
            <b>{x.title}</b>
            <small>{x.sub}</small>
          </div>
        </div>
      ))}
    </section>
  );
}

/** Under the title, two quiet lines: length · parts · year · language, then the ratings. */
function HeroFacts({ book, tracks }) {
  const { goodreads, audible } = useRatings(book);
  // When the lookups don't answer (busy, offline): the book's own catalogue stars (Audible results carry them).
  const own = !goodreads && !audible && book.rating > 0 ? { rating: Number(book.rating), count: Number(book.ratings) || 0 } : null;
  const facts = [
    book.duration > 0 && fmtDuration(book.duration),
    tracks.length > 1 && `${tracks.length} parts`,
    book.year,
    book.language && String(book.language).slice(0, 12),
  ].filter(Boolean);
  const rates = [
    goodreads && { r: goodreads, label: "Goodreads", d: 2 },
    audible && { r: audible, label: "Audible", d: 1 },
    own && { r: own, label: "", d: 1 },
  ].filter(Boolean);
  return (
    <>
      {facts.length > 0 && <p class="book-facts">{facts.join(" · ")}</p>}
      {rates.length > 0 && (
        <div class="book-rates">
          {rates.map(({ r, label, d }) => (
            <button class="book-rate" onClick={() => r.url && openExternal(r.url)}>
              <Icon name="star" size={13} fill /> <b>{r.rating.toFixed(d)}</b>
              {label ? ` ${label}` : ""}
              {r.count > 0 ? ` · ${fmtK(r.count)}` : ""}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Your own verdict: how you found it, the story and the narration, and why if it didn't work. Feeds your picks. */
function MyRating({ book, children }) {
  const all = useStore(myRatings);
  const mine = all[rateKey(book)];
  const r = mine?.verdict ? mine : null;
  const [open, setOpen] = useState(false);
  const down = r && (r.verdict === "dislike" || r.verdict === "dnf");
  const Chips = ({ label, field, options }) => (
    <div class="myrate-row">
      <span class="myrate-label">{label}</span>
      <div class="chips">
        {options.map(([k, text]) => (
          <button
            class={"pill small" + (r?.[field] === k ? " active" : "")}
            onClick={() =>
              rateBook(book, { [field]: r?.[field] === k ? "" : k })
            }
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <section class="myrate pad myrate-line">
      <div class="myrate-verdicts">
        {VERDICTS.map(([k, emoji, label]) => (
          <button
            class={"myrate-v" + (r?.verdict === k ? " on" : "")}
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
        {children && <span class="myrate-sep" />}
        {children}
      </div>
      {r && (open || r.story || r.narration || r.reasons?.length) && (
        <div class="myrate-more">
          <Chips label="Story" field="story" options={PARTS} />
          {book.kind !== "text" && (
            <Chips label="Narration" field="narration" options={PARTS} />
          )}
          {down && (
            <div class="myrate-row">
              <span class="myrate-label">Why</span>
              <div class="chips">
                {REASONS.map((x) => {
                  const on = (r.reasons || []).includes(x);
                  return (
                    <button
                      class={"pill small" + (on ? " active" : "")}
                      onClick={() =>
                        rateBook(book, {
                          reasons: on
                            ? r.reasons.filter((y) => y !== x)
                            : [...(r.reasons || []), x],
                        })
                      }
                    >
                      {x}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <p class="muted small">
            <button class="link-btn" onClick={() => (clearRating(book), setOpen(false))}>
              Clear verdict
            </button>{" "}
            · Your ratings shape the picks in For you and on Home. Narrators you
            mark weak are kept out.
          </p>
        </div>
      )}
    </section>
  );
}

// Listings often carry a shortened blurb ("…and…"); Goodreads has the full description.
function bestDescription(own, fromGr) {
  const a = String(own || "").trim();
  const b = String(fromGr || "").trim();
  if (!b) return a;
  const cut = /(\.\.\.|…)\s*$/.test(a);
  return !a || cut || b.length > a.length * 1.15 ? b : a;
}

/** The description, 5 lines at first; "Read more" only when there's more to show. */
function Description({ text, expanded, setExpanded }) {
  const ref = useRef(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el && !expanded) setMore(el.scrollHeight > el.clientHeight + 4);
  }, [text, expanded]);
  if (!text) return null;
  return (
    <section class="pad">
      <p
        ref={ref}
        class={"description" + (expanded ? " open" : "")}
        onClick={() => more && setExpanded(!expanded)}
      >
        {text}
      </p>
      {(more || expanded) && (
        <button class="link-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </section>
  );
}

/** Goodreads, as a small tile: rating, top genres, and links to rate or read reviews there. */
function GoodreadsCard({ gr }) {
  return (
    <section class="gr-card gr-tile">
      <button class="gr-main" onClick={() => openExternal(gr.url)}>
        <span class="gr-logo">g</span>
        <span class="gr-text">
          <b>Goodreads</b>
          {gr.rating > 0 ? (
            <small>
              <Icon name="star" size={12} fill /> {gr.rating.toFixed(2)}
              {gr.count > 0 && ` · ${fmtK(gr.count)} ratings`}
              {gr.reviews > 0 && ` · ${fmtK(gr.reviews)} reviews`}
            </small>
          ) : (
            <small>Reviews and ratings</small>
          )}
        </span>
        <Icon name="external" size={16} />
      </button>
      {gr.genres?.length > 0 && (
        <div class="gr-genres">
          {gr.genres.slice(0, 5).map((g) => (
            <button class="gr-genre" onClick={() => openExternal(g.url)}>
              {g.name}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** ⋯ More: the things you need now and then — fix details, Hardcover shelf, web page. */
function BookMenu({ book, onClose, onFixed, hcStatus, setHcStatus }) {
  useBackClose(true, onClose);
  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div class="sheet book-menu" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <h3>{mainTitle(book.title)}</h3>
        {book.source !== "sum" && (
          <div class="menu-block">
            <b>Cover & details</b>
            <FixDetails
              book={book}
              onFixed={(f) => {
                onFixed(f);
                onClose();
              }}
            />
          </div>
        )}
        {hc.connected() && hcStatus !== null && (
          <div class="menu-block">
            <b>Hardcover shelf</b>
            <div class="chips">
              {[
                [hc.STATUS.want, "Want to read"],
                [hc.STATUS.reading, "Reading"],
                [hc.STATUS.read, "Read"],
              ].map(([code, label]) => (
                <button
                  class={"pill small" + (hcStatus === code ? " active" : "")}
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
          </div>
        )}
        {book.link && (
          <button
            class="menu-item"
            onClick={() => {
              openExternal(book.link);
              onClose();
            }}
          >
            <Icon name="external" size={18} /> Open the web page
          </button>
        )}
        <button class="menu-item quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Missing or wrong cover / title? Search Audible and Google Books and pick the right one. */
/** Ask AI about this book: one slim row of one-tap questions, and "Ask…" for your own. */
function AskCard({ book, description, genres }) {
  const open = (extra = {}) =>
    nav.push("ask", { book, description, genres, ...extra });
  const QUICK = [
    ["What's it about?", STARTERS[0]],
    ["5 key ideas", STARTERS[1]],
    ["Worth my time?", STARTERS[2]],
  ];
  return (
    <div class="ask-chips pad">
      {QUICK.map(([label, q]) => (
        <button class="pill small" onClick={() => open({ question: q, askId: `${Date.now()}` })}>
          {label === QUICK[0][0] && <Icon name="ai" size={14} />} {label}
        </button>
      ))}
      <button class="pill small" onClick={() => open()}>
        Ask…
      </button>
    </div>
  );
}

/** Your copies side by side in one row — server, cloud, addons — each labelled where it is. */
function YourCopies({ editions }) {
  const items = [
    ...(editions?.server || []).map((b) => ["server", "Audiobookshelf", b]),
    ...(editions?.cloud || []).map((b) => ["download", b.source === "rd" ? "Real-Debrid" : "TorBox", b]),
    ...(editions?.addons || []).map((b) => ["puzzle", b.addonName || "Addon", b]),
  ];
  if (!items.length) return null;
  return (
    <section class="row your-copies">
      <header class="row-head">
        <h3>Your copies</h3>
      </header>
      <div class="row-scroll">
        {items.map(([icon, where, b]) => (
          <div class="copy-col">
            <small class="copy-where">
              <Icon name={icon} size={13} /> {where}
            </small>
            <BookCard book={b} />
          </div>
        ))}
      </div>
    </section>
  );
}
