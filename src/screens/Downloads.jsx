import { useState } from 'preact/hooks';
import { TopBar, Cover, toast } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { useStore, settings, progress } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { downloads, pauseDownload, resumeDownload, cancelDownload, removeDownload, fmtBytes, canDownload, isRunning } from '../lib/downloads.js';
import { savedEbooks, forgetEbook } from '../lib/epub.js';

const pctOf = (d) => {
  const per = d.total ? 1 / d.total : 0;
  const cur = d.currentTotal > 0 ? (d.current || 0) / d.currentTotal : 0;
  return Math.min(100, Math.round(((d.done || 0) + cur) * per * 100));
};

/** Every download in one place: what's saving now, paused or failed, and what's on the phone (with sizes). */
export function Downloads() {
  const all = useStore(downloads);
  const kept = useStore(savedEbooks);
  const st = useStore(settings);
  const list = Object.entries(all || {}).filter(([, d]) => d?.book);
  const active = list.filter(([, d]) => d.status === 'downloading');
  const waiting = list.filter(([, d]) => d.status === 'paused' || d.status === 'error');
  // Storage: biggest first if you like, and finished books to clear in one go.
  const [sortBy, setSortBy] = useState('recent');
  const prog = useStore(progress);
  const done = list
    .filter(([, d]) => d.status === 'done')
    .sort((a, b) => (sortBy === 'size' ? (b[1].bytes || 0) - (a[1].bytes || 0) : (b[1].finishedAt || 0) - (a[1].finishedAt || 0)));
  const finished = done.filter(([uid]) => prog?.[uid]?.finished);
  const finishedBytes = finished.reduce((n, [, d]) => n + (d.bytes || 0), 0);
  const ebooks = Object.entries(kept || {}).filter(([, x]) => x?.book);
  const audioBytes = done.reduce((n, [, d]) => n + (d.bytes || 0), 0);
  const ebookBytes = ebooks.reduce((n, [, x]) => n + (x.size || 0), 0);
  const act = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      toast(e.message);
    }
  };

  return (
    <div class="screen downloads-screen">
      <TopBar title="Downloads" ask={false} />
      {!canDownload && <p class="muted pad">Downloads work in the Android app.</p>}
      <div class="dl-storage pad">
        <div>
          <b>{fmtBytes(audioBytes + ebookBytes)}</b>
          <span>on this phone</span>
        </div>
        <div>
          <b>{done.length}</b>
          <span>audiobooks · {fmtBytes(audioBytes)}</span>
        </div>
        <div>
          <b>{ebooks.length}</b>
          <span>ebooks · {fmtBytes(ebookBytes)}</span>
        </div>
      </div>
      <p class="muted small pad">Saving to {(st.downloadTarget || 'public') === 'public' ? 'Downloads/Audiohub (visible in My Files)' : 'app storage'} — change it in Settings → Downloads.</p>

      {active.length > 0 && <h3 class="section-label pad">Downloading</h3>}
      {active.map(([uid, d]) => (
        <div class="dl-item">
          <Cover book={d.book} />
          <div class="dl-main">
            <b>{d.book.title}</b>
            <small>
              {isRunning(uid) ? `Part ${Math.min((d.done || 0) + 1, d.total || 1)} of ${d.total || '…'} · ${fmtBytes(d.bytes || 0)}` : 'Waiting…'}
              {d.error ? ` · ${d.error}` : ''}
            </small>
            <div class="progress-bar">
              <div style={{ width: pctOf(d) + '%' }} />
            </div>
          </div>
          <button class="icon-btn" aria-label="Pause" onClick={act(() => pauseDownload(uid))}>
            <Icon name="pause" size={18} />
          </button>
          <button class="icon-btn" aria-label="Cancel" onClick={() => confirm('Stop and delete this download?') && cancelDownload(uid)}>
            <Icon name="close" size={18} />
          </button>
        </div>
      ))}

      {waiting.length > 0 && <h3 class="section-label pad">Paused & failed</h3>}
      {waiting.map(([uid, d]) => (
        <div class="dl-item">
          <Cover book={d.book} />
          <div class="dl-main">
            <b>{d.book.title}</b>
            <small class={d.status === 'error' ? 'err' : ''}>
              {d.status === 'error' ? d.error || 'Failed' : `Paused · ${d.done || 0} of ${d.total || '?'} parts saved`}
            </small>
            <div class="progress-bar">
              <div style={{ width: pctOf(d) + '%' }} />
            </div>
          </div>
          <button class="pill small" onClick={act(() => resumeDownload(uid))}>
            {d.status === 'error' ? 'Retry' : 'Resume'}
          </button>
          <button class="icon-btn" aria-label="Delete" onClick={() => confirm('Delete what was saved?') && removeDownload(uid)}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      ))}

      {finished.length > 0 && (
        <button
          class="btn ghost-wide lib-manage"
          onClick={() => confirm(`Remove ${finished.length} finished book${finished.length > 1 ? 's' : ''} from this phone (${fmtBytes(finishedBytes)})?`) && Promise.all(finished.map(([uid]) => removeDownload(uid))).then(() => toast(`Freed ${fmtBytes(finishedBytes)}`))}
        >
          <Icon name="trash" size={16} /> Remove finished · {fmtBytes(finishedBytes)}
        </button>
      )}
      {done.length > 1 && (
        <div class="lib-sort pad dl-sort">
          {[
            ['recent', 'Recent'],
            ['size', 'Biggest first'],
          ].map(([k, label]) => (
            <button class={'pill small' + (sortBy === k ? ' active' : '')} onClick={() => setSortBy(k)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {done.length > 0 && <h3 class="section-label pad">Audiobooks on this phone</h3>}
      {done.map(([uid, d]) => (
        <div class="dl-item">
          <button class="dl-open" onClick={() => nav.push('book', { book: d.book })}>
            <Cover book={d.book} />
          </button>
          <div class="dl-main">
            <b>{d.book.title}</b>
            <small>
              {fmtBytes(d.bytes || 0)} · {d.total || d.tracks?.length || 0} part{(d.total || 0) === 1 ? '' : 's'} · {d.location || ''}
              {prog?.[uid]?.finished ? ' · Finished' : ''}
            </small>
          </div>
          <button class="icon-btn" aria-label="Remove download" onClick={() => confirm(`Remove “${d.book.title}” from this phone?`) && removeDownload(uid)}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      ))}

      {ebooks.length > 0 && <h3 class="section-label pad">Ebooks kept on this phone</h3>}
      {ebooks.map(([uid, x]) => (
        <div class="dl-item">
          <button class="dl-open" onClick={() => nav.push('reader', { book: x.book })}>
            <Cover book={x.book} />
          </button>
          <div class="dl-main">
            <b>{x.book.title}</b>
            <small>
              {x.format || 'EPUB'}
              {x.size ? ` · ${fmtBytes(x.size)}` : ''}
            </small>
          </div>
          <button class="icon-btn" aria-label="Remove ebook" onClick={() => forgetEbook(uid).then(() => toast('Removed from this phone'))}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      ))}

      {!list.length && !ebooks.length && <p class="muted pad">Nothing downloaded yet. Tap “Offline” on an audiobook, or Save on a source result.</p>}
      <div class="footer-space" />
    </div>
  );
}
