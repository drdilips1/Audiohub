import { useEffect, useState } from 'preact/hooks';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { getJson } from '../lib/http.js';
import { persisted, useStore } from '../lib/store.js';

export const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';
const REPO = 'drdilips1/audiohub';
const update = persisted('update', { checkedAt: 0, latest: '', url: '', notes: '' });

const num = (v) => {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(v || '');
  return m ? +m[1] * 1e8 + +m[2] * 1e4 + +m[3] : 0;
};
// The web app is always the latest build; only the Android APK needs updating
// (the iPhone app is reinstalled from the Mac with AltStore).
const isApk = Capacitor.getPlatform() === 'android';
export const updateAvailable = () => isApk && APP_VERSION !== 'dev' && num(update.get().latest) > num(APP_VERSION);

// Updates are served from GitHub Pages (a fast CDN) with the GitHub release as a fallback.
const PAGES = 'https://drdilips1.github.io/audiohub/';

export async function checkForUpdate() {
  try {
    const j = await getJson(`${PAGES}app/latest.json?t=${Date.now()}`, { fresh: true, timeout: 12000 });
    if (j?.version && j.apk) {
      update.set({ checkedAt: Date.now(), latest: j.version, url: `${new URL(j.apk, PAGES).href}?v=${j.version}`, altUrl: j.github || '', notes: '' });
      return updateAvailable();
    }
  } catch {}
  const r = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`, { fresh: true });
  const asset = (r.assets || []).find((a) => /\.apk$/i.test(a.name));
  update.set({ checkedAt: Date.now(), latest: (r.tag_name || '').replace(/^(inkwell-)?v/, ''), url: asset?.browser_download_url || r.html_url, altUrl: '', notes: r.name || '' });
  return updateAvailable();
}

const Updater = registerPlugin('InkwellUpdate');
const nativeUpdater = isApk && Capacitor.isPluginAvailable('InkwellUpdate');

// Live state of an in-app update: idle | downloading | permission | installing | error.
const run = persisted('updateRun', { phase: 'idle', pct: 0, error: '', version: '', dismissed: '' });
let downloadedVersion = '';

/** Download the new version inside the app, then open Android's installer. */
export async function installUpdate() {
  const { url, altUrl, latest } = update.get();
  if (!url) return;
  if (!nativeUpdater || !/\.apk($|\?)/i.test(url)) {
    // Older app or no APK asset: fall back to the browser.
    return Capacitor.isNativePlatform() ? Browser.open({ url }) : window.open(url, '_blank');
  }
  try {
    if (downloadedVersion !== latest) {
      run.set((r) => ({ ...r, phase: 'downloading', pct: 0, error: '', version: latest }));
      const sub = await Updater.addListener('progress', (e) => run.set((r) => ({ ...r, pct: e.pct >= 0 ? e.pct : r.pct })));
      try {
        await Updater.download({ url }).catch((e) => {
          // Pages copy unavailable: fall back to the GitHub release file.
          if (!altUrl) throw e;
          run.set((r) => ({ ...r, pct: 0 }));
          return Updater.download({ url: altUrl });
        });
      } finally {
        sub.remove();
      }
      downloadedVersion = latest;
    }
    await openInstaller();
  } catch (e) {
    run.set((r) => ({ ...r, phase: 'error', error: e.message || String(e) }));
  }
}

async function openInstaller() {
  const { allowed } = await Updater.canInstall();
  if (!allowed) return run.set((r) => ({ ...r, phase: 'permission' }));
  run.set((r) => ({ ...r, phase: 'installing' }));
  await Updater.install();
}

/** Open Android's "Install unknown apps" switch for Audiohub; install resumes on return. */
export async function allowInstalls() {
  await Updater.allowInstall();
}

// Back from the settings screen with permission granted: carry on installing.
if (nativeUpdater) {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const r = run.get();
    if (r.phase === 'permission' && downloadedVersion) {
      const { allowed } = await Updater.canInstall().catch(() => ({ allowed: false }));
      if (allowed) openInstaller().catch((e) => run.set((x) => ({ ...x, phase: 'error', error: e.message })));
    } else if (r.phase === 'installing') {
      // Returned from the installer without installing (cancelled): offer it again.
      run.set((x) => ({ ...x, phase: 'ready' }));
    }
  });
}

export const openDownload = installUpdate;

// Check on every launch and whenever the app comes back to the screen (at most every
// 10 minutes), and pop the update sheet when there's a new version. Android usually
// resumes the app rather than restarting it, so a launch-only check could miss updates.
if (isApk && APP_VERSION !== 'dev') {
  run.set((r) => ({ ...r, phase: 'idle', pct: 0, error: '' }));
  setTimeout(() => checkForUpdate().catch(() => {}), 3000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - update.get().checkedAt > 10 * 60e3 && run.get().phase === 'idle') checkForUpdate().catch(() => {});
  });
}

/** The pop-up offering a new version. */
export function UpdatePrompt() {
  const u = useStore(update);
  const r = useStore(run);
  const avail = isApk && APP_VERSION !== 'dev' && num(u.latest) > num(APP_VERSION);
  const active = r.phase !== 'idle' && r.version === u.latest;
  if (!avail || (!active && r.dismissed === u.latest)) return null;
  const close = () => run.set((x) => ({ ...x, phase: 'idle', dismissed: u.latest }));
  return (
    <div class="sheet-backdrop update-sheet" onClick={(e) => e.target === e.currentTarget && r.phase !== 'downloading' && close()}>
      <div class="sheet">
        <div class="update-head">
          <Icon name="download" size={22} />
          <div>
            <b>Audiohub {u.latest} is ready</b>
            <small>You have {APP_VERSION}. Installs over this one — your books, progress and settings stay.</small>
          </div>
        </div>
        {r.phase === 'downloading' ? (
          <div class="update-progress">
            <div class="progress-bar">
              <div style={{ width: `${r.pct || 0}%` }} />
            </div>
            <small>Downloading… {r.pct || 0}%</small>
          </div>
        ) : r.phase === 'permission' ? (
          <div class="update-step">
            <p>
              Android needs your OK once: switch on <b>Allow from this source</b> for Audiohub, then come back — the install continues by itself.
            </p>
            <button class="btn primary big" onClick={() => allowInstalls().catch((e) => toast(e.message))}>
              Open the setting
            </button>
          </div>
        ) : r.phase === 'installing' ? (
          <div class="update-step">
            <p>Tap <b>Update</b> (or Install) on Android's screen. Audiohub restarts with the new version.</p>
            <button class="btn secondary" onClick={() => installUpdate()}>
              Open the installer again
            </button>
          </div>
        ) : (
          <>
            {r.phase === 'error' && <p class="err">{r.error}</p>}
            <div class="update-actions">
              <button class="btn secondary" onClick={close}>
                Later
              </button>
              <button class="btn primary" onClick={() => installUpdate()}>
                <Icon name="download" size={16} /> {r.phase === 'error' ? 'Try again' : 'Update now'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function UpdateCard() {
  const u = useStore(update);
  const [busy, setBusy] = useState(false);
  const avail = isApk && APP_VERSION !== 'dev' && num(u.latest) > num(APP_VERSION);
  if (!isApk) {
    return (
      <section class="set-section">
        <div class="update-card">
          <div>
            <b>Audiohub web app</b>
            <small>Always the latest version — just reopen it.</small>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section class="set-section">
      <div class={'update-card' + (avail ? ' avail' : '')}>
        <div>
          <b>{avail ? `Update available: ${u.latest}` : `Audiohub ${APP_VERSION}`}</b>
          <small>{avail ? 'Installs over this version — your data stays.' : u.checkedAt ? 'You have the latest version' : 'Check for a newer build'}</small>
        </div>
        {avail ? (
          <button class="btn primary" onClick={openDownload}>
            <Icon name="download" size={16} /> Download
          </button>
        ) : (
          <button
            class="pill small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                toast((await checkForUpdate()) ? 'Update available' : 'You are up to date');
              } catch (e) {
                toast(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <span class="spinner small" /> : 'Check'}
          </button>
        )}
      </div>
    </section>
  );
}
