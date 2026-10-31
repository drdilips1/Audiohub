// "Report a problem": the app keeps a short log of recent errors, and builds a
// plain-text report (what you describe + app version, device, screen, what's set up,
// recent errors) to share into the Claude app or post on GitHub. It never includes
// passwords, keys or tokens — only names of what's set up and redacted addresses.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { nav } from './nav.js';

const Web = registerPlugin('InkwellWeb');
const native = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');
const REPO = 'https://github.com/drdilips1/audiohub';
const KEY = 'inkwell:errorLog';
const MAX = 80;

// Addresses and messages with anything secret-looking blanked out.
export const redact = (s) =>
  String(s ?? '')
    .replace(/([?&#](token|apikey|api_key|key|access_token|refresh_token|password|pass|auth|sig|signature)=)[^&\s]+/gi, '$1…')
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 …')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '…jwt…')
    .replace(/\b[a-f0-9]{32,}\b/gi, (m) => m.slice(0, 6) + '…')
    .slice(0, 400);

let log = [];
try {
  log = JSON.parse(localStorage.getItem(KEY) || '[]');
} catch {}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(log.slice(-MAX)));
  } catch {}
}

/** Note something that went wrong (kept on this device only, last 40). */
export function logError(where, message) {
  const text = redact(message?.message || message);
  if (!text) return;
  const last = log[log.length - 1];
  if (last && last.where === where && last.text === text) {
    last.n = (last.n || 1) + 1;
    last.t = Date.now();
  } else log.push({ t: Date.now(), where: String(where).slice(0, 40), text });
  log = log.slice(-MAX);
  save();
}
export const recentErrors = () => log.slice();
export function clearErrors() {
  log = [];
  save();
}

// Detailed logging (Settings → Issues & support): also keeps the app's warnings and
// console errors, for a hard-to-catch problem. Off by default.
const DETAIL = 'inkwell:detailLog';
export const detailedLog = () => {
  try {
    return localStorage.getItem(DETAIL) === '1';
  } catch {
    return false;
  }
};
export function setDetailedLog(on) {
  try {
    localStorage.setItem(DETAIL, on ? '1' : '0');
  } catch {}
}
if (typeof console !== 'undefined') {
  for (const level of ['warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      if (!detailedLog()) return;
      try {
        logError(`console.${level}`, args.map((x) => (x?.message ? x.message : typeof x === 'string' ? x : String(JSON.stringify(x)).slice(0, 200))).join(' '));
      } catch {}
    };
  }
}

export const ISSUES_URL = `${REPO}/issues`;
export const featureUrl = () => `${REPO}/issues/new?title=${encodeURIComponent('Idea: ')}&labels=enhancement`;

// Catch what the app doesn't handle itself.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => logError('crash', e.message || e.error));
  window.addEventListener('unhandledrejection', (e) => logError('unhandled', e.reason));
}

const when = (t) => {
  const d = new Date(t);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

// How full the web storage is (about 5 MB for everything): total and the biggest parts.
function storageLine() {
  const sizes = [];
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const n = k.length + (localStorage.getItem(k) || '').length;
      total += n;
      sizes.push([k.replace(/^inkwell:/, ''), n]);
    }
  } catch {}
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  const top = sizes.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${kb(n)}`).join(', ');
  return `Storage: ${kb(total)} used${top ? ` (${top})` : ''}`;
}

/** The report text. `setup` = short lines describing what's configured (no secrets). */
export function buildReport({ note = '', version = '', setup = [] } = {}) {
  const st = nav.state();
  const screen = st.overlay || (st.top ? `${st.tab} › ${st.top.name}${st.top.params?.book?.title ? ` (“${st.top.params.book.title}”)` : ''}` : st.tab);
  const errs = recentErrors().slice(-15);
  return [
    '🐞 Audiohub problem report',
    '',
    `What happened: ${note.trim() || '(not described)'}`,
    '',
    `App: Audiohub ${version} · ${{ android: 'Android app', ios: 'iPhone app' }[Capacitor.getPlatform()] || 'web app'}`,
    `Device: ${navigator.userAgent.replace(/\s*\(KHTML.*$/, '').slice(0, 140)}`,
    `Screen: ${screen}`,
    `Time: ${when(Date.now())} · Online: ${navigator.onLine ? 'yes' : 'no'}`,
    storageLine(),
    '',
    'Set up:',
    ...(setup.length ? setup.map((l) => `- ${l}`) : ['- (nothing)']),
    '',
    `Recent errors (${errs.length}):`,
    ...(errs.length ? errs.map((e) => `- ${when(e.t)} [${e.where}]${e.n > 1 ? ` ×${e.n}` : ''} ${e.text}`) : ['- none']),
  ].join('\n');
}

/** Android: the share sheet (pick Claude). Web: the browser's share, else copy. Returns what happened. */
export async function shareReport(text) {
  if (native) {
    await Web.shareText({ text, title: 'Send the report to…', subject: 'Audiohub problem report' });
    return 'shared';
  }
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Audiohub problem report', text });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}

/** A new GitHub issue with the report filled in (you review it before posting). */
export function githubIssueUrl(text, note = '') {
  const title = `Problem: ${note.trim().split('\n')[0].slice(0, 70) || 'report from the app'}`;
  return `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(text.slice(0, 6000))}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
