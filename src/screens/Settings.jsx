import { useEffect, useRef, useState } from 'preact/hooks';
// Save / open backup files with Android's own file screens.
import { Native as Files, available as files } from '../sources/local.js';
import { Icon } from '../components/icons.jsx';
import { toast } from '../components/common.jsx';
import { settings, addons, abs, debrid, hardcover, goodreads, useStore, exportBackup, importBackup } from '../lib/store.js';
import { SOURCES, absSrc, addonSrc, cloud, localSrc, hc, gr, sourceOrder } from '../sources/index.js';
import { clearHttpCache, isWeb, relayUrl, setRelayUrl, probeRelay, defaultRelayUrl } from '../lib/http.js';
import { searchSources, sourceAddons } from '../sources/sourceaddons.js';
import { ai, PROVIDERS as AI_PROVIDERS, testProvider } from '../lib/ai.js';
import relayCode from '../../relay/index.ts?raw';
import { ACCENTS, PALETTES } from '../lib/theme.js';
import { WALLPAPERS, wallpaperUrl, saveCustom, useCustomWallpaper } from '../lib/wallpaper.js';
import { APP_VERSION } from '../components/update.jsx';
import { PROVIDERS, clearMetaCache } from '../lib/meta.js';
import { AccountCard, VoicesCard, DownloadsCard } from './settings-extra.jsx';
import { UpdateCard } from '../components/update.jsx';
import { nav } from '../lib/nav.js';
import * as qb from '../sources/qbit.js';
import { QbitListActions } from '../components/qbit-actions.jsx';
import { TrackerCard } from './Tracker.jsx';
import { pickTorrentFile } from '../lib/torrentfile.js';

// Which sections are open; kept while the app runs so going back to Settings keeps them.
const openSections = new Set();

/** A settings group that stays collapsed until you tap its title. */
function Section({ icon, title, children }) {
  const [open, setOpen] = useState(openSections.has(title));
  const toggle = () => {
    if (open) openSections.delete(title);
    else openSections.add(title);
    setOpen(!open);
  };
  return (
    <section class={'set-section' + (open ? ' open' : '')}>
      <button class="set-head" aria-expanded={open} onClick={toggle}>
        <Icon name={icon} size={20} />
        <span>{title}</span>
        <Icon name="down" size={18} />
      </button>
      {open && <div class="set-card">{children}</div>}
    </section>
  );
}

function LocalBooksCard() {
  const cfg = useStore(localSrc.localCfg);
  const [busy, setBusy] = useState('');
  const run = (label, fn) => async () => {
    setBusy(label);
    try {
      const books = await fn();
      toast(`${books.length} audiobook${books.length === 1 ? '' : 's'} found`);
    } catch (e) {
      if (!/no folder chosen/i.test(e.message)) toast(e.message);
    } finally {
      setBusy('');
    }
  };
  if (!localSrc.available) return <p class="muted">Playing audiobook files from your phone works in the Android app.</p>;
  return (
    <div>
      <p class="muted">
        Pick the folder where your audiobooks are (for example <b>Audiobooks</b> or <b>Download</b>). Each book folder inside becomes a book — with its parts in order — and plays straight from the phone, offline too. Android asks for access to that folder only.
      </p>
      {cfg.folders.map((f) => (
        <div class="set-row">
          <div>
            <b>{decodeURIComponent(f.name)}</b>
            <small>{cfg.books.filter((b) => b.folder === f.uri).length} audiobooks</small>
          </div>
          <button class="pill small" onClick={() => localSrc.removeFolder(f.uri)}>
            Remove
          </button>
        </div>
      ))}
      <div class="btn-row">
        <button class="btn primary" disabled={!!busy} onClick={run('add', localSrc.addFolder)}>
          {busy === 'add' ? <span class="spinner" /> : <Icon name="plus" size={16} />} {cfg.folders.length ? 'Add another folder' : 'Choose a folder'}
        </button>
        {cfg.folders.length > 0 && (
          <button class="btn secondary" disabled={!!busy} onClick={run('scan', localSrc.rescan)}>
            {busy === 'scan' ? <span class="spinner" /> : <Icon name="shuffle" size={16} />} Rescan
          </button>
        )}
      </div>
    </div>
  );
}

function MusicToggle() {
  const [on, setOn] = useState(!!debrid.get().showMusic);
  return (
    <Toggle
      label="Show music too"
      hint="Off (usual): music albums and songs in your cloud are left out, so only audiobooks show"
      on={on}
      onChange={(v) => {
        debrid.patch({ showMusic: v });
        cloud.forget?.();
        setOn(v);
      }}
    />
  );
}

function Toggle({ on, onChange, label, hint }) {
  return (
    <label class="set-row">
      <div>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </div>
      <input type="checkbox" class="switch" checked={on} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}

/**
 * Sources in the user's order: drag the grip (or use the arrows) to rearrange.
 * The order is used for Home rows, the banner and Discover search results.
 */
function SourceOrder({ st, setSource }) {
  const order = sourceOrder();
  const listRef = useRef();
  const [drag, setDrag] = useState(null); // { key, y, offset }
  const save = (next) => settings.patch({ sourceOrder: next });
  const move = (k, delta) => {
    const next = order.slice();
    const i = next.indexOf(k);
    const j = Math.max(0, Math.min(next.length - 1, i + delta));
    if (i === j) return;
    next.splice(j, 0, ...next.splice(i, 1));
    save(next);
  };
  // Dragging: follow the finger (or mouse) on the whole page while the grip is held, and
  // stop the page from scrolling meanwhile. Touch events, because Android cancels pointer
  // drags as soon as it decides the finger is scrolling.
  const live = useRef(null);
  live.current = { order, move };
  const startDrag = (k, y0) => {
    let startY = y0;
    const rowH = () => listRef.current?.querySelector('.so-row')?.getBoundingClientRect().height || 60;
    setDrag({ key: k, dy: 0 });
    const onMoveY = (y) => {
      const dy = y - startY;
      const h = rowH();
      const shift = Math.round(dy / h);
      if (shift) {
        live.current.move(k, shift);
        startY += shift * h;
      }
      setDrag({ key: k, dy: y - startY });
    };
    const touchMove = (e) => {
      e.preventDefault();
      onMoveY(e.touches[0].clientY);
    };
    const mouseMove = (e) => onMoveY(e.clientY);
    const end = () => {
      document.removeEventListener('touchmove', touchMove);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
      document.removeEventListener('mousemove', mouseMove);
      document.removeEventListener('mouseup', end);
      setDrag(null);
    };
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', end);
  };
  return (
    <div class="so-order" ref={listRef}>
      <p class="set-note">Drag ⋮⋮ or use the arrows to choose the order of rows on Home and results in Discover.</p>
      {order.map((k, i) => {
        const s = SOURCES[k];
        const key = k === 'addon' ? 'addons' : k;
        const on = st.sources[key] !== false;
        const dragging = drag?.key === k;
        return (
          <div class={'set-row so-row' + (dragging ? ' dragging' : '') + (on ? '' : ' off')} key={k} style={dragging ? { transform: `translateY(${drag.dy}px)` } : null}>
            <button
              class="icon-btn so-grip"
              aria-label={`Drag ${s.name}`}
              onTouchStart={(e) => startDrag(k, e.touches[0].clientY)}
              onMouseDown={(e) => {
                e.preventDefault();
                startDrag(k, e.clientY);
              }}
            >
              <Icon name="grip" size={20} />
            </button>
            <div class="so-text">
              <b>
                <span class="so-num">{i + 1}</span> {s.name}
              </b>
              <small>{s.blurb}</small>
            </div>
            <div class="so-arrows">
              <button class="icon-btn" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => move(k, -1)}>
                <Icon name="up" size={16} />
              </button>
              <button class="icon-btn" aria-label={`Move ${s.name} down`} disabled={i === order.length - 1} onClick={() => move(k, 1)}>
                <Icon name="down" size={16} />
              </button>
            </div>
            <input type="checkbox" class="switch" aria-label={`Use ${s.name}`} checked={on} onChange={(e) => setSource(key, e.currentTarget.checked)} />
          </div>
        );
      })}
      {(st.sourceOrder || []).length > 0 && (
        <button class="pill small so-reset" onClick={() => save([])}>
          Reset order
        </button>
      )}
    </div>
  );
}

/**
 * Web app only: Safari blocks some services (Hardcover, Audible, Goodreads,
 * and similar), so they go through a small relay in the user's Supabase project.
 */
function WebRelayCard() {
  const [checks, setChecks] = useState(null); // [[name, ok, message]]
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(relayUrl());
  const deb = debrid.get();
  const run = async () => {
    setBusy(true);
    const out = [];
    const push = (name, ok, msg) => {
      out.push([name, ok, msg]);
      setChecks(out.slice());
    };
    const check = async (name, fn) => {
      try {
        push(name, true, (await fn()) || 'OK');
      } catch (e) {
        push(name, false, e.message || String(e));
      }
    };
    const r = await probeRelay();
    push('Relay', r.ok, r.ok ? `Working (v${r.version})${r.note ? ` — ${r.note}` : ''}` : r.error);
    if (deb.torbox) await check('TorBox', () => cloud.verify('torbox', deb.torbox));
    if (deb.realdebrid) await check('Real-Debrid', () => cloud.verify('realdebrid', deb.realdebrid));
    if (hc.connected()) await check('Hardcover', async () => `${(await hc.counts()).reading} reading`);
    if (absSrc.connected()) await check('Audiobookshelf', async () => `${(await absSrc.recent()).length} recent books`);
    if (sourceAddons().length)
      await check('Source addons', async () => {
        const errs = [];
        let n = 0;
        await searchSources({ query: 'sapiens' }, (name, res, err) => (err ? errs.push(`${name}: ${err.message}`) : (n += res.length)));
        if (errs.length && !n) throw new Error(errs.join(' · '));
        return `${n} results${errs.length ? ` (${errs.join(' · ')})` : ''}`;
      });
    setBusy(false);
  };
  return (
    <>
      <p class="muted">
        On iPhone and iPad, Safari blocks a few services — Hardcover, Audible listings and Goodreads — unless they go through a small relay in your
        Supabase project. Everything else (TorBox, Real-Debrid, Audiobookshelf over https, free sources) works directly.
      </p>
      <div class="set-row">
        <div>
          <b>Check services</b>
          <small>Tests the relay and each connected service from this device</small>
        </div>
        <button class="pill small" onClick={run} disabled={busy}>
          {busy ? <span class="spinner small" /> : 'Check'}
        </button>
      </div>
      {checks && (
        <ul class="svc-checks">
          {checks.map(([name, ok, msg]) => (
            <li class={ok ? 'ok' : 'bad'}>
              <b>{ok ? '✓' : '✗'} {name}</b> <span>{msg}</span>
            </li>
          ))}
        </ul>
      )}
      <details class="relay-help">
        <summary>Set up or update the relay (5 minutes)</summary>
        <ol>
          <li>
            Tap <b>Copy relay code</b> below.
          </li>
          <li>
            Open <b>supabase.com</b> → your project → <b>Edge Functions</b> → <b>Deploy a new function</b> → <b>Via Editor</b>.
          </li>
          <li>
            Name it <b>relay</b> (or open your existing <b>relay</b> → Code), replace all the code with the copied code, and tap <b>Deploy</b>.
          </li>
          <li>Come back here and tap Check.</li>
        </ol>
        <p class="muted">
          <b>Safari or iPhone still failing?</b> Supabase's gateway can refuse Safari. Run the same relay on Cloudflare instead (free): <b>dash.cloudflare.com</b> →{' '}
          <b>Workers &amp; Pages</b> → <b>Create</b> → <b>Worker</b> → name it <b>audiohub-relay</b> → <b>Deploy</b> → <b>Edit code</b> → replace everything with the copied
          relay code → <b>Deploy</b>. Then paste the worker's address (…<b>.workers.dev</b>) into the box below and tap Check.
        </p>
        <button
          class="btn ghost-wide"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(relayCode);
              toast('Relay code copied');
            } catch {
              toast('Could not copy — long-press to select the code instead');
            }
          }}
        >
          <Icon name="upload" size={16} /> Copy relay code
        </button>
      </details>
      <div class="set-row">
        <input
          value={url}
          placeholder="https://<project>.supabase.co/functions/v1/relay"
          onChange={(e) => {
            const v = e.currentTarget.value.trim();
            setRelayUrl(v);
            setUrl(relayUrl());
            setChecks(null);
          }}
        />
      </div>
      {defaultRelayUrl() && url !== defaultRelayUrl() && (
        <button
          class="btn ghost-wide"
          onClick={() => {
            setRelayUrl('');
            setUrl(relayUrl());
            setChecks(null);
            toast('Using the built-in relay address — tap Check');
          }}
        >
          Use built-in address
        </button>
      )}
    </>
  );
}

/** Free AI keys (Groq, OpenRouter) for the bookseller, recaps and the character guide. */
function AiCard() {
  const cfg = useStore(ai);
  return (
    <>
      <p class="muted">
        Powers the <b>bookseller</b>, <b>Picked for you</b> and <b>Story</b> in the player (spoiler-free recaps and characters). Add one or more free keys: if one service is busy the app switches to the next automatically.
        Without a key the bookseller still works from the Audible catalogue.
      </p>
      {AI_PROVIDERS.map((p) => (
        <AiKey p={p} saved={cfg[p.keyField] || ''} />
      ))}
      <p class="muted small">
        <b>Groq</b> is the fastest and most generous (recommended). <b>OpenRouter</b> gives free Llama, DeepSeek and Qwen models. No card is needed for either.
      </p>
    </>
  );
}

function AiKey({ p, saved }) {
  const [key, setKey] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(''); // '' | 'ok' | error text
  return (
    <div class="ai-key">
      <div class="ai-key-head">
        <b>{p.name}</b>
        <small class="muted">free key at {p.site}</small>
        {saved && state === 'ok' && <span class="ok-dot">Working</span>}
      </div>
      <div class="set-row">
        <input type="password" value={key} placeholder={`${p.name} API key`} onInput={(e) => setKey(e.currentTarget.value)} autocomplete="off" />
        <button
          class="btn"
          disabled={busy || key.trim() === saved}
          onClick={async () => {
            ai.patch({ [p.keyField]: key.trim() });
            setState('');
            if (!key.trim()) return toast(`${p.name} key removed`);
            setBusy(true);
            try {
              toast(await testProvider(p.id));
              setState('ok');
            } catch (e) {
              setState(e.message);
              toast(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <span class="spinner small" /> : 'Save'}
        </button>
      </div>
      {state && state !== 'ok' && <p class="err small">{state}</p>}
    </div>
  );
}

function Stepper({ label, value, options, onChange, fmt = (v) => v }) {
  return (
    <div class="set-row">
      <b>{label}</b>
      <div class="chips">
        {options.map((o) => (
          <button class={'pill small' + (o === value ? ' active' : '')} onClick={() => onChange(o)}>
            {fmt(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Home server: hand cloud audiobooks to your qBittorrent, saved into Audiobookshelf's folder. */
function QbitCard() {
  const cfg = useStore(qb.qbit);
  const sent = useStore(qb.qbitSent);
  const [form, setForm] = useState({ url: cfg.url, lanUrl: cfg.lanUrl || '', username: cfg.username, password: cfg.password, apiKey: cfg.apiKey || '', savePath: cfg.savePath, ebookPath: cfg.ebookPath || '', category: cfg.category });
  const [busy, setBusy] = useState('');
  const [list, setList] = useState(null);
  const [magnet, setMagnet] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.currentTarget.value }));
  const run = async (what, fn) => {
    setBusy(what);
    try {
      toast(await fn());
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };
  const refresh = () => qb.status().then(setList).catch((e) => toast(e.message));
  useEffect(() => {
    if (qb.available && cfg.url && Object.keys(sent.items).length) refresh();
  }, [cfg.url]);
  const pct = (x) => `${Math.round((x || 0) * 100)}%`;
  return (
    <>
      <p class="muted">
        Send your TorBox / Real-Debrid audiobooks to <b>qBittorrent</b> at home (over Tailscale). It saves them into your <b>Audiobookshelf</b> library folder and downloads on its own — your phone can be off. Turn on qBittorrent's Web UI (Tools → Options → Web UI).
        {!qb.available && ' Works in the Android app.'}
      </p>
      {(cfg.url || cfg.lanUrl) && (
        <div class="set-row">
          <div>
            <b>{cfg.version ? 'Connected' : 'Not tested yet'}</b>
            <small>
              {cfg.version ? `qBittorrent ${cfg.version} · ${qb.addressInUse() || cfg.url || cfg.lanUrl}` : cfg.url || cfg.lanUrl}
              {cfg.version && cfg.lanUrl && qb.addressInUse() ? (qb.addressInUse().includes(cfg.lanUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')) ? ' (home Wi-Fi)' : ' (Tailscale)') : ''}
              {cfg.version && cfg.savePath ? ` · saves to ${cfg.savePath}` : ''}
            </small>
          </div>
          <button class="pill small" disabled={!!busy} onClick={() => run('test', qb.test)}>
            {busy === 'test' ? <span class="spinner small" /> : 'Test'}
          </button>
        </div>
      )}
      <form
        class="set-form"
        onSubmit={(e) => {
          e.preventDefault();
          qb.qbit.set((c) => ({ ...c, ...form, url: form.url.trim(), lanUrl: form.lanUrl.trim(), apiKey: form.apiKey.trim(), savePath: form.savePath.trim(), ebookPath: form.ebookPath.trim(), version: '' }));
          run('test', qb.test);
        }}
      >
        <input value={form.lanUrl} placeholder="At home (Wi-Fi), e.g. http://192.168.1.20:8080" autocapitalize="off" onInput={set('lanUrl')} />
        <input value={form.url} placeholder="Away (Tailscale), e.g. http://100.101.102.103:8080" autocapitalize="off" onInput={set('url')} />
        <small class="muted qbit-hint">Audiohub uses the home address when it answers (no Tailscale needed on your Wi-Fi) and the Tailscale one everywhere else. Fill in either or both.</small>
        <input value={form.username} placeholder="Web UI username" autocapitalize="off" autocomplete="username" onInput={set('username')} />
        <input value={form.password} type="password" placeholder="Web UI password" autocomplete="current-password" onInput={set('password')} />
        <input value={form.apiKey} placeholder="Or API key (qBittorrent 5.2+, starts with qbt_)" autocapitalize="off" autocomplete="off" onInput={set('apiKey')} />
        <input value={form.savePath} placeholder="Save to (your Audiobookshelf folder, e.g. /audiobooks)" autocapitalize="off" onInput={set('savePath')} />
        <input value={form.ebookPath} placeholder={`Ebooks to${qb.ebookFolder() ? ` (default ${qb.ebookFolder()})` : ', e.g. /ebooks'}`} autocapitalize="off" onInput={set('ebookPath')} />
        <small class="muted qbit-hint">Ebook torrents (EPUB, PDF, MOBI… with no audio files) go to this folder, not the audiobook folder. Left empty, they go to an Ebooks folder next to your audiobook folder.</small>
        <input value={form.category} placeholder="Category (optional)" autocapitalize="off" onInput={set('category')} />
        <button class="btn primary" disabled={!!busy || !(form.url.trim() || form.lanUrl.trim())}>
          {busy === 'test' ? <span class="spinner small" /> : 'Save & test'}
        </button>
      </form>
      {(cfg.url || cfg.lanUrl) && (
        <>
          <label class="set-row">
            <div>
              <b>Send new cloud audiobooks automatically</b>
              <small>When you open the app, anything new in TorBox / Real-Debrid (added after you switch this on) goes to qBittorrent.</small>
            </div>
            <input type="checkbox" class="switch" checked={cfg.auto} onChange={(e) => qb.qbit.set((c) => ({ ...c, auto: e.currentTarget.checked, autoSince: e.currentTarget.checked ? Date.now() : c.autoSince }))} />
          </label>
          {cfg.auto && <AutoSendStatus />}
          <form
            class="set-form inline"
            onSubmit={async (e) => {
              e.preventDefault();
              const m = magnet.trim();
              if (!m) {
                const file = await pickTorrentFile();
                if (file) run('add', () => qb.sendFile(file));
                return;
              }
              await run('add', () => qb.sendMagnet(m));
              setMagnet('');
            }}
          >
            <input placeholder="Magnet — or tap + for a .torrent file" value={magnet} onInput={(e) => setMagnet(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
            <button class="btn primary" disabled={!!busy} aria-label={magnet.trim() ? 'Send' : 'Choose a .torrent file'}>
              {busy === 'add' ? <span class="spinner" /> : <Icon name="plus" size={16} />}
            </button>
          </form>
          <div class="chips">
            <button class="pill small ghost" disabled={!!busy} onClick={refresh}>
              Check progress
            </button>
            <button class="pill small ghost" disabled={!!busy} onClick={() => run('fix', async () => { const m = await qb.fixStuck(); setTimeout(refresh, 3000); return m; })}>
              {busy === 'fix' ? <span class="spinner small" /> : 'Fix stuck downloads'}
            </button>
            <QbitListActions list={list} busy={busy} run={run} refresh={refresh} setList={setList} />
          </div>
          {list && (
            <div class="qbit-list">
              {list.length ? (
                list.slice(0, 20).map((t) => (
                  <div class="qbit-item">
                    <div>
                      <b>{t.name}</b>
                      <small>
                        {t.progress >= 1 ? `Done${t.savePath ? ` · ${t.savePath}` : ''}` : `${pct(t.progress)} · ${qb.stateLabel(t.state)}`}
                        {t.speed > 0 ? ` · ${(t.speed / 1e6).toFixed(1)} MB/s` : ''}
                      </small>
                    </div>
                    <div class="progress-bar">
                      <div style={{ width: pct(t.progress) }} />
                    </div>
                  </div>
                ))
              ) : (
                <small class="muted">Nothing sent yet (or removed from qBittorrent).</small>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

function AbsCard() {
  const cfg = useStore(abs);
  const [alt, setAlt] = useState(cfg.altServer || '');
  const [inUse, setInUse] = useState('');
  useEffect(() => {
    if (cfg.token && cfg.altServer) absSrc.resolveServer(true).then(setInUse).catch(() => {});
  }, [cfg.token, cfg.altServer]);
  const [server, setServer] = useState(cfg.server || '');
  const [mode, setMode] = useState('password');
  const [user, setUser] = useState(cfg.username || '');
  const [pass, setPass] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [libs, setLibs] = useState(null);
  if (cfg.token) {
    return (
      <>
        <div class="set-row">
          <div>
            <b>Connected</b>
            <small>
              {cfg.username} @ {cfg.server}
              {cfg.altServer && (
                <>
                  <br />
                  In use: {inUse || 'checking…'}
                </>
              )}
            </small>
          </div>
          <button class="pill danger small" onClick={() => absSrc.logout()}>
            Sign out
          </button>
        </div>
        <div class="set-row">
          <b>Library</b>
          {libs ? (
            <select value={cfg.libraryId} onChange={(e) => abs.patch({ libraryId: e.currentTarget.value })}>
              {libs.map((l) => (
                <option value={l.id}>{l.name}</option>
              ))}
            </select>
          ) : (
            <button class="pill small" onClick={() => absSrc.libraries().then(setLibs).catch((e) => toast(e.message))}>
              Choose…
            </button>
          )}
        </div>
        <div class="set-row">
          <div>
            <b>Ebooks library</b>
            <small>Optional: a library of ebooks on your server to show in the app too (Read, Kindle).</small>
          </div>
          {libs ? (
            <select value={cfg.ebookLibraryId || ''} onChange={(e) => abs.patch({ ebookLibraryId: e.currentTarget.value })}>
              <option value="">Same as above</option>
              {libs.filter((l) => l.mediaType === 'book').map((l) => (
                <option value={l.id}>{l.name}</option>
              ))}
            </select>
          ) : (
            <button class="pill small" onClick={() => absSrc.libraries().then(setLibs).catch((e) => toast(e.message))}>
              Choose…
            </button>
          )}
        </div>
        <form
          class="set-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const used = await absSrc.setAltServer(alt);
              setInUse(used);
              toast(alt.trim() ? `Saved — now using ${used}` : 'Second address removed');
            } catch (err) {
              toast(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <small class="muted">Second address — e.g. Tailscale (100.x.y.z:port or your MagicDNS name). The app uses whichever address answers and switches automatically when one stops working.</small>
          <div class="btn-row">
            <input placeholder="http://100.101.102.103:13378" value={alt} onInput={(e) => setAlt(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} inputmode="url" />
            <button class="btn secondary" style={{ flex: 'none' }} disabled={busy}>
              {busy ? <span class="spinner" /> : 'Save'}
            </button>
          </div>
        </form>
      </>
    );
  }
  return (
    <form
      class="set-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const l = mode === 'key' ? await absSrc.loginWithKey(server, key) : await absSrc.login(server, user, pass);
          setLibs(l);
          setPass('');
          setKey('');
          toast('Connected to Audiobookshelf');
        } catch (err) {
          toast(err.message || 'Could not connect');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p class="muted">Stream from your own Audiobookshelf server. Progress syncs both ways. A LAN address like 192.168.1.20:13378 works.</p>
      <input placeholder="Server address, e.g. 192.168.1.20:13378" value={server} onInput={(e) => setServer(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} inputmode="url" />
      <div class="segmented tight">
        <button type="button" class={mode === 'password' ? 'on' : ''} onClick={() => setMode('password')}>
          Password
        </button>
        <button type="button" class={mode === 'key' ? 'on' : ''} onClick={() => setMode('key')}>
          API key
        </button>
      </div>
      {mode === 'password' ? (
        <>
          <input placeholder="Username" value={user} onInput={(e) => setUser(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
          <input placeholder="Password" type="password" value={pass} onInput={(e) => setPass(e.currentTarget.value)} />
        </>
      ) : (
        <input placeholder="API key (ABS → Settings → API Keys)" value={key} onInput={(e) => setKey(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
      )}
      <button class="btn primary" disabled={busy || !server || (mode === 'password' ? !user : !key)}>
        {busy ? <span class="spinner" /> : <Icon name="link" size={16} />} Connect
      </button>
    </form>
  );
}

function DebridCard({ provider, label, keyHint, keyUrl }) {
  const cfg = useStore(debrid);
  const saved = cfg[provider];
  const [key, setKey] = useState('');
  const [who, setWho] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  if (!saved) {
    return (
      <form
        class="set-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const name = await cloud.verify(provider, key);
            debrid.patch({ [provider]: key.trim() });
            cloud.forget();
            setWho(name);
            setKey('');
            toast(`Connected to ${label}`);
          } catch (err) {
            toast(err.status === 401 || err.status === 403 ? `${label} rejected that key` : err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p class="muted">
          Stream the audiobooks already in your {label} cloud. Get your key at{' '}
          <a href={keyUrl} target="_blank" rel="noopener">
            {keyHint}
          </a>
          .
        </p>
        <input placeholder={`${label} API key`} value={key} onInput={(e) => setKey(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
        <button class="btn primary" disabled={busy || !key.trim()}>
          {busy ? <span class="spinner" /> : <Icon name="link" size={16} />} Connect
        </button>
      </form>
    );
  }
  return (
    <>
      <div class="set-row">
        <div>
          <b>Connected</b>
          <small>{who || `${label} key saved`}</small>
        </div>
        <button
          class="pill danger small"
          onClick={() => {
            debrid.patch({ [provider]: '' });
            cloud.forget();
          }}
        >
          Remove
        </button>
      </div>
      <form
        class="set-form inline"
        onSubmit={async (e) => {
          e.preventDefault();
          // Empty box: + picks a .torrent file instead.
          if (!link.trim()) {
            const file = await pickTorrentFile();
            if (!file) return;
            setBusy(true);
            try {
              toast(await cloud.addTorrentFile(provider, file));
              qb.autoForwardSoon();
              cloud.forget();
            } catch (err) {
              toast(err.message);
            } finally {
              setBusy(false);
            }
            return;
          }
          setBusy(true);
          try {
            toast(await cloud.addLink(provider, link));
            qb.autoForwardSoon();
            cloud.forget();
            setLink('');
          } catch (err) {
            toast(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input placeholder="Magnet or link — or tap + for a .torrent file" value={link} onInput={(e) => setLink(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
        <button class="btn primary" disabled={busy} aria-label={link.trim() ? 'Add' : 'Choose a .torrent file'}>
          {busy ? <span class="spinner" /> : <Icon name="plus" size={16} />}
        </button>
      </form>
    </>
  );
}

function HardcoverCard() {
  const cfg = useStore(hardcover);
  const [tok, setTok] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState('');
  if (cfg.token) {
    return (
      <>
        <div class="set-row">
          <div>
            <b>Connected</b>
            <small>@{cfg.username} · shelves on Home, status buttons on book pages</small>
          </div>
          <button class="pill danger small" onClick={() => hc.disconnect()}>
            Sign out
          </button>
        </div>
        <div class="set-row">
          <div>
            <b>Shelves</b>
            <small>{check || 'Check that your shelves load'}</small>
          </div>
          <button
            class="pill small"
            onClick={async () => {
              setCheck('Loading…');
              try {
                const c = await hc.counts();
                setCheck(`Want to read ${c.want} · Reading ${c.reading} · Read ${c.read}`);
              } catch (e) {
                setCheck('Error: ' + e.message);
              }
            }}
          >
            Test
          </button>
        </div>
      </>
    );
  }
  return (
    <form
      class="set-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          toast(`Connected as @${await hc.connect(tok)}`);
          setTok('');
        } catch (err) {
          toast(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p class="muted">
        Show your Want to Read / Currently Reading shelves and update them from the app. Copy your token from{' '}
        <a href="https://hardcover.app/account/api" target="_blank" rel="noopener">
          hardcover.app/account/api
        </a>
        .
      </p>
      <input placeholder="Hardcover API token" value={tok} onInput={(e) => setTok(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
      <button class="btn primary" disabled={busy || !tok.trim()}>
        {busy ? <span class="spinner" /> : <Icon name="link" size={16} />} Connect
      </button>
    </form>
  );
}

function GoodreadsCard() {
  const data = useStore(goodreads);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    try {
      toast(await fn());
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  const counts = gr.shelves().map((s) => `${s.replace(/-/g, ' ')} ${gr.shelf(s).length}`).join(' · ');
  return (
    <>
      {data.userId ? (
        <>
          <div class="set-row">
            <div>
              <b>Connected · profile {data.userId}</b>
              <small>
                {counts || 'No books yet'}
                {data.importedAt ? ` · synced ${new Date(data.importedAt).toLocaleString()}` : ''}
              </small>
            </div>
            <button class="pill small" disabled={busy} onClick={() => run(async () => `Synced ${await gr.syncProfile()} books`)}>
              {busy ? <span class="spinner small" /> : 'Sync'}
            </button>
          </div>
          <div class="set-row">
            <small class="muted">Shelves update automatically every hour and when you pull down to refresh.</small>
            <button class="pill danger small" onClick={() => gr.disconnectProfile()}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <form
          class="set-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => `Connected — ${await gr.connectProfile(link)} books from your shelves`);
          }}
        >
          <p class="muted">
            Goodreads has no app login any more, so the app reads your shelves from your profile. Open Goodreads → your profile, copy the link from the address bar and paste it here.
          </p>
          <input placeholder="https://www.goodreads.com/user/show/12345-yourname" value={link} onInput={(e) => setLink(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} inputmode="url" />
          <button class="btn primary" disabled={busy || !link.trim()}>
            {busy ? <span class="spinner" /> : <Icon name="link" size={16} />} Connect Goodreads
          </button>
          <small class="muted">Your profile must be visible to “anyone” (Goodreads → Settings → Privacy). A private profile works too if you paste the RSS link from one of your shelf pages instead.</small>
        </form>
      )}
      <div class="set-row">
        <div>
          <b>Or import a CSV</b>
          <small>My Books → Import and export → Export library</small>
        </div>
        <label class="pill small">
          Import CSV
          <input
            type="file"
            accept=".csv,text/csv,text/comma-separated-values"
            hidden
            onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              if (!f) return;
              try {
                toast(`Imported ${gr.importCsv(await f.text())} books`);
              } catch (err) {
                toast(err.message);
              }
            }}
          />
        </label>
      </div>
    </>
  );
}

function AddonsCard() {
  const list = useStore(addons);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState(null);
  return (
    <>
      <p class="muted pad-s">
        Paste an addon link: InkShelf-style source addons (JSON on jsonkeeper etc.), Stremio-style manifests, or addon collections. Only install addons you trust. Audiohub ships with none: what you add, and what you download through it, is your choice and your responsibility — respect copyright and the laws where you live.
      </p>
      {list.map((a) => (
        <div class="set-row addon-row">
          {a.manifest.logo || a.manifest.icon ? <img src={a.manifest.logo || a.manifest.icon} alt="" class="addon-logo" /> : <span class="addon-logo"><Icon name="puzzle" size={18} /></span>}
          <div>
            <b>{a.manifest.name}</b>
            <small>
              v{a.manifest.version} · {a.kind === 'source' ? 'source addon · results in Search & book pages' : `${(a.manifest.catalogs || []).length} catalogs`}
            </small>
          </div>
          <button class="icon-btn" aria-label="Remove addon" onClick={() => addonSrc.uninstall(a.manifest.id)}>
            <Icon name="trash" size={18} />
          </button>
        </div>
      ))}
      <form
        class="set-form inline"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setRaw(null);
          try {
            const m = await addonSrc.install(url);
            toast(`Installed ${m.name}`);
            setUrl('');
          } catch (err) {
            toast(err.message || 'Install failed');
            if (err.raw) setRaw({ message: err.message, json: JSON.stringify(err.raw, null, 2) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <input placeholder="https://…/manifest.json or a JSON link" value={url} onInput={(e) => setUrl(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} inputmode="url" />
        <button class="btn primary" disabled={busy || !url}>
          {busy ? <span class="spinner" /> : <Icon name="plus" size={16} />}
        </button>
      </form>
      {raw && (
        <div class="raw-box">
          <p>
            <b>{raw.message}</b> Tap Copy and send this to the developer to get it supported:
          </p>
          <pre>{raw.json.length > 4000 ? raw.json.slice(0, 4000) + '\n…' : raw.json}</pre>
          <div class="chips">
            <button
              class="pill small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(raw.json);
                  toast('Copied');
                } catch {
                  toast('Long-press the text to copy it');
                }
              }}
            >
              Copy
            </button>
            <button class="pill small ghost" onClick={() => setRaw(null)}>
              Hide
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function MetadataCard() {
  const st = useStore(settings);
  const order = (st.metaOrder || Object.keys(PROVIDERS)).filter((k) => PROVIDERS[k]);
  const on = st.metaProviders || {};
  const move = (i, d) => {
    const next = order.slice();
    [next[i], next[i + d]] = [next[i + d], next[i]];
    settings.patch({ metaOrder: next });
  };
  return (
    <>
      <p class="muted pad-s">Used for covers, clean titles, narrators and descriptions of TorBox / Real-Debrid files, addon results and Goodreads imports. Tried top to bottom.</p>
      {order.map((k, i) => (
        <div class="set-row meta-row">
          <div class="meta-order">
            <button class="icon-btn tiny" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              ▲
            </button>
            <button class="icon-btn tiny" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
              ▼
            </button>
          </div>
          <div class="meta-name">
            <b>{PROVIDERS[k].name}</b>
            <small>{PROVIDERS[k].blurb}</small>
          </div>
          <input type="checkbox" class="switch" checked={on[k] !== false} onChange={(e) => settings.patch({ metaProviders: { ...on, [k]: e.currentTarget.checked } })} />
        </div>
      ))}
      <div class="set-row">
        <b>Metadata cache</b>
        <button
          class="pill small"
          onClick={() => {
            clearMetaCache();
            toast('Metadata will be looked up again');
          }}
        >
          Refresh all
        </button>
      </div>
    </>
  );
}

function PreferredDebrid() {
  const st = useStore(settings);
  const d = useStore(debrid);
  if (!d.torbox || !d.realdebrid) return null;
  return (
    <Section icon="download" title="Default debrid">
      <div class="set-row">
        <div>
          <b>Use for Add / Play</b>
          <small>Source addon results go to this service</small>
        </div>
        <div class="chips">
          {[
            ['torbox', 'TorBox'],
            ['realdebrid', 'Real-Debrid'],
          ].map(([k, label]) => (
            <button class={'pill small' + (st.debridPreferred === k ? ' active' : '')} onClick={() => settings.patch({ debridPreferred: k })}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function Settings() {
  const st = useStore(settings);
  const setSource = (k, v) => settings.patch({ sources: { ...st.sources, [k]: v } });
  return (
    <div class="screen settings">
      <h1 class="screen-title">Settings</h1>

      <UpdateCard />
      {isWeb && (
        <Section icon="link" title="Web app">
          <WebRelayCard />
        </Section>
      )}
      <Section icon="server" title="Account & sync">
        <AccountCard />
      </Section>

      <Section icon="server" title="Audiobookshelf">
        <AbsCard />
      </Section>
      <Section icon="server" title="Home server (qBittorrent)">
        <QbitCard />
      </Section>
      <Section icon="external" title="Tracker">
        <TrackerCard />
      </Section>
      <Section icon="headphones" title="Books on this phone">
        <LocalBooksCard />
      </Section>
      <Section icon="download" title="TorBox">
        <DebridCard provider="torbox" label="TorBox" keyHint="torbox.app/settings" keyUrl="https://torbox.app/settings" />
        <MusicToggle />
      </Section>
      <Section icon="download" title="Real-Debrid">
        <DebridCard provider="realdebrid" label="Real-Debrid" keyHint="real-debrid.com/apitoken" keyUrl="https://real-debrid.com/apitoken" />
        <MusicToggle />
      </Section>
      <PreferredDebrid />
      <Section icon="puzzle" title="Addons">
        <AddonsCard />
      </Section>
      <Section icon="download" title="Downloads">
        <DownloadsCard />
      </Section>
      <Section icon="upload" title="Send to Kindle">
        <KindleCard />
      </Section>
      <Section icon="headphones" title="Voices">
        <VoicesCard />
      </Section>
      <Section icon="sparkle" title="Metadata providers">
        <MetadataCard />
      </Section>
      <Section icon="book" title="Hardcover">
        <HardcoverCard />
      </Section>
      <Section icon="library" title="Goodreads">
        <GoodreadsCard />
      </Section>

      <Section icon="palette" title="Appearance">
        <div class="set-row">
          <b>Mode</b>
          <div class="chips">
            {['dark', 'amoled', 'light'].map((m) => (
              <button class={'pill small' + (st.mode === m ? ' active' : '')} onClick={() => settings.patch({ mode: m })}>
                {m === 'amoled' ? 'Black' : m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {st.mode !== 'amoled' && (
          <div class="set-row column">
            <b>Theme</b>
            <div class="palette-grid">
              {PALETTES.filter((p) => p.light === (st.mode === 'light')).map((p) => (
                <button
                  class={'palette' + ((st.palette || 'default') === p.id ? ' active' : '')}
                  style={{ background: `linear-gradient(160deg, ${p.swatch[0]} 45%, ${p.swatch[1]})`, color: p.light ? '#1b1b1f' : '#f1eef8' }}
                  onClick={() => settings.patch({ palette: p.id })}
                >
                  <span class="palette-dot" />
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div class="set-row column">
          <b>Accent</b>
          <div class="accent-grid">
            {Object.entries(ACCENTS).map(([k, a]) => (
              <button
                class={'accent' + ((ACCENTS[st.accent] ? st.accent : 'audiohub') === k ? ' active' : '')}
                style={{ background: `linear-gradient(135deg, ${a.a}, ${a.b})` }}
                onClick={() => settings.patch({ accent: k })}
                aria-label={a.name}
              >
                <span>{a.name}</span>
              </button>
            ))}
          </div>
        </div>
        <Toggle label="Dynamic colour" hint="Tint the player and book pages from the cover art" on={st.dynamicColor} onChange={(v) => settings.patch({ dynamicColor: v })} />
        <PlayerBackgroundPicker st={st} />
      </Section>

      <Section icon="headphones" title="Playback">
        <Stepper label="Skip back" value={st.skipBack} options={[5, 10, 15, 30]} fmt={(v) => v + 's'} onChange={(v) => settings.patch({ skipBack: v })} />
        <Stepper label="Skip forward" value={st.skipForward} options={[10, 15, 30, 45, 60]} fmt={(v) => v + 's'} onChange={(v) => settings.patch({ skipForward: v })} />
      </Section>

      <Section icon="sparkle" title="AI (bookseller & story helper)">
        <AiCard />
      </Section>


      <Section icon="sparkle" title="Sources">
        <SourceOrder st={st} setSource={setSource} />
        <Stepper label="Ebook language" value={st.language} options={['en', 'fr', 'de', 'es', 'it', 'pt', 'nl']} fmt={(v) => v.toUpperCase()} onChange={(v) => settings.patch({ language: v })} />
      </Section>

      <Section icon="download" title="Data">
        <BackupRow />
        <div class="set-row">
          <b>Network cache</b>
          <button
            class="pill small"
            onClick={() => {
              clearHttpCache();
              toast('Cache cleared');
            }}
          >
            Clear
          </button>
        </div>
      </Section>

      <p class="about">
        Audiohub {APP_VERSION} · Built-in sources are free and public domain.
        <br />
        Addons and servers you add are your responsibility.
      </p>
      <div class="footer-space" />
    </div>
  );
}


/** Last auto-send check, so you can see it's working (or why it isn't). */
function AutoSendStatus() {
  const a = useStore(qb.autoLast);
  const [busy, setBusy] = useState(false);
  const when = a.at ? new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div class="auto-status">
      <small class={a.error ? 'err' : 'muted'}>
        {!a.at ? 'Not checked yet — happens when the app opens.' : a.error ? `Last check ${when}: couldn't send — ${a.error}` : `Last check ${when}: ${a.sent ? `sent ${a.sent}` : 'nothing new'}.`}
      </small>
      <button
        class="pill small ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const m = await qb.autoForward({ force: true });
            toast(m || (qb.autoLast.get().error ? `Couldn't send: ${qb.autoLast.get().error}` : 'Nothing new to send'));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <span class="spinner small" /> : 'Check now'}
      </button>
    </div>
  );
}

/** Your Kindle's e-mail address: Kindle buttons then open your e-mail app, addressed and with the book attached. */
function KindleCard() {
  const st = useStore(settings);
  const [v, setV] = useState(st.kindleEmail || '');
  const ok = !v.trim() || /^[^\s@]+@(free\.)?kindle\.(com|cn)$/i.test(v.trim());
  return (
    <>
      <p class="muted">
        Enter your Kindle's e-mail address. Kindle buttons then open your e-mail app with the book attached and the address filled in — just tap Send. Without it, they open the share menu
        (pick the Kindle app there).
      </p>
      <p class="muted small">
        Find the address and allow your own e-mail: <b>amazon.com → Manage Your Content and Devices → Preferences → Personal Document Settings</b>. Add the e-mail you send from to the
        "Approved Personal Document E-mail List". EPUB and PDF work.
      </p>
      <form
        class="set-form inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return toast('That doesn\'t look like a Kindle address (…@kindle.com)');
          settings.patch({ kindleEmail: v.trim() });
          toast(v.trim() ? 'Saved — Kindle buttons will e-mail books there' : 'Removed');
        }}
      >
        <input type="email" value={v} placeholder="yourname@kindle.com" autocapitalize="off" autocorrect="off" spellcheck={false} onInput={(e) => setV(e.currentTarget.value)} />
        <button class="btn primary" disabled={v.trim() === (st.kindleEmail || '')}>
          Save
        </button>
      </form>
    </>
  );
}

/** Settings → Appearance: what's behind the full-screen player. */
function PlayerBackgroundPicker({ st }) {
  const cur = st.playerBg || 'cover';
  const custom = useCustomWallpaper(true);
  const pick = (v) => settings.patch({ playerBg: v });
  const tiles = [
    ['cover', 'Cover art', null, 'fx-cover'],
    ['living', 'Living colour', null, 'fx-living'],
    ['plain', 'Plain', null, 'fx-plain'],
    ...WALLPAPERS.map(([id, name]) => [`wall:${id}`, name, wallpaperUrl(id, true)]),
  ];
  return (
    <div class="set-row column">
      <div>
        <b>Player background</b>
        <small>Behind the full-screen player</small>
      </div>
      <div class="wall-grid">
        {tiles.map(([v, name, img, fx]) => (
          <button class={'wall-tile' + (cur === v ? ' active' : '') + (fx ? ' ' + fx : '')} onClick={() => pick(v)} aria-label={name}>
            {img && <img src={img} alt="" loading="lazy" />}
            <span>{name}</span>
          </button>
        ))}
        <label class={'wall-tile photo' + (cur === 'photo' ? ' active' : '')}>
          {custom ? <img src={custom} alt="" /> : <Icon name="plus" size={22} />}
          <span>{custom ? 'Your photo' : 'Add photo'}</span>
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              if (!f) return;
              try {
                await saveCustom(f);
                pick('photo');
                toast('Your photo is the player background now');
              } catch (err) {
                toast("Couldn't use that picture: " + err.message);
              }
            }}
          />
          {custom && cur !== 'photo' && (
            <button
              class="wall-use"
              onClick={(e) => {
                e.preventDefault();
                pick('photo');
              }}
            >
              Use
            </button>
          )}
        </label>
      </div>
      {(cur.startsWith('wall:') || cur === 'photo') && (
        <div class="dim-row">
          <small>Darken</small>
          <input type="range" min="0" max="0.8" step="0.05" value={st.playerDim ?? 0.45} onInput={(e) => settings.patch({ playerDim: +e.currentTarget.value })} />
        </div>
      )}
    </div>
  );
}

/** Backup: save everything as a file; restore by picking the file (or pasting an older text backup). */
function BackupRow() {
  const [keys, setKeys] = useState(true);
  const [paste, setPaste] = useState(null); // text box for backups copied as text (older versions)
  const restore = (text) => {
    try {
      importBackup(text);
      toast('Backup restored — reloading');
    } catch (err) {
      toast(err.message);
    }
  };
  const fileName = `audiohub-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const save = async () => {
    const text = exportBackup({ keys });
    if (files) {
      try {
        const r = await Files.saveFile({ name: fileName, text, mime: 'application/json' });
        return toast(`Backup saved${r?.name ? ` as ${r.name}` : ''}`);
      } catch (e) {
        if (e?.message === 'cancelled') return;
        toast(e.message);
      }
    }
    // Browser: a download.
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = fileName;
    a.click();
  };
  const open = async () => {
    if (!files) return document.getElementById('backup-file')?.click();
    try {
      const r = await Files.openFile();
      restore(r.text);
    } catch (e) {
      if (e?.message !== 'cancelled') toast(e.message);
    }
  };
  return (
    <>
      <div class="set-row">
        <div>
          <b>Backup</b>
          <small>Library, progress, podcasts, ratings, stats, settings{keys ? ', logins & API keys (TorBox, Real-Debrid, AI…)' : ''}</small>
        </div>
        <div class="chips">
          <button class="pill small" onClick={save}>
            Export
          </button>
          <button class="pill small" onClick={open}>
            Import
          </button>
          <input
            id="backup-file"
            type="file"
            accept="application/json,.json,.txt,text/plain"
            hidden
            onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              if (f) restore(await f.text());
            }}
          />
        </div>
      </div>
      <label class="set-row">
        <div>
          <b>Include logins & API keys</b>
          <small>Keep the backup file private when this is on</small>
        </div>
        <input type="checkbox" class="switch" checked={keys} onChange={(e) => setKeys(e.currentTarget.checked)} />
      </label>
      <div class="set-row">
        <small class="muted">Restoring replaces this phone’s library, progress and settings with the backup’s.</small>
        <button class="link-btn" onClick={() => setPaste(paste === null ? '' : null)}>
          Paste a backup instead
        </button>
      </div>
      {paste !== null && (
        <div class="set-form">
          <textarea rows={4} placeholder="Paste a backup that was copied as text" value={paste} onInput={(e) => setPaste(e.currentTarget.value)} />
          <button class="btn primary" disabled={!paste.trim()} onClick={() => restore(paste)}>
            Restore
          </button>
        </div>
      )}
    </>
  );
}
