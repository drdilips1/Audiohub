// Account + cloud sync on the user's own Supabase project (free tier).
// Email/password or Google sign-in via Supabase Auth; data lives in one row per
// user in `public.user_data` protected by row-level security.
//
// Each synced store is a "section" with its own timestamp; lists that can be
// edited on several devices (progress, library, bookmarks, addons) merge item
// by item, everything else takes the newest copy.
import { qbit, qbitSent } from '../sources/qbit.js';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapApp } from '@capacitor/app';
import { podcasts } from '../sources/podcasts.js';
import { ai } from './ai.js';
import { persisted, settings, library, progress, bookmarks, addons, abs, debrid, hardcover, goodreads, removedBooks, mergeRemoved, cleanLibrary, cleanProgress } from './store.js';
import { cleanUrl } from './http.js';
import { ttsCfg } from './tts.js';
import { myRatings } from './taste.js';

const BAKED_URL = import.meta.env.VITE_SUPABASE_URL || '';
const BAKED_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const REDIRECT = 'app.inkwell.books://auth';

export const account = persisted('account', {
  url: BAKED_URL,
  anonKey: BAKED_KEY,
  email: '',
  name: '',
  userId: '',
  accessToken: '',
  refreshToken: '',
  expiresAt: 0,
  lastSync: 0,
  syncKeys: true, // also sync TorBox / Real-Debrid / ABS / Hardcover credentials
  status: '',
});

const SECTIONS = {
  settings: { store: settings },
  // Removals first, so the merges below can drop books removed on any device.
  removedBooks: { store: removedBooks, merge: mergeRemoved },
  library: { store: library, merge: (l, r) => cleanLibrary(mergeById(l, r)) },
  progress: { store: progress, merge: (l, r) => cleanProgress(mergeNewest(l, r)) },
  bookmarks: { store: bookmarks, merge: mergeBookmarks },
  addons: { store: addons },
  goodreads: { store: goodreads },
  myRatings: { store: myRatings, merge: mergeNewest },
  podcasts: { store: podcasts },
  qbit: { store: qbit, secret: true },
  qbitSent: { store: qbitSent, merge: mergeSent },
  ai: { store: ai, secret: true },
  abs: { store: abs, secret: true },
  debrid: { store: debrid, secret: true },
  hardcover: { store: hardcover, secret: true },
  tts: { store: ttsCfg, secret: true },
};

// Installs from before the server was built in saved an empty address — use the built-in one.
if (BAKED_URL && !account.get().url) account.patch({ url: BAKED_URL, anonKey: BAKED_KEY });

const stamps = persisted('syncStamps', {}); // section -> last local change time
let applying = false;

// ---- merging ------------------------------------------------------------------
function mergeById(local, remote) {
  return { ...remote, ...local };
}
function mergeNewest(local, remote) {
  const out = { ...local };
  for (const [k, v] of Object.entries(remote || {})) if (!out[k] || (v?.updatedAt || 0) > (out[k]?.updatedAt || 0)) out[k] = v;
  return out;
}
// Sent-to-qBittorrent list: keep every hash from both sides, and the latest "Clear list"
// from either device, so a cleared list doesn't come back from an older copy.
function mergeSent(local, remote) {
  const items = { ...(remote?.items || {}) };
  for (const [h, v] of Object.entries(local?.items || {})) {
    const r = items[h];
    items[h] = !r ? v : { ...r, ...v, at: Math.max(v?.at || 0, r?.at || 0), removed: !!(v?.removed || r?.removed) || undefined, hidden: !!(v?.hidden || r?.hidden) || undefined };
  }
  return { ...remote, ...local, items, clearedAt: Math.max(local?.clearedAt || 0, remote?.clearedAt || 0) };
}
function mergeBookmarks(local, remote) {
  const out = { ...local };
  for (const [k, list] of Object.entries(remote || {})) {
    const seen = new Set((out[k] || []).map((b) => b.createdAt));
    out[k] = [...(out[k] || []), ...(list || []).filter((b) => !seen.has(b.createdAt))].sort((a, b) => (a.global || 0) - (b.global || 0));
  }
  return out;
}

// ---- auth -----------------------------------------------------------------------
const cfg = () => account.get();
export const configured = () => !!(cfg().url && cfg().anonKey);
export const signedIn = () => !!cfg().refreshToken;

/** https://xxxx.supabase.co, whatever was pasted after it (e.g. /rest/v1/ from the API URL). */
const server = () => (cfg().url || '').replace(/^(https?:\/\/[^/]+).*$/i, '$1');

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const key = cfg().anonKey;
  const bearer = token || (key.startsWith('eyJ') ? key : ''); // newer sb_publishable_ keys go in apikey only
  const res = await fetch(server() + path, {
    method,
    headers: {
      apikey: key,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const msg = data?.msg || data?.error_description || data?.message || data?.error || `HTTP ${res.status}`;
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return data;
}

function saveSession(s) {
  account.patch({
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    expiresAt: Date.now() + (s.expires_in || 3600) * 1000,
    userId: s.user?.id || cfg().userId,
    email: s.user?.email || cfg().email,
    // The name your sign-in gives (Google), for Home's greeting.
    name: s.user?.user_metadata?.full_name || s.user?.user_metadata?.name || cfg().name || '',
  });
}

export function configure(url, anonKey) {
  // Keep just https://xxxx.supabase.co: people often paste the API URL with /rest/v1/ on the end.
  account.patch({ url: cleanUrl(url).replace(/^(https?:\/\/[^/]+).*$/i, '$1'), anonKey: anonKey.trim() });
}

// Supabase's free confirmation emails often never arrive. The setup SQL adds
// audiohub_confirm(), so the app confirms the account itself: no email, no dashboard switch.
const OLD_SQL = 'Copy the setup SQL again (Change sync server → Copy SQL) and run it in Supabase once more — it now confirms accounts without the email. Then tap Continue.';

async function confirmEmail(email) {
  try {
    await api('/rest/v1/rpc/audiohub_confirm', { method: 'POST', body: { p_email: email } });
    return true;
  } catch {
    return false; // set up with the older SQL
  }
}

async function passwordLogin(email, password) {
  const r = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  account.patch({ status: '' });
  saveSession(r);
  await syncNow({ first: true });
}

/** One button: sign in, or create the account if there isn't one — no confirmation email needed. */
export async function continueWith(email, password) {
  try {
    return await signInOrCreate(email.trim(), password);
  } catch (e) {
    account.patch({ status: e.message }); // stays on screen (a toast is gone too fast to read)
    throw e;
  }
}

async function signInOrCreate(email, password) {
  account.patch({ email, status: '' });
  try {
    await passwordLogin(email, password);
    return 'Signed in — your data is synced';
  } catch (e) {
    if (/not confirmed/i.test(e.message)) {
      if (!(await confirmEmail(email))) throw new Error(OLD_SQL);
      await passwordLogin(email, password);
      return 'Signed in — your data is synced';
    }
    if (!/invalid login|invalid credentials/i.test(e.message)) throw e;
  }
  // No account with this email and password yet: create it.
  let r;
  try {
    r = await api('/auth/v1/signup', { method: 'POST', body: { email, password } });
  } catch (e) {
    if (/already registered|already exists/i.test(e.message)) throw new Error('Wrong password for this email. Tap “Forgot password?” if you need a new one.');
    if (/email|rate limit|smtp|sending/i.test(e.message))
      throw new Error('Supabase couldn’t send its confirmation email (' + e.message + '). In Supabase: Authentication → Sign In / Providers → Email → switch off “Confirm email”, save, then tap Continue again.');
    throw e;
  }
  if (r?.access_token) {
    account.patch({ status: '' });
    saveSession(r);
    await syncNow({ first: true });
    return 'Account created — you are signed in';
  }
  // Created but waiting for the email: confirm it here instead.
  if (!(await confirmEmail(email))) throw new Error(OLD_SQL);
  try {
    await passwordLogin(email, password);
  } catch (e) {
    // The email already had an account (Supabase doesn't say so when confirmation is on).
    if (/invalid login|invalid credentials/i.test(e.message)) throw new Error('Wrong password for this email. Tap “Forgot password?” if you need a new one.');
    throw e;
  }
  return 'Account created — you are signed in';
}

export const signUp = continueWith;
export const signIn = continueWith;

/** Which sign-in methods the server has switched on, e.g. { email: true, google: false }. */
export async function providers() {
  try {
    const r = await api('/auth/v1/settings');
    return { email: r?.external?.email !== false, google: !!r?.external?.google };
  } catch {
    return { email: true, google: false };
  }
}

export async function resetPassword(email) {
  await api('/auth/v1/recover', { method: 'POST', body: { email: email.trim() } });
  return 'Password reset email sent';
}

/** Google (or other OAuth providers enabled in Supabase) via the system browser. */
export async function signInWith(provider = 'google') {
  const url = `${server()}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(Capacitor.isNativePlatform() ? REDIRECT : location.href.split('#')[0])}`;
  if (Capacitor.isNativePlatform()) await Browser.open({ url });
  else location.href = url;
}

async function handleRedirect(href) {
  const frag = (href.split('#')[1] || href.split('?')[1] || '').trim();
  const p = new URLSearchParams(frag);
  if (p.get('error_description')) throw new Error(p.get('error_description'));
  const access = p.get('access_token');
  const refresh = p.get('refresh_token');
  if (!access || !refresh) return false;
  const user = await api('/auth/v1/user', { token: access });
  saveSession({ access_token: access, refresh_token: refresh, expires_in: +p.get('expires_in') || 3600, user });
  await syncNow({ first: true });
  return true;
}

export async function signOut() {
  try {
    if (cfg().accessToken) await api('/auth/v1/logout', { method: 'POST', token: cfg().accessToken });
  } catch {}
  account.patch({ userId: '', accessToken: '', refreshToken: '', expiresAt: 0, lastSync: 0, status: '' });
}

async function token(force = false) {
  if (!signedIn()) throw new Error('Not signed in');
  if (!force && Date.now() < cfg().expiresAt - 60e3) return cfg().accessToken;
  const r = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: cfg().refreshToken } });
  saveSession(r);
  return r.access_token;
}

// ---- sync ----------------------------------------------------------------------
function snapshot() {
  const out = {};
  for (const [k, s] of Object.entries(SECTIONS)) {
    if (s.secret && !cfg().syncKeys) continue;
    out[k] = { t: stamps.get()[k] || 0, v: s.store.get() };
  }
  return out;
}

function apply(remote) {
  applying = true;
  try {
    for (const [k, s] of Object.entries(SECTIONS)) {
      const r = remote?.[k];
      if (!r || (s.secret && !cfg().syncKeys)) continue;
      const localT = stamps.get()[k] || 0;
      const local = s.store.get();
      if (s.merge) s.store.set(s.merge(local, r.v));
      else if ((r.t || 0) > localT) s.store.set(Array.isArray(r.v) ? r.v : { ...local, ...r.v });
      stamps.set((st) => ({ ...st, [k]: Math.max(localT, r.t || 0) }));
    }
  } finally {
    // store writes are debounced; release after they flush
    setTimeout(() => (applying = false), 400);
  }
}

let syncing = null;
export function syncNow({ first = false } = {}) {
  if (!configured() || !signedIn()) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      account.patch({ status: 'Syncing…' });
      let tok = await token();
      const uid = cfg().userId;
      const read = () => api(`/rest/v1/user_data?select=data,updated_at&user_id=eq.${uid}`, { token: tok });
      let rows;
      try {
        rows = await read();
      } catch (e) {
        // The sign-in pass ran out early (phone clock off, or the phone slept): renew it and retry once.
        if (e.status !== 401 && !/jwt/i.test(e.message)) throw e;
        tok = await token(true);
        rows = await read();
      }
      if (rows?.[0]?.data) apply(rows[0].data);
      await api('/rest/v1/user_data', {
        method: 'POST',
        token: tok,
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { user_id: uid, data: snapshot(), updated_at: new Date().toISOString() },
      });
      account.patch({ lastSync: Date.now(), status: first ? 'Synced' : '' });
    } catch (e) {
      const hint = /relation .*user_data.* does not exist|42P01/i.test(e.message) ? ' — run the setup SQL in Supabase first' : '';
      account.patch({ status: 'Sync failed: ' + e.message + hint });
      if (e.status === 400 || e.status === 401) {
        if (/refresh/i.test(e.message)) account.patch({ refreshToken: '' });
      }
      throw e;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

// Push local edits a few seconds after they happen; pull again on resume.
let pushTimer = null;
for (const [k, s] of Object.entries(SECTIONS)) {
  s.store.subscribe(() => {
    if (applying) return;
    // Newer than anything seen so far, even if another device's clock runs ahead of this one's:
    // otherwise a copy stamped "in the future" would undo every change made here.
    stamps.set((st) => ({ ...st, [k]: Math.max(Date.now(), (st[k] || 0) + 1) }));
    if (!signedIn()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncNow().catch(() => {}), 8000);
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && signedIn() && Date.now() - cfg().lastSync > 60e3) syncNow().catch(() => {});
});
if (Capacitor.isNativePlatform()) {
  CapApp.addListener('appUrlOpen', ({ url }) => {
    if (!url.startsWith(REDIRECT)) return;
    Browser.close().catch(() => {});
    handleRedirect(url).catch((e) => account.patch({ status: 'Sign-in failed: ' + e.message }));
  });
} else if (/access_token=/.test(location.hash)) {
  handleRedirect(location.href).then(() => history.replaceState(null, '', location.pathname)).catch(() => {});
}
setTimeout(() => signedIn() && syncNow().catch(() => {}), 2500);

export const SETUP_SQL = `create table if not exists public.user_data (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_data enable row level security;
drop policy if exists "own data" on public.user_data;
create policy "own data" on public.user_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create or replace function public.audiohub_confirm(p_email text) returns void
  language sql security definer set search_path = auth, public as $$
  update auth.users set email_confirmed_at = now()
  where lower(email) = lower(p_email) and email_confirmed_at is null;
$$;
grant execute on function public.audiohub_confirm(text) to anon;`;
