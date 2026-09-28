import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../components/icons.jsx';
import { toast } from '../components/common.jsx';
import { useStore } from '../lib/store.js';
import * as sync from '../lib/sync.js';
import { ttsCfg, engines as listEngines, voices as listVoices, speak, stopSpeaking, clearAudioCache, qualityLabel, RECOMMENDED, nativeReader, Reader, EDGE_VOICES, voiceSpec } from '../lib/tts.js';
import { CATALOG, builtinAvailable, installedIds, download as downloadVoice, remove as removeVoice, activeDownload, follow as followDownload } from '../lib/voices.js';
import { downloads, canDownload, removeDownload, publicAvailable, fmtBytes } from '../lib/downloads.js';
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
            Open <b>SQL Editor</b>, paste the setup SQL below and press Run.{' '}
            <button type="button" class="link-btn" onClick={() => copy(sync.SETUP_SQL)}>
              Copy SQL
            </button>
          </li>
          <li>
            In <b>Project Settings → API</b>, copy the <b>Project URL</b> and the <b>anon public</b> key into the boxes below.
          </li>
        </ol>
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
    <form class="set-form" onSubmit={run('in', () => sync.signIn(email, pass))}>
      <p class="muted">Sign in or create an account to back up your library, progress, addons and logins, and use them on your other devices. {a.status && <b>{a.status}</b>}</p>
      <input type="email" placeholder="Email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} autocapitalize="off" autocomplete="email" />
      <input type="password" placeholder="Password (6+ characters)" value={pass} onInput={(e) => setPass(e.currentTarget.value)} autocomplete="current-password" />
      <div class="btn-row">
        <button class="btn primary" disabled={!email || pass.length < 6 || !!busy}>
          {busy === 'in' ? <span class="spinner" /> : null} Sign in
        </button>
        <button type="button" class="btn secondary" disabled={!email || pass.length < 6 || !!busy} onClick={run('up', () => sync.signUp(email, pass))}>
          {busy === 'up' ? <span class="spinner" /> : null} Create account
        </button>
      </div>
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
