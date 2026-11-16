// App shell: five tabs (Home, Explore, Create, Occasions, My Cards) with full-screen
// pages (results, editor, settings) opening on top.
import { useEffect } from 'preact/hooks';
import { useNav, go, back, open } from './lib/nav.js';
import { useStore } from './lib/store.js';
import { scheduleReminders, onReminderTap } from './lib/reminders.js';
import { Home } from './screens/Home.jsx';
import { Explore } from './screens/Explore.jsx';
import { Create } from './screens/Create.jsx';
import { Occasions } from './screens/Occasions.jsx';
import { MyCards } from './screens/MyCards.jsx';
import { Results } from './screens/Results.jsx';
import { Editor } from './screens/Editor.jsx';
import { Settings } from './screens/Settings.jsx';
import { Welcome } from './screens/Welcome.jsx';
import { Toast, Icon } from './components/ui.jsx';

const TABS = [['home', 'Home', Icon.home], ['explore', 'Explore', Icon.explore], ['create', 'Create', Icon.create], ['occasions', 'Occasions', Icon.calendar], ['mycards', 'My Cards', Icon.cards]];
const SCREENS = { home: Home, explore: Explore, create: Create, occasions: Occasions, mycards: MyCards };
const PAGES = { results: Results, editor: Editor, settings: Settings };

export function App() {
  const nav = useNav();
  const settings = useStore('settings');

  useEffect(() => {
    scheduleReminders().catch(() => {});
    onReminderTap((extra) => { if (extra.occasion) open('results', { req: { occasion: extra.occasion === 'custom' ? null : extra.occasion } }); });
    let sub;
    import('@capacitor/app').then(({ App: CapApp }) => {
      sub = CapApp.addListener('backButton', () => { if (!back()) CapApp.exitApp(); });
    }).catch(() => {});
    return () => sub?.then?.((h) => h.remove());
  }, []);

  if (!settings.onboarded) return <><Welcome /><Toast /></>;

  const top = nav.stack[nav.stack.length - 1];
  const Screen = SCREENS[nav.tab];
  const Page = top && PAGES[top.page];
  return (
    <div class="app">
      <main class={Page ? 'hidden-under' : ''}><Screen /></main>
      {Page && <div class="page" key={top.key}><Page {...top.props} /></div>}
      {!Page && (
        <nav class="tabbar" aria-label="Main">
          {TABS.map(([id, label, icon]) => (
            <button class={`tab${nav.tab === id ? ' on' : ''}${id === 'create' ? ' create' : ''}`} aria-current={nav.tab === id ? 'page' : undefined} onClick={() => go(id)}>
              <span class="tab-icon">{icon}</span><span>{label}</span>
            </button>
          ))}
        </nav>
      )}
      <Toast />
    </div>
  );
}
