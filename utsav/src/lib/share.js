// Getting a finished card out of the app. On the phone: the Android share sheet with
// the image attached, so it goes straight into WhatsApp, Instagram or anywhere else.
// In a browser: the Web Share sheet where it exists, otherwise a download.

import { Capacitor } from '@capacitor/core';
import { cardBlob } from './render.js';

const toBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

export function fileName(spec) {
  const slug = `${spec.occasion || 'card'}-${spec.to || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `utsav-${slug || 'card'}.png`;
}

/** Share the card image. Returns 'shared' | 'downloaded' | 'cancelled'. */
export async function shareCard(spec, photo, text = '') {
  const blob = await cardBlob(spec, photo);
  const name = fileName(spec);
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const saved = await Filesystem.writeFile({ path: name, data: await toBase64(blob), directory: Directory.Cache });
    try { await Share.share({ files: [saved.uri], text: text || undefined, dialogTitle: 'Send your card' }); return 'shared'; }
    catch { return 'cancelled'; }
  }
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text: text || undefined }); return 'shared'; } catch { return 'cancelled'; }
  }
  // claude.ai preview: downloads go through its own save prompt.
  try {
    const dl = window.claude?.use ? await window.claude.use('downloads') : null;
    if (dl) { await dl.save({ filename: name, data: blob }); return 'downloaded'; }
  } catch (e) { if (e?.code === 'declined') return 'cancelled'; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}

/** The card's words as plain text, for WhatsApp messages and copying. */
export function cardText(spec, dear) {
  return [dear, spec.heading && `*${spec.heading}*`, spec.message, spec.from && `${spec.signoff || ''}\n${spec.from}`].filter(Boolean).join('\n\n');
}
