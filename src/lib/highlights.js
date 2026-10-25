// Highlights and notes in ebooks. Each one remembers its book, the paragraph(s) it's
// in (index among the reader's text blocks) and the exact words, so it can be shown
// again, listed in the notebook and opened at its place.
import { persisted, summarize } from './store.js';

export const highlights = persisted('highlights', {}); // uid -> [{ id, parts: [{ a, t }], text, note, at, book }]

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const forBook = (uid) => highlights.get()[uid] || [];

export function addHighlight(book, parts, note = '') {
  const h = { id: newId(), parts, text: parts.map((p) => p.t).join(' ').replace(/\s+/g, ' ').trim(), note, at: Date.now(), book: summarize(book) };
  highlights.set((all) => ({ ...all, [book.uid]: [...(all[book.uid] || []), h].sort((x, y) => x.parts[0].a - y.parts[0].a) }));
  return h;
}

export function updateHighlight(uid, id, patch) {
  highlights.set((all) => ({ ...all, [uid]: (all[uid] || []).map((h) => (h.id === id ? { ...h, ...patch } : h)) }));
}

export function removeHighlight(uid, id) {
  highlights.set((all) => {
    const list = (all[uid] || []).filter((h) => h.id !== id);
    const next = { ...all };
    if (list.length) next[uid] = list;
    else delete next[uid];
    return next;
  });
}

/** Every highlight, newest first, optionally filtered by words in the quote, note, title or author. */
export function allHighlights(query = '') {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(highlights.get())
    .flat()
    .filter((h) => words.every((w) => `${h.text} ${h.note} ${h.book?.title || ''} ${h.book?.author || ''}`.toLowerCase().includes(w)))
    .sort((a, b) => b.at - a.at);
}

/** The notebook as Markdown (for export), grouped by book. */
export function toMarkdown(list = allHighlights()) {
  const byBook = new Map();
  for (const h of list) {
    const k = h.book?.uid || '';
    if (!byBook.has(k)) byBook.set(k, { book: h.book, items: [] });
    byBook.get(k).items.push(h);
  }
  const out = ['# My highlights', ''];
  for (const { book, items } of byBook.values()) {
    out.push(`## ${book?.title || 'Book'}${book?.author ? ` — ${book.author}` : ''}`, '');
    for (const h of items.sort((a, b) => a.parts[0].a - b.parts[0].a)) {
      out.push(`> ${h.text}`);
      if (h.note) out.push('', h.note);
      out.push('');
    }
  }
  return out.join('\n');
}

// ---- marking the words in the page --------------------------------------------

/** Wrap `text` inside `block` in <mark class="hl" data-id>. Returns true when found. */
export function markText(block, text, id) {
  if (!block || !text) return false;
  const nodes = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let all = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ n, start: all.length });
    all += n.nodeValue;
  }
  let at = all.indexOf(text);
  let len = text.length;
  if (at < 0) {
    // Spacing may differ (line breaks in the page): match with any whitespace.
    const re = new RegExp(text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
    const m = re.exec(all);
    if (!m) return false;
    at = m.index;
    len = m[0].length;
  }
  const end = at + len;
  for (const { n, start } of nodes) {
    const stop = start + n.nodeValue.length;
    if (stop <= at || start >= end) continue;
    let node = n;
    const from = Math.max(0, at - start);
    const to = Math.min(n.nodeValue.length, end - start);
    if (to < node.nodeValue.length) node.splitText(to);
    if (from > 0) node = node.splitText(from);
    if (!node.nodeValue.trim()) continue;
    const mark = document.createElement('mark');
    mark.className = 'hl';
    mark.dataset.id = id;
    node.parentNode.insertBefore(mark, node);
    mark.appendChild(node);
  }
  return true;
}

/** Remove the marks of one highlight (or all, without `id`) and rejoin the text. */
export function unmark(root, id) {
  root.querySelectorAll(id ? `mark.hl[data-id="${id}"]` : 'mark.hl').forEach((m) => {
    const p = m.parentNode;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
    p.normalize();
  });
}

/** The selection, split into the reader blocks it covers: [{ a: block index, t: words }]. */
export function selectionParts(range, blocks) {
  const parts = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!range.intersectsNode(b)) continue;
    const r = document.createRange();
    r.selectNodeContents(b);
    if (b.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset);
    if (b.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset);
    const t = r.toString();
    if (t.trim()) parts.push({ a: i, t });
  }
  return parts;
}
