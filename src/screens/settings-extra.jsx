import { useEffect, useMemo, useState } from 'preact/hooks';
import { Icon } from '../components/icons.jsx';
import { nav } from '../lib/nav.js';
import { toast } from '../components/common.jsx';
import { useStore } from '../lib/store.js';
import * as sync from '../lib/sync.js';
import { PLACES, findOrder, setFindOrder, DEFAULT_ORDER } from '../lib/findorder.js';
import { ttsCfg, engines as listEngines, voices as listVoices, speak, stopSpeaking, clearAudioCache, qualityLabel, RECOMMENDED, nativeReader, Reader, EDGE_VOICES, voiceSpec } from '../lib/tts.js';
import { CATALOG, builtinAvailable, installedIds, download as downloadVoice, remove as removeVoice, activeDownload, follow as followDownload } from '../lib/voices.js';
import { downloads, canDownload, removeDownload, publicAvailable, fmtBytes, unsorted, sortDownloads } from '../lib/downloads.js';
import { settings } from '../lib/store.js';

const ago = (t) => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString();
};

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    toast('Long-press the text to copy it');
  }
}

/** Your name, for Home's "Good evening, …". */
export function NameRow() {
  const st = useStore(settings);
  const a = useStore(sync.account);
  return (
    <label class="set-row">
      <div>
        <b>Your name</b>
        <small>{st.myName ? 'Shown on Home: “Good evening, ' + st.myName.trim().slice(0, 24) + '”' : a.name || a.email ? 'Leave empty to use the name from your account' : 'Shown on Home after the greeting'}</small>
      </div>
      <input class="set-name" value={st.myName || ''} placeholder="First name" maxLength={24} onInput={(e) => settings.patch({ myName: e.currentTarget.value })} />
    </label>
  );
}

export function AccountCard() {
  const a = useStore(sync.account);
  const [url, setUrl] = useState(a.url);
  const [key, setKey] = useState(a.anonKey);
  const [email, setEmail] = useState(a.email);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    if (sync.configured() && !sync.signedIn()) sync.providers().then((p) => setGoogle(p.google));
  }, [a.url, a.refreshToken]);
  const run = (name, fn) => async (e) => {
    e?.preventDefault?.();
    setBusy(name);
    try {
      const msg = await fn();
      if (msg) toast(msg);
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy('');
    }
  };

  if (sync.signedIn()) {
    return (
      <>
        <div class="set-row">
          <div>
            <b>{a.email}</b>
            <small>
              Last synced {ago(a.lastSync)}
              {a.status && ` · ${a.status}`}
            </small>
          </div>
          <button class="pill small" disabled={!!busy} onClick={run('sync', () => sync.syncNow().then(() => 'Synced'))}>
            {busy === 'sync' ? <span class="spinner small" /> : 'Sync now'}
          </button>
        </div>
        <label class="set-row">
          <div>
            <b>Sync service keys</b>
            <small>TorBox, Real-Debrid, Audiobookshelf, Hardcover & voice keys — so a new device is ready instantly</small>
          </div>
          <input type="checkbox" class="switch" checked={a.syncKeys} onChange={(e) => sync.account.patch({ syncKeys: e.currentTarget.checked })} />
        </label>
        <div class="set-row">
          <small>Library, progress, bookmarks, addons, shelves and settings sync automatically.</small>
          <button class="pill danger small" onClick={run('out', () => sync.signOut().then(() => 'Signed out'))}>
            Sign out
          </button>
        </div>
      </>
    );
  }

  if (!sync.configured() || showSetup) {
    return (
      <form
        class="set-form"
        onSubmit={run('cfg', async () => {
          sync.configure(url, key);
          setShowSetup(false);
          return 'Sync server saved — now create your account';
        })}
      >
        <p class="muted">
          Accounts sync your library, progress, addons and logins across devices. They run on your own free <b>Supabase</b> project (takes ~3 minutes):
        </p>
        <ol class="steps">
          <li>
            Sign up at{' '}
            <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">
              supabase.com
            </a>{' '}
            and create a project.
          </li>
          <li>
            Open <b>SQL Editor</b>, paste the setup SQL and press <b>Run</b>.{' '}
            <button type="button" class="link-btn" onClick={() => copy(sync.SETUP_SQL)}>
              Copy SQL
            </button>
          </li>
          <li>
            Tap <b>Connect</b> at the top of your project and copy the <b>Project URL</b> and the <b>anon</b> key into the boxes below.
          </li>
        </ol>
        <p class="muted small">
          Phone tip: if Run says “syntax error”, the editor added extra brackets while pasting. The SQL ends with the line starting <code>grant execute</code> — delete anything after it, or switch the browser to <b>Desktop site</b>.
        </p>
        <pre class="sql">{sync.SETUP_SQL}</pre>
        <input placeholder="https://xxxx.supabase.co" value={url} onInput={(e) => setUrl(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} inputmode="url" />
        <input placeholder="anon public key (starts with eyJ…)" value={key} onInput={(e) => setKey(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
        <button class="btn primary" disabled={!url.trim() || !key.trim() || !!busy}>
          <Icon name="link" size={16} /> Save sync server
        </button>
      </form>
    );
  }

  return (
    <form class="set-form" onSubmit={run('in', () => sync.continueWith(email, pass))}>
      <p class="muted">Enter an email and a password to sign in — or to create your account, if this is the first time. It backs up your library, progress, addons and logins, and puts them on your other devices.</p>
      {a.status && <p class="err small">{a.status}</p>}
      <input type="email" placeholder="Email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} autocapitalize="off" autocomplete="email" />
      <input type="password" placeholder="Password (6+ characters)" value={pass} onInput={(e) => setPass(e.currentTarget.value)} autocomplete="current-password" />
      <button class="btn primary" disabled={!email || pass.length < 6 || !!busy}>
        {busy === 'in' ? <span class="spinner" /> : null} Continue
      </button>
      {google && (
        <button type="button" class="btn google" disabled={!!busy} onClick={run('g', () => sync.signInWith('google'))}>
          <span class="g-logo">G</span> Continue with Google
        </button>
      )}
      <div class="btn-row small">
        <button type="button" class="link-btn" disabled={!email} onClick={run('reset', () => sync.resetPassword(email))}>
          Forgot password?
        </button>
        {!import.meta.env.VITE_SUPABASE_URL && (
          <button type="button" class="link-btn" onClick={() => setShowSetup(true)}>
            Change sync server
          </button>
        )}
      </div>

    </form>
  );
}

function SystemVoices() {
  const c = useStore(ttsCfg);
  const [eng, setEng] = useState(null);
  const [vs, setVs] = useState(null);
  const [err, setErr] = useState('');
  const [previewing, setPreviewing] = useState(false);

  const loadEngines = () =>
    listEngines()
      .then(setEng)
      .catch((e) => setErr(e.message));
  useEffect(() => {
    loadEngines();
    // Re-check when coming back from installing an engine.
    const onVis = () => document.visibilityState === 'visible' && loadEngines();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  useEffect(() => {
    setVs(null);
    listVoices(c.engine)
      .then(setVs)
      .catch((e) => setErr(e.message));
  }, [c.engine]);

  const installed = eng?.engines || [];
  const hasEngine = (hint) => installed.some((e) => hint.test(e.name) || hint.test(e.label));

  return (
    <>
      <div class="set-row column">
        <b>Voice engine</b>
        <select value={c.engine} onChange={(e) => ttsCfg.patch({ engine: e.currentTarget.value, voice: '' })}>
          <option value="">Phone default{eng?.defaultEngine ? ` (${installed.find((x) => x.name === eng.defaultEngine)?.label || eng.defaultEngine})` : ''}</option>
          {installed.map((e) => (
            <option value={e.name}>{e.label}</option>
          ))}
        </select>
      </div>
      <div class="set-row column">
        <b>Voice</b>
        <div class="btn-row">
          <select value={c.voice} onChange={(e) => ttsCfg.patch({ voice: e.currentTarget.value })} disabled={!vs}>
            <option value="">{vs ? 'Engine default' : 'Loading voices…'}</option>
            {(vs?.voices || []).map((v) => (
              <option value={v.name}>
                {v.name} · {v.langLabel || v.lang} · {qualityLabel(v.quality)}
                {v.network ? ' · online' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            class="btn secondary"
            style={{ flex: 'none' }}
            onClick={async () => {
              if (previewing) {
                stopSpeaking();
                return setPreviewing(false);
              }
              setPreviewing(true);
              try {
                await speak('Chapter one. It was a bright cold day in April, and the clocks were striking thirteen.');
              } catch (e) {
                if (e.message !== 'stopped') toast(e.message);
              } finally {
                setPreviewing(false);
              }
            }}
          >
            <Icon name={previewing ? 'pause' : 'play'} size={14} /> {previewing ? 'Stop' : 'Preview'}
          </button>
        </div>
        <div class="chips">
          {[0.8, 0.9, 1, 1.1, 1.25].map((r) => (
            <button type="button" class={'pill small' + (c.rate === r ? ' active' : '')} onClick={() => ttsCfg.patch({ rate: r })}>
              {r}× read-along
            </button>
          ))}
        </div>
        {err && <small class="err">{err}</small>}
      </div>
      <div class="set-row column">
        <b>More phone voice engines</b>
        <small class="muted">Install one, open it once to download a voice, then pick it under Voice engine above.</small>
        {RECOMMENDED.map((r) => (
          <a class="voice-rec" href={r.url} target="_blank" rel="noopener">
            <div>
              <b>
                {r.name} {hasEngine(r.pkgHint) && <span class="chip ready">INSTALLED</span>}
              </b>
              <small>{r.what}</small>
            </div>
            <Icon name="external" size={16} />
          </a>
        ))}
      </div>
    </>
  );
}

const SAMPLE = 'Chapter one. It was a bright cold day in April, and the clocks were striking thirteen.';

function BuiltinVoices() {
  const c = useStore(ttsCfg);
  const [installed, setInstalled] = useState([]);
  const [prog, setProg] = useState({}); // id -> { pct, phase }
  const [previewing, setPreviewing] = useState('');
  const refresh = () => installedIds().then(setInstalled);
  const onProg = (id) => (e) => setProg((p) => ({ ...p, [id]: { pct: e.total > 0 ? Math.round((e.received / e.total) * 100) : 0, phase: e.phase, mb: Math.round(e.received / 1e6) } }));
  useEffect(() => {
    refresh();
    // A download that kept going while the app was closed: show it and follow it.
    activeDownload().then((a) => {
      const v = a && CATALOG.find((x) => x.id === a.id);
      if (!v) return;
      onProg(v.id)(a);
      finish(v, followDownload(v.id, onProg(v.id)));
    });
  }, []);

  const get = (v) => {
    setProg((p) => ({ ...p, [v.id]: { pct: 0, phase: 'download' } }));
    finish(v, downloadVoice(v, onProg(v.id)));
  };

  const finish = async (v, job) => {
    try {
      await job;
      await refresh();
      if (!ttsCfg.get().builtinId) ttsCfg.patch({ mode: 'builtin', builtinId: v.id, speaker: v.speakers[0][1] });
      toast(`${v.name} is ready`);
    } catch (e) {
      toast(`Download failed: ${e.message}`);
    } finally {
      setProg((p) => {
        const n = { ...p };
        delete n[v.id];
        return n;
      });
    }
  };

  const preview = async (v, sid) => {
    const key = `${v.id}:${sid}`;
    if (previewing === key) {
      stopSpeaking();
      return setPreviewing('');
    }
    setPreviewing(key);
    try {
      await speak(SAMPLE, { mode: 'builtin', builtinId: v.id, speaker: sid, rate: 1 });
    } catch (e) {
      if (e.message !== 'stopped') toast(e.message);
    } finally {
      setPreviewing((k) => (k === key ? '' : k));
    }
  };

  if (!builtinAvailable) return <p class="muted pad-s">Built-in voices work in the Android app.</p>;

  return (
    <div class="voice-list">
      {CATALOG.map((v) => {
        const have = installed.includes(v.id);
        const p = prog[v.id];
        const activeVoice = c.mode === 'builtin' && c.builtinId === v.id;
        return (
          <div class={'voice-card' + (activeVoice ? ' active' : '')}>
            <div class="voice-head">
              <div>
                <b>
                  {v.name} {v.best && <span class="chip ready">MOST NATURAL</span>}
                </b>
                <small>
                  {v.what} · {v.size}
                </small>
              </div>
              {p ? (
                <span class="voice-prog">{p.phase === 'unpack' ? 'Installing…' : `${p.pct || 0}%`}</span>
              ) : have ? (
                <button
                  class="icon-btn"
                  aria-label={`Delete ${v.name}`}
                  onClick={async () => {
                    await removeVoice(v.id);
                    if (ttsCfg.get().builtinId === v.id) ttsCfg.patch({ builtinId: '' });
                    refresh();
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              ) : (
                <button class="btn primary small-btn" onClick={() => get(v)}>
                  <Icon name="download" size={14} /> Download
                </button>
              )}
            </div>
            {p && (
              <div class="progress-bar voice-bar">
                <div style={{ width: (p.phase === 'unpack' ? 100 : p.pct || 2) + '%' }} />
              </div>
            )}
            {have && (
              <div class="voice-speakers">
                {v.speakers.map(([label, sid]) => {
                  const on = activeVoice && c.speaker === sid;
                  const key = `${v.id}:${sid}`;
                  return (
                    <div class={'speaker' + (on ? ' on' : '')}>
                      <button class="speaker-pick" onClick={() => ttsCfg.patch({ mode: 'builtin', builtinId: v.id, speaker: sid })}>
                        {on ? <Icon name="check" size={14} /> : null} {label}
                      </button>
                      <button class="icon-btn tiny-play" aria-label={`Preview ${label}`} onClick={() => preview(v, sid)}>
                        {previewing === key ? <span class="spinner small" /> : <Icon name="play" size={12} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Microsoft natural voices (online): pick one, hear a preview. */
function EdgeVoices() {
  const c = useStore(ttsCfg);
  const [previewing, setPreviewing] = useState('');
  const preview = async (id) => {
    if (previewing === id) {
      Reader.stop().catch(() => {});
      return setPreviewing('');
    }
    setPreviewing(id);
    try {
      await Reader.start({ uid: 'voice-preview', title: 'Voice preview', paras: [SAMPLE], from: 0, rate: c.rate || 1, voice: { ...voiceSpec(), engine: 'edge', edgeVoice: id } });
      const h = await Reader.addListener('state', (st) => {
        if (st.uid !== 'voice-preview' || st.finished || !st.active || (!st.playing && st.error)) {
          if (st.error) toast(st.error);
          setPreviewing('');
          h.remove();
        }
      });
    } catch (e) {
      toast(e.message);
      setPreviewing('');
    }
  };
  return (
    <>
      <p class="muted small pad-s">
        Very natural and quick to start — they need internet. Without internet, reading switches to your downloaded voice (or the phone's). Free; the text being read is sent to Microsoft to
        be spoken.
      </p>
      <div class="voice-list">
        {EDGE_VOICES.map(([id, name, what]) => {
          const on = c.mode === 'edge' && (c.edgeVoice || EDGE_VOICES[0][0]) === id;
          return (
            <div class={'voice-row' + (on ? ' on' : '')}>
              <button class="speaker-pick" onClick={() => ttsCfg.patch({ mode: 'edge', edgeVoice: id })}>
                <b>{name}</b>
                <small>{what}</small>
              </button>
              {on && <span class="ok-dot">In use</span>}
              <button class="icon-btn" aria-label={`Preview ${name}`} onClick={() => preview(id)}>
                <Icon name={previewing === id ? 'pause' : 'play'} size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function VoicesCard() {
  const c = useStore(ttsCfg);
  const tab = nativeReader && (c.mode === 'edge' || !c.mode) ? 'edge' : builtinAvailable && c.mode !== 'system' ? 'builtin' : 'system';
  return (
    <>
      <p class="muted pad-s">
        Voices that read your ebooks aloud. Tap <b>Listen</b> on an ebook to use them; on Android reading keeps going with the screen off.
      </p>
      {builtinAvailable && (
        <div class="segmented tight">
          {nativeReader && (
            <button type="button" class={tab === 'edge' ? 'on' : ''} onClick={() => ttsCfg.patch({ mode: 'edge' })}>
              Microsoft
            </button>
          )}
          <button type="button" class={tab === 'builtin' ? 'on' : ''} onClick={() => ttsCfg.patch({ mode: 'builtin' })}>
            Offline voices
          </button>
          <button type="button" class={tab === 'system' ? 'on' : ''} onClick={() => ttsCfg.patch({ mode: 'system' })}>
            Phone voices
          </button>
        </div>
      )}
      {tab === 'edge' ? <EdgeVoices /> : tab === 'builtin' ? <BuiltinVoices /> : <SystemVoices />}
      <div class="set-row">
        <b>Generated audio</b>
        <button
          type="button"
          class="pill small"
          onClick={() => {
            clearAudioCache();
            toast('Cleared');
          }}
        >
          Clear cache
        </button>
      </div>
    </>
  );
}

export function DownloadsCard() {
  const st = useStore(settings);
  const all = useStore(downloads);
  const [pub, setPub] = useState(true);
  useEffect(() => {
    publicAvailable().then(setPub);
  }, []);
  if (!canDownload) return <p class="muted pad-s">Downloads work in the Android app.</p>;
  const list = Object.entries(all).filter(([, d]) => d.book);
  const total = list.reduce((a, [, d]) => a + (d.bytes || 0), 0);
  const target = pub ? st.downloadTarget || 'public' : 'app';
  return (
    <>
      <button class="btn ghost-wide" onClick={() => nav.push('downloads')}>
        <Icon name="download" size={16} /> Manage downloads — queue, pause, retry, sizes
      </button>
      <div class="set-row column">
        <b>Save downloads to</b>
        <div class="dl-targets">
          <button class={'dl-target' + (target === 'public' ? ' on' : '')} disabled={!pub} onClick={() => settings.patch({ downloadTarget: 'public' })}>
            <b>Phone storage</b>
            <small>Downloads/Audiohub — visible in My Files, kept if you uninstall{!pub ? ' (needs Android 10+)' : ''}</small>
          </button>
          <button class={'dl-target' + (target === 'app' ? ' on' : '')} onClick={() => settings.patch({ downloadTarget: 'app' })}>
            <b>App only</b>
            <small>Private to the app — removed together with the app</small>
          </button>
        </div>
      </div>
      <div class="set-row">
        <div>
          <b>{list.length ? `${list.length} book${list.length > 1 ? 's' : ''} · ${fmtBytes(total)}` : 'No downloads yet'}</b>
          <small>Tap “Download for offline” on any audiobook.</small>
        </div>
        {list.length > 0 && (
          <button
            class="pill danger small"
            onClick={async () => {
              for (const [uid] of list) await removeDownload(uid);
              toast('All downloads removed');
            }}
          >
            Delete all
          </button>
        )}
      </div>
      <SortDownloads all={all} />
      {list.map(([uid, d]) => (
        <div class="set-row">
          <div>
            <b>{d.book.title}</b>
            <small>
              {d.status === 'done' ? `${fmtBytes(d.bytes)} · ${d.location || ''}` : d.status === 'error' ? `Failed: ${d.error}` : `Downloading ${d.done || 0}/${d.total || '…'}`}
            </small>
          </div>
          <button class="icon-btn" aria-label="Remove download" onClick={() => removeDownload(uid)}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      ))}
    </>
  );
}

/** One tap: move earlier downloads into Author / Series / Title folders. */
function SortDownloads({ all }) {
  const [busy, setBusy] = useState('');
  const todo = useMemo(() => unsorted(), [all]);
  if (!todo.length && !busy) return null;
  return (
    <div class="set-row">
      <div>
        <b>Sort into Author / Series folders</b>
        <small>{busy || `${todo.length} earlier download${todo.length > 1 ? 's are' : ' is'} in the old one-folder-per-book layout`}</small>
      </div>
      <button
        class="pill small"
        disabled={!!busy}
        onClick={async () => {
          setBusy('Sorting…');
          try {
            const { moved, failed } = await sortDownloads((i, n, title) => setBusy(`Moving ${i + 1} of ${n}: ${title}`));
            toast(failed ? `Sorted ${moved}; ${failed} couldn't be moved (they still play)` : `Sorted ${moved} book${moved === 1 ? '' : 's'}`);
          } finally {
            setBusy('');
          }
        }}
      >
        {busy ? <span class="spinner small" /> : 'Sort'}
      </button>
    </div>
  );
}

/** Where to look for your copy of a book, in your order (audiobooks and ebooks). */
export function FindOrderCard() {
  const st = useStore(settings);
  const List = ({ kind, title, note }) => {
    const list = findOrder(kind);
    const move = (i, d) => {
      const next = [...list];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      setFindOrder(kind, next);
    };
    return (
      <div class="find-order">
        <b>{title}</b>
        <small class="muted">{note}</small>
        <ol>
          {list.map((k, i) => (
            <li>
              <span class="find-n">{i + 1}</span>
              <span class="find-name">{PLACES[k]}</span>
              <button class="icon-btn" disabled={i === 0} aria-label={`Move ${PLACES[k]} up`} onClick={() => move(i, -1)}>
                <Icon name="up" size={18} />
              </button>
              <button class="icon-btn" disabled={i === list.length - 1} aria-label={`Move ${PLACES[k]} down`} onClick={() => move(i, 1)}>
                <Icon name="down" size={18} />
              </button>
            </li>
          ))}
        </ol>
        {list.join() !== DEFAULT_ORDER[kind].join() && (
          <button class="link-btn" onClick={() => setFindOrder(kind, DEFAULT_ORDER[kind])}>
            Back to the usual order
          </button>
        )}
      </div>
    );
  };
  return (
    <>
      <List kind="audio" title="Audiobooks (voice: play a book)" note="Where your copy is looked for. Within TorBox / Real-Debrid, your default one first." />
      <List kind="ebook" title="Ebooks (for the transcript)" note="Where the audiobook's ebook is looked for." />
      <label class="set-row">
        <div>
          <b>Attach the ebook by itself</b>
          <small>When an audiobook plays, its ebook is found in this order, kept on the phone and used for the transcript's words. Only books already there — nothing new is added to TorBox / Real-Debrid.</small>
        </div>
        <input type="checkbox" class="switch" checked={st.autoEbook !== false} onChange={(e) => settings.patch({ autoEbook: e.currentTarget.checked })} />
      </label>
    </>
  );
}
