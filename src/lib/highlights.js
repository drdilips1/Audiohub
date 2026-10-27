// Highlights and notes in ebooks. Each one remembers its book, the paragraph(s) it's
// in (index among the reader's text blocks) and the exact words, so it can be shown
// again, listed in the notebook and opened at its place.
import { highlights, highlightsGone, summarize } from './store.js';

export { highlights }; // uid -> [{ id, parts: [{ a, t }], text, note, at, book }]

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const forBook = (uid) => highlights.get()[uid] || [];

/**
 * Highlights to show in this ebook: its own, and those made in another copy of the same
 * book (opened from a source, then from Downloads, re-downloaded…), found by their words.
 */
export function forWork(book, same) {
  const all = highlights.get();
  const own = all[book.uid] || [];
  const others = Object.entries(all)
    .filter(([uid, list]) => uid !== book.uid && list?.length && same(list[0].book, book))
    .flatMap(([uid, list]) => list.map((h) => ({ ...h, elsewhere: true, home: uid })));
  return [...own, ...others];
}

export function addHighlight(book, parts, note = '') {
  const h = { id: newId(), parts, text: parts.map((p) => p.t).join(' ').replace(/\s+/g, ' ').trim(), note, at: Date.now(), book: summarize(book) };
  highlights.set((all) => ({ ...all, [book.uid]: [...(all[book.uid] || []), h].sort((x, y) => x.parts[0].a - y.parts[0].a) }));
  return h;
}

export function updateHighlight(uid, id, patch) {
  highlights.set((all) => ({ ...all, [uid]: (all[uid] || []).map((h) => (h.id === id ? { ...h, ...patch } : h)) }));
}

export function removeHighlight(uid, id) {
  highlightsGone.set((g) => Object.fromEntries([...Object.entries(g), [id, Date.now()]].slice(-500)));
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

// ---- growing a selection: the sentence, the paragraph, one more sentence ------------
// Dragging selection handles on a phone is fiddly; these snap it to what you meant.

const ABBR = /\b(mr|mrs|ms|dr|st|jr|sr|prof|rev|vs|etc|no|vol|ch|fig|e\.g|i\.e|[a-z])$/i;

/** Sentences of a paragraph's text, as [start, end) offsets (end before trailing spaces). */
export function sentenceSpans(text) {
  const spans = [];
  let start = 0;
  const re = /[.!?…]+["'”’»)\]]*(\s+|$)/g;
  for (let m; (m = re.exec(text)); ) {
    if (!m[0]) break;
    const end = m.index + m[0].length - m[1].length;
    const before = text.slice(start, m.index);
    // "Mr. Bennet", "e.g. this", "J. Austen": not the end of a sentence.
    if (m[1] && m[0].trim() === '.' && ABBR.test(before)) continue;
    if (end > start) spans.push([start, end]);
    start = m.index + m[0].length;
    if (!m[1]) break;
  }
  if (start < text.length && text.slice(start).trim()) spans.push([start, text.replace(/\s+$/, '').length]);
  while (spans.length && !text.slice(spans[0][0], spans[0][1]).trim()) spans.shift();
  return spans.map(([s, e]) => [s + (text.slice(s, e).length - text.slice(s, e).trimStart().length), e]);
}

const offsetIn = (block, node, off) => {
  const r = document.createRange();
  r.setStart(block, 0);
  r.setEnd(node, off);
  return r.toString().length;
};

/** A DOM range over [start, end) of a paragraph's text. */
function rangeIn(block, start, end, r = document.createRange(), setStart = true) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let at = 0;
  let didStart = !setStart;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.nodeValue.length;
    if (!didStart && start <= at + len) {
      r.setStart(n, start - at);
      didStart = true;
    }
    if (didStart && end <= at + len) {
      r.setEnd(n, end - at);
      return r;
    }
    at += len;
  }
  r.setEndAfter(block.lastChild || block);
  return r;
}

/** Grow the current selection: 'sentence', 'paragraph' or 'more' (one sentence further). */
export function growSelection(kind, blocks, range) {
  const sel = window.getSelection();
  // The selection as last seen (tapping a button can clear the live one on some phones).
  range ||= sel?.rangeCount ? sel.getRangeAt(0) : null;
  if (!range) return false;
  const find = (node) => blocks.findIndex((b) => b === node || b.contains(node));
  const si = find(range.startContainer);
  const ei = find(range.endContainer);
  if (si < 0 || ei < 0) return false;
  const sb = blocks[si];
  let eb = blocks[ei];
  const r = document.createRange();
  if (kind === 'paragraph') {
    const end = eb.textContent.replace(/\s+$/, '').length;
    rangeIn(sb, 0, 0, r);
    rangeIn(eb, end, end, r, false);
  } else {
    const so = offsetIn(sb, range.startContainer, range.startOffset);
    const eo = offsetIn(eb, range.endContainer, range.endOffset);
    const ss = sentenceSpans(sb.textContent);
    const s = ss.find(([a, b]) => so < b) || ss[ss.length - 1];
    let es = sentenceSpans(eb.textContent);
    let e = kind === 'more' ? es.find(([a]) => a >= eo) : [...es].reverse().find(([a]) => a < eo) || es[0];
    if (kind === 'more' && !e) {
      // The paragraph ends here: take the next one's first sentence.
      const next = blocks.slice(ei + 1).find((b) => b.textContent.trim());
      if (!next) return false;
      eb = next;
      es = sentenceSpans(eb.textContent);
      e = es[0];
    }
    if (!s || !e) return false;
    rangeIn(sb, s[0], s[0], r);
    rangeIn(eb, e[1], e[1], r, false);
  }
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}
