import { useMemo, useState } from 'preact/hooks';
import { TopBar, Cover, toast } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { useStore } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { highlights, allHighlights, removeHighlight, toMarkdown } from '../lib/highlights.js';
import { Native as Files, available as files } from '../sources/local.js';
import { AllBookmarks } from '../components/bookmarks.jsx';

/** Every highlight and note from your ebooks: search, open at its place, export. */
export function Notes() {
  const all = useStore(highlights);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('highlights');
  const list = useMemo(() => allHighlights(q), [all, q]);
  // Grouped by book, books with the newest highlight first.
  const groups = useMemo(() => {
    const m = new Map();
    for (const h of list) {
      const k = h.book?.uid || '';
      if (!m.has(k)) m.set(k, { book: h.book, items: [] });
      m.get(k).items.push(h);
    }
    return [...m.values()];
  }, [list]);

  const exportAll = async () => {
    // Highlights, bookmarks (with your notes) and saved ideas, as one Markdown file.
    const { bookmarksMarkdown } = await import('../components/bookmarks.jsx');
    const { ideas } = await import('../lib/askbook.js');
    const saved = (ideas.get() || []).map((c) => `- ${c.text}${c.title ? ` — *${c.title}*` : ''}${c.where ? ` (${c.where})` : ''}`);
    const text = [total ? toMarkdown(list) : '', bookmarksMarkdown(), saved.length ? ['# Saved ideas', '', ...saved].join('\n') : ''].filter(Boolean).join('\n\n');
    if (!text.trim()) return toast('Nothing to export yet');
    const name = `audiohub-notes-${new Date().toISOString().slice(0, 10)}.md`;
    if (files) {
      try {
        const r = await Files.saveFile({ name, text, mime: 'text/markdown' });
        return toast(`Saved${r?.name ? ` as ${r.name}` : ''}`);
      } catch (e) {
        if (e?.message === 'cancelled') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied as text');
    } catch {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      a.download = name;
      a.click();
    }
  };

  const total = Object.values(all).reduce((n, l) => n + l.length, 0);
  return (
    <div class="screen notes-screen">
      <TopBar
        title="Notes & bookmarks"
        ask={false}
        right={
          (

            <button class="pill small" onClick={exportAll}>
              Export
            </button>
          )
        }
      />
      <div class="pad">
        <div class="segmented">
          <button class={tab === 'highlights' ? 'on' : ''} onClick={() => setTab('highlights')}>
            Highlights
          </button>
          <button class={tab === 'bookmarks' ? 'on' : ''} onClick={() => setTab('bookmarks')}>
            Bookmarks
          </button>
        </div>
      </div>
      {tab === 'bookmarks' ? (
        <>
          <div class="pad">
            <input class="notes-search" type="search" placeholder="Search your bookmarks" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          </div>
          <AllBookmarks q={q} />
        </>
      ) : total === 0 ? (
        <p class="muted pad">
          In any ebook, press and hold on a word or drag across a passage, then tap <b>Highlight</b> — or Explain, Define, Ask, Translate.
          Your highlights and notes collect here.
        </p>
      ) : (
        <>
          <div class="pad">
            <input class="notes-search" type="search" placeholder="Search your highlights" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          </div>
          {groups.map(({ book, items }) => (
            <section class="notes-book">
              <div class="notes-book-head">
                <Cover book={book} />
                <div>
                  <b>{book?.title}</b>
                  <small>
                    {book?.author ? `${book.author} · ` : ''}
                    {items.length} highlight{items.length > 1 ? 's' : ''}
                  </small>
                </div>
              </div>
              {items.map((h) => (
                <div class="note-card">
                  <button class="note-quote" onClick={() => nav.push('reader', { book: h.book, at: h.parts[0].a })}>
                    “{h.text}”
                  </button>
                  {h.note && <p class="note-text">{h.note}</p>}
                  <div class="note-foot">
                    <small>{new Date(h.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</small>
                    <button
                      class="icon-btn"
                      aria-label="Delete highlight"
                      onClick={() => confirm('Delete this highlight?') && removeHighlight(h.book.uid, h.id)}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </section>
          ))}
          {!list.length && <p class="muted pad">Nothing matches “{q}”.</p>}
        </>
      )}
      <div class="footer-space" />
    </div>
  );
}
