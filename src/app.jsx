import * as qbit from './sources/qbit.js';
import { useEffect, useState } from 'preact/hooks';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { nav } from './lib/nav.js';
import { settings, useStore } from './lib/store.js';
import { applyTheme } from './lib/theme.js';
import { Icon } from './components/icons.jsx';
import { Toaster, Guard } from './components/common.jsx';
import { UpdatePrompt } from './components/update.jsx';
import { MiniPlayer, FullPlayer, usePlayer } from './components/player-ui.jsx';
import { Home } from './screens/Home.jsx';
import { Discover } from './screens/Discover.jsx';
import { Library } from './screens/Library.jsx';
import { Settings } from './screens/Settings.jsx';
import { Book } from './screens/Book.jsx';
import { Browse } from './screens/Browse.jsx';
import { Reader } from './screens/Reader.jsx';
import { Shelf } from './screens/Shelf.jsx';
import { Podcasts, Podcast } from './screens/Podcasts.jsx';
import { PullToRefresh } from './components/pull-refresh.jsx';
import { clearHttpCache } from './lib/http.js';
import { cloud, hc, gr } from './sources/index.js';
import { toast } from './components/common.jsx';

const TABS = [
  ['home', 'Home', 'home'],
  ['discover', 'Discover', 'search'],
  ['podcasts', 'Podcasts', 'mic'],
  ['library', 'Library', 'library'],
  ['settings', 'Settings', 'settings'],
];
const ROOTS = { home: Home, discover: Discover, podcasts: Podcasts, library: Library, tracker: Settings, settings: Settings }; // tracker: the old tab, now in Settings
const ROUTES = { book: Book, browse: Browse, reader: Reader, shelf: Shelf, podcast: Podcast };

export function App() {
  const [route, setRoute] = useState(nav.state());
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => {
    clearHttpCache();
    cloud.forget();
    hc.resetCache();
    if (gr.profileConnected()) gr.syncProfile().catch(() => {});
    setRefreshKey((k) => k + 1);
    toast('Refreshed');
  };
  const st = useStore(settings);
  const ps = usePlayer();

  useEffect(() => nav.subscribe(setRoute), []);
  useEffect(() => {
    // Hand new cloud audiobooks to the home server, if that's switched on.
    const go = () => qbit.autoForward().then((msg) => msg && toast(msg));
    const t = setTimeout(go, 4000);
    const onResume = () => document.visibilityState === 'visible' && go();
    document.addEventListener('visibilitychange', onResume);
    // Also every 5 minutes while the app is open (auto-send runs at most every 3).
    const iv = setInterval(() => document.visibilityState === 'visible' && go(), 5 * 60e3);
    return () => (clearTimeout(t), clearInterval(iv), document.removeEventListener('visibilitychange', onResume));
  }, []);
  useEffect(() => {
    applyTheme(st);
    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: st.mode === 'light' ? Style.Light : Style.Dark }).catch(() => {});
    }
  }, [st.mode, st.accent]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener('backButton', () => {
      if (!nav.back()) CapApp.minimizeApp();
    });
    return () => h.then((x) => x.remove());
  }, []);

  const top = route.top;
  const Screen = top ? ROUTES[top.name] : ROOTS[route.tab];
  const inReader = top?.name === 'reader';

  return (
    <div class={'app' + (ps.book ? ' has-player' : '')}>
      <div class="ambient" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <PullToRefresh onRefresh={refresh} enabled={!route.overlay && (!top || top.name === 'shelf' || top.name === 'book' || top.name === 'browse')} />
      <main key={(top?.key || route.tab) + ':' + refreshKey} class="page">
        <Guard key={(top?.key || route.tab) + ':' + refreshKey} fallback={(e, retry) => <ScreenError error={e} retry={retry} />}>
          <Screen {...(top?.params || {})} />
        </Guard>
      </main>
      {!inReader && (
        <>
          <MiniPlayer />
          <nav class="tabbar">
            {TABS.map(([k, label, icon]) => (
              <button class={route.tab === k ? 'on' : ''} onClick={() => nav.tab(k)}>
                <Icon name={icon} size={22} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </>
      )}
      {route.overlay === 'player' && <FullPlayer />}
      <UpdatePrompt />
      <Toaster />
    </div>
  );
}

/** Shown instead of a screen that failed, with the error so it can be reported. */
function ScreenError({ error, retry }) {
  const text = `${error?.message || error}\n${String(error?.stack || '').split('\n').slice(0, 6).join('\n')}`;
  return (
    <div class="screen screen-error">
      <h2>This screen hit a problem</h2>
      <p class="muted">The rest of the app still works. Please send this to the developer:</p>
      <pre>{text}</pre>
      <div class="chips">
        <button class="pill" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Long-press the text to copy'))}>
          Copy
        </button>
        <button class="pill ghost" onClick={retry}>
          Try again
        </button>
      </div>
    </div>
  );
}
