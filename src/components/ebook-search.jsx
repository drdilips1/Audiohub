// Library → Ebooks: one search across the ebooks on this phone, in your TorBox /
// Real-Debrid cloud, and in your source results (direct EPUB / PDF links), with
// Read / Save right there.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Cover, toast } from './common.jsx';
import { Icon } from './icons.jsx';
import { nav } from '../lib/nav.js';
import { useStore } from '../lib/store.js';
import { matches } from '../lib/match.js';
import { localSrc, cloud } from '../sources/index.js';
import { savedEbooks, loadCloudEbook, directEbookFile, directReaderBook } from '../lib/epub.js';
import { searchSources } from '../sources/sourceaddons.js';

const READER = /#ebook$/;
const fmtMb = (n) => (n ? ` · ${(n / 1048576).toFixed(1)} MB` : '');

export function EbookSearchBox({ q, setQ }) {
  return (
    <div class="ebook-search">
      <Icon name="search" size={16} />
      <input type="text" enterkeyhint="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Find an ebook — phone, cloud, sources" />
      {q && (
        <button class="icon-btn" aria-label="Clear" onClick={() => setQ('')}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

export function EbookSearchResults({ q }) {
  const local = useStore(localSrc.localCfg);
  const kept = useStore(savedEbooks);
  const [cloudHits, setCloudHits] = useState(null);
  const [srcHits, setSrcHits] = useState(null);
  const [busy, setBusy] = useState('');
  const term = q.trim();

  // On the phone: right away, as you type.
  const seen = new Set();
  const phone = [...Object.values(kept || {}).map((x) => x?.book), ...(local.books || []).filter((b) => b.kind === 'text')].filter((b) => {
    if (!b || seen.has(b.uid) || !matches(term, `${b.title || ''} ${b.author || ''} ${b.ebookName || ''}`)) return false;
    seen.add(b.uid);
    return true;
  });

  // Cloud and sources: once typing settles.
  const run = useRef(0);
  useEffect(() => {
    setCloudHits(null);
    setSrcHits(null);
    if (term.length < 2) return;
    const id = ++run.current;
    const t = setTimeout(() => {
      if (cloud.tbConnected() || cloud.rdConnected())
        cloud
          .search(term)
          .then((r) => id === run.current && setCloudHits(r.filter((b) => b.kind === 'text' || (b.ebooks || []).length)))
          .catch(() => id === run.current && setCloudHits([]));
      else setCloudHits([]);
      const found = [];
      searchSources({ title: '', author: '', query: term }, (name, results) => {
        for (const r of results || []) {
          const file = !(r.magnet || r.hash) && directEbookFile(r);
          if (!file || found.some((x) => x.r.link === r.link)) continue;
          found.push({ r, file, source: name, book: directReaderBook(r, file, { title: r.title, author: r.author || '' }) });
        }
        if (id === run.current) setSrcHits([...found].sort((a, b) => rank(a) - rank(b)));
      }).then(() => id === run.current && setSrcHits((h) => h || []));
    }, 700);
    return () => clearTimeout(t);
  }, [term]);

  const save = async (h) => {
    setBusy(h.r.link);
    try {
      await loadCloudEbook(h.book);
      toast('Saved on this phone — Library → Ebooks → Downloaded');
    } catch (e) {
      toast(e.message);
    }
    setBusy('');
  };

  return (
    <div class="ebook-results">
      <h3 class="section-label pad">On this phone</h3>
      {phone.length ? (
        phone.slice(0, 20).map((b) => (
          <button class="lib-row" onClick={() => nav.push(READER.test(b.uid) ? 'reader' : 'book', { book: b })}>
            <Cover book={b} />
            <div>
              <b>{b.title}</b>
              <small>
                {b.author || ''}
                {b.ebookFormat || b.format ? ` · ${b.ebookFormat || b.format}` : ''}
              </small>
            </div>
            <em class="er-act">Read</em>
          </button>
        ))
      ) : (
        <p class="muted pad-s">Nothing on the phone matches.</p>
      )}

      {(cloud.tbConnected() || cloud.rdConnected()) && (
        <>
          <h3 class="section-label pad">Your cloud</h3>
          {cloudHits == null ? (
            <p class="muted pad-s">
              <span class="spinner small" /> Looking in TorBox / Real-Debrid…
            </p>
          ) : cloudHits.length ? (
            cloudHits.slice(0, 20).map((b) => (
              <button class="lib-row" onClick={() => nav.push('book', { book: b })}>
                <Cover book={b} />
                <div>
                  <b>{b.title}</b>
                  <small>
                    {b.author || ''} · {b.source === 'rd' ? 'Real-Debrid' : 'TorBox'}
                  </small>
                </div>
                <em class="er-act">Open</em>
              </button>
            ))
          ) : (
            <p class="muted pad-s">No ebooks in your cloud match.</p>
          )}
        </>
      )}

      <h3 class="section-label pad">From your sources</h3>
      {srcHits == null ? (
        <p class="muted pad-s">
          <span class="spinner small" /> Searching your sources…
        </p>
      ) : srcHits.length ? (
        srcHits.slice(0, 25).map((h) => {
          const readable = h.file.format === 'EPUB' || h.file.format === 'PDF';
          const have = !!kept?.[h.book.uid];
          return (
            <div class="lib-row er-src">
              <div>
                <b>{h.r.title || h.file.name}</b>
                <small>
                  {h.file.format}
                  {fmtMb(h.r.size)} · {h.source}
                </small>
              </div>
              {readable && (
                <button class="pill small" onClick={() => nav.push('reader', { book: h.book })}>
                  Read
                </button>
              )}
              {readable && (
                <button class="pill small" disabled={!!busy || have} onClick={() => save(h)}>
                  {busy === h.r.link ? <span class="spinner small" /> : have ? '✓ Saved' : 'Save'}
                </button>
              )}
              {!readable && (
                <a class="pill small" href={h.r.link} target="_blank" rel="noopener">
                  Open
                </a>
              )}
            </div>
          );
        })
      ) : (
        <p class="muted pad-s">No ebooks in your sources for “{term}”.</p>
      )}
    </div>
  );
}

// EPUB first, then PDF, then other formats.
const rank = (h) => (h.file.format === 'EPUB' ? 0 : h.file.format === 'PDF' ? 1 : 2);
