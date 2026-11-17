// An author's or narrator's page: photo and a short bio, your numbers with them, their
// books you have, their series, more of their books, who they often read with, Follow.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Cover, toast, Skeleton } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { nav } from '../lib/nav.js';
import { useStore, progress, library } from '../lib/store.js';
import { myRatings, rateKey } from '../lib/taste.js';
import { aiReady, askAi } from '../lib/ai.js';
import { fmtDuration, hashHue } from '../lib/format.js';
import { openExternal } from '../sources/summaries.js';
import { bioOf, yourBooks, moreBy, oftenWith, following, personKey, toggleFollow, personPhotos, photoOf, setPhoto, photoChoices, findPhoto } from '../lib/people.js';

const initials = (n) =>
  String(n || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

function Tile({ book, sub, pct, done }) {
  return (
    <button class="pp-tile" onClick={() => nav.push('book', { book })}>
      <span class="pp-cv">
        <Cover book={book} />
        {done && <em class="pp-done">✓ Done</em>}
        {pct > 0 && !done && (
          <i class="pp-bar">
            <b style={{ width: `${pct}%` }} />
          </i>
        )}
      </span>
      <b>{book.title}</b>
      {sub && <small>{sub}</small>}
    </button>
  );
}

const placeOf = (b) => ({ abs: 'Audiobookshelf', tb: 'TorBox', rd: 'Real-Debrid', loc: 'On this phone' })[String(b.source || b.uid || '').split(':')[0]] || '';

/** Their series you're in: where you are and the next one. */
function SeriesCards({ mine }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { seriesOf, seriesBooks, statusIn, nextIn } = await import('../lib/series.js');
      const seen = new Map();
      for (const { book } of mine) {
        const s = seriesOf(book);
        if (s?.name && !seen.has(s.name)) seen.set(s.name, book.author);
      }
      const out = [];
      for (const [name, author] of [...seen].slice(0, 3)) {
        const list = statusIn(await seriesBooks(name, author).catch(() => []));
        if (list.length > 1) out.push({ name, list, next: nextIn(list) });
      }
      if (alive) setRows(out);
    })();
    return () => (alive = false);
  }, [mine.map((x) => x.book.uid).join()]);
  if (!rows.length) return null;
  return (
    <section class="pp-sec">
      <h3 class="pp-h">Series</h3>
      {rows.map((r) => {
        const done = r.list.filter((x) => x.state === 'finished').length;
        return (
          <div class="pp-series">
            <span>
              <b>{r.name}</b>
              <small>
                {r.list.length} books · {done ? `${done} finished` : 'not started'}
              </small>
              <span class="pp-dots">
                {r.list.slice(0, 12).map((x) => (
                  <i class={x.state === 'finished' ? 'on' : x === r.next ? 'nx' : x.state ? 'have' : ''} />
                ))}
              </span>
            </span>
            {r.next && (
              <button class="pill small" onClick={() => nav.push('book', { book: r.next.book })}>
                Next ›
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function Person({ name, role = 'author' }) {
  const narrator = role === 'narrator';
  const [bio, setBio] = useState(null);
  const [more, setMore] = useState(null);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState('');
  const fol = useStore(following);
  const prog = useStore(progress);
  const lib = useStore(library);
  const ratings = useStore(myRatings);
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const mine = useMemo(() => yourBooks(name, role), [name, role, prog, lib]);
  useEffect(() => {
    let alive = true;
    setBio(null);
    setMore(null);
    bioOf(name).then((b) => {
      if (alive) setBio(b);
      // No photo from the bio: look in more places (kept once found).
      if (!b?.photo && !photoOf(name)) findPhoto(name, role).catch(() => {});
    });
    moreBy(name, role, mine).then((l) => alive && setMore(l));
    return () => {
      alive = false;
      audio.current?.pause();
    };
  }, [name, role]);
  const pics = useStore(personPhotos);
  const photo = pics[personKey(name)] || bio?.photo || '';
  const [picking, setPicking] = useState(false);
  const followed = !!fol[personKey(name)];
  const heard = mine.filter((x) => x.p?.finished).length;
  const hours = mine.reduce((a, x) => a + (x.p?.global || 0), 0);
  const liked = mine.filter((x) => ['love', 'like'].includes(ratings[rateKey(x.book)]?.verdict)).length;
  const rated = mine.filter((x) => ratings[rateKey(x.book)]?.verdict).length;
  const others = (more || []).filter((b) => !b.mine);
  const sample = (more || []).find((b) => b.sample)?.sample || '';
  const partners = narrator ? oftenWith(name, [...mine.map((x) => x.book), ...(more || [])]) : [];
  const hue = hashHue(name);

  const whereToStart = async () => {
    if (start) return setStart('');
    setBusy('start');
    try {
      const titles = [...mine.map((x) => x.book.title), ...others.map((b) => b.title)].slice(0, 25);
      const a = await askAi(
        `A listener wants to start with the ${narrator ? 'narrator' : 'author'} ${name}. ${titles.length ? `Their books include: ${titles.join('; ')}.` : ''} ${mine.length ? `The listener already has: ${mine.map((x) => x.book.title).join('; ')}.` : ''}
In 2 short sentences: which book to start with and why, then what to try next. No spoilers. Reply in plain text.`
      );
      setStart(a.trim());
    } catch (e) {
      toast(e.message);
    }
    setBusy('');
  };
  const hear = () => {
    if (!sample) return;
    if (!audio.current) {
      audio.current = new Audio(sample);
      audio.current.onended = () => setPlaying(false);
    }
    if (playing) audio.current.pause();
    else audio.current.play().catch((e) => toast(e.message));
    setPlaying(!playing);
  };

  return (
    <div class="screen person" style={{ '--pc': `hsl(${hue} 38% 52%)` }}>
      <div class="pp-hero">
        <header class="topbar transparent">
          <button class="icon-btn glass" onClick={() => nav.back()} aria-label="Back">
            <Icon name="back" />
          </button>
        </header>
        <button class="pp-av" aria-label={photo ? 'Change photo' : 'Add a photo'} onClick={() => setPicking(!picking)} style={{ background: `linear-gradient(140deg, hsl(${hue} 45% 55%), hsl(${hue} 50% 25%))` }}>
          {photo ? <img key={photo} src={photo} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} /> : null}
          <span>{initials(name)}</span>
          {!photo && (
            <em class="pp-av-add">
              <Icon name="camera" size={14} />
            </em>
          )}
        </button>
        {picking && <PhotoPicker name={name} role={role} current={photo} close={() => setPicking(false)} />}
        <h1>{name}</h1>
        <div class="pp-roles">
          <span>{narrator ? 'Narrator' : 'Author'}</span>
          {more && more.length > 0 && <span>{more.length}+ books</span>}
        </div>
        {bio == null ? (
          <div class="pp-bio mo-lines" aria-label="Loading">
            <span class="shimmer" /> <span class="shimmer" /> <span class="shimmer short" />
          </div>
        ) : bio.bio ? (
          <p class={'pp-bio' + (open ? ' open' : '')} onClick={() => setOpen(!open)}>
            {bio.bio}{' '}
            {bio.url && (
              <a
                onClick={(e) => {
                  e.stopPropagation();
                  openExternal(bio.url);
                }}
              >
                Read more
              </a>
            )}
          </p>
        ) : null}
        {bio?.facts && <p class="pp-facts">{bio.facts}</p>}
        <div class="pp-btns">
          <button
            class={'pp-btn pri' + (followed ? ' on' : '')}
            onClick={() => toast(toggleFollow(name, role) ? `Following ${name} — their new books show on Home` : `Not following ${name}`)}
          >
            {followed ? '✓ Following' : '＋ Follow'}
          </button>
          {narrator && sample ? (
            <button class="pp-btn" onClick={hear}>
              {playing ? '❚❚ Pause' : '▶ Hear the voice'}
            </button>
          ) : (
            aiReady() && (
              <button class="pp-btn" disabled={busy === 'start'} onClick={whereToStart}>
                {busy === 'start' ? <span class="spinner small" /> : '✦ Where to start'}
              </button>
            )
          )}
        </div>
      </div>

      {start && <div class="pp-ai">✦ {start}</div>}

      {mine.length > 0 && (
        <div class="pp-stats">
          <div>
            <b>{heard}</b>
            <small>finished</small>
          </div>
          <div>
            <b>{fmtDuration(hours)}</b>
            <small>listened</small>
          </div>
          <div>
            <b>{rated ? `👍 ${liked}` : mine.length}</b>
            <small>{rated ? 'liked' : 'yours'}</small>
          </div>
        </div>
      )}

      {mine.length > 0 && (
        <section class="pp-sec">
          <h3 class="pp-h">
            {narrator ? 'Read by them in your library' : 'In your library'} <small>{mine.length}</small>
          </h3>
          <div class="pp-row">
            {mine.slice(0, 20).map(({ book, p }) => (
              <Tile
                book={book}
                pct={p && !p.finished ? Math.round((p.percent || 0) * 100) : 0}
                done={!!p?.finished}
                sub={p?.finished ? 'Finished' : p ? [`${Math.round((p.percent || 0) * 100)}%`, placeOf(book)].filter(Boolean).join(' · ') : placeOf(book) || 'In your library'}
              />
            ))}
          </div>
        </section>
      )}

      {!narrator && <SeriesCards mine={mine} />}

      <section class="pp-sec">
        <h3 class="pp-h">
          {narrator ? 'More they’ve read' : 'More by them'} {others.length > 0 && <small>{others.length}</small>}
        </h3>
        {more == null ? (
          <div class="pp-row" aria-label="Looking">
            {[0, 1, 2, 3].map(() => (
              <Skeleton />
            ))}
          </div>
        ) : others.length ? (
          <div class="pp-row">
            {others.slice(0, 24).map((b) => (
              <Tile book={b} sub={[b.year, b.released && Date.now() - b.released < 90 * 864e5 ? 'New' : b.released > Date.now() ? 'Coming' : ''].filter(Boolean).join(' · ')} />
            ))}
          </div>
        ) : (
          <p class="muted">Nothing more found in the catalogue.</p>
        )}
      </section>

      {partners.length > 0 && (
        <section class="pp-sec">
          <h3 class="pp-h">Often reads with</h3>
          <div class="pp-pairs">
            {partners.map((n) => (
              <button class="pp-pair" onClick={() => nav.push('person', { name: n, role: 'narrator' })}>
                <i style={{ background: `hsl(${hashHue(n)} 45% 45%)` }}>{photoOf(n) ? <img src={photoOf(n)} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} /> : initials(n)}</i>
                {n}
              </button>
            ))}
          </div>
        </section>
      )}

      {narrator && rated > 0 && (
        <div class="pp-ai">
          You’ve liked <b>{liked}</b> of the {rated} books they read that you rated.
        </div>
      )}
      <div class="footer-space" />
    </div>
  );
}

/** Choose their photo: the ones found (Wikipedia, Open Library, Wikimedia), or your own picture. */
function PhotoPicker({ name, role, current, close }) {
  const [list, setList] = useState(null);
  const file = useRef(null);
  useEffect(() => {
    let alive = true;
    photoChoices(name, role)
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]));
    return () => (alive = false);
  }, [name]);
  const pick = (url) => (setPhoto(name, url), toast('Photo updated'), close());
  const own = async (e) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    try {
      pick(await shrink(f, 360));
    } catch (err) {
      toast(err.message);
    }
  };
  return (
    <div class="pp-pick">
      <div class="pp-pick-head">
        <b>Photo of {name}</b>
        <button class="icon-btn" aria-label="Close" onClick={close}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {list == null ? (
        <div class="pp-pick-grid" aria-label="Looking for photos">
          {[0, 1, 2, 3].map(() => (
            <span class="pp-pick-one">
              <span class="mo-circle shimmer" />
            </span>
          ))}
        </div>
      ) : list.length ? (
        <div class="pp-pick-grid">
          {list.map((x) => (
            <button class={'pp-pick-one' + (x.url === current ? ' on' : '')} onClick={() => pick(x.url)} aria-label={`Use this photo (${x.from})`}>
              <img src={x.url} alt="" loading="lazy" onError={(e) => (e.currentTarget.parentElement.style.display = 'none')} />
              <small>{x.from}</small>
            </button>
          ))}
        </div>
      ) : (
        <p class="muted small">No photos found online.</p>
      )}
      <div class="pp-pick-actions">
        <button class="pill small" onClick={() => file.current?.click()}>
          <Icon name="image" size={14} /> Your own picture
        </button>
        {current && (
          <button class="pill small" onClick={() => pick('')}>
            Remove photo
          </button>
        )}
      </div>
      <input ref={file} type="file" accept="image/*" hidden onChange={own} />
    </div>
  );
}

/** A picture made small enough to keep (a data URL). */
function shrink(file, max = 1100) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error("Couldn't open that picture"));
    img.src = URL.createObjectURL(file);
  });
}
