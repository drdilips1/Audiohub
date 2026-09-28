// Ebooks narrated by a free phone voice (see lib/tts.js). UIDs look like "tts:gb:1342".
import * as gb from './gutenberg.js';
import { paragraphs, listenParagraphs, buildAudiobook, nativeTts, usingBuiltin } from '../lib/tts.js';
import { isCloudEbook, loadCloudEbook } from '../lib/epub.js';

export const canNarrate = () => usingBuiltin() || nativeTts;

export async function narrate(book) {
  const base = book.uid.startsWith('tts:') ? { ...book, uid: book.uid.slice(4) } : book;
  const cloud = isCloudEbook(base);
  const full = cloud || base.readUrl ? base : await gb.details(base);
  const doc = cloud ? await loadCloudEbook(full) : await gb.loadText(full);
  const paras = listenParagraphs(doc.paras || paragraphs(doc.html));
  if (!paras.length) throw new Error('No readable text found in this ebook');
  return buildAudiobook(full, paras);
}

export const details = (book) => narrate(book);
export const search = async () => [];
