export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}

export function fmtDuration(sec) {
  if (!sec || !isFinite(sec)) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// "01:02:03", "02:03", "123.4" -> seconds
export function parseLength(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s.includes(':')) return s.split(':').reduce((acc, p) => acc * 60 + (parseFloat(p) || 0), 0);
  return parseFloat(s) || 0;
}

export function stripHtml(html) {
  if (!html) return '';
  if (Array.isArray(html)) html = html.join('\n');
  const doc = new DOMParser().parseFromString(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n'), 'text/html');
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export function first(v) {
  return Array.isArray(v) ? v[0] : v;
}

export function hashHue(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/**
 * The largest version of a cover the host offers (Audible/Amazon, Apple,
 * Open Library, Google Books), so a big banner isn't a blown-up thumbnail.
 */
export function hiResCover(url) {
  if (!url) return url;
  let u = String(url);
  if (/media-amazon\.com|images-amazon\.com|ssl-images-amazon/.test(u)) u = u.replace(/\._[A-Z0-9_,]+_\.(jpg|jpeg|png)/i, '._SL1200_.$1');
  else if (/mzstatic\.com/.test(u)) u = u.replace(/\/\d+x\d+(bb|cc)?(-\d+)?\.(jpg|png|webp)$/i, '/1200x1200bb.$3');
  else if (/covers\.openlibrary\.org/.test(u)) u = u.replace(/-(S|M)\.jpg/, '-L.jpg');
  else if (/books\.google|googleusercontent/.test(u)) u = u.replace(/([?&])zoom=\d/, '$1zoom=0').replace(/&edge=curl/, '');
  return u;
}
