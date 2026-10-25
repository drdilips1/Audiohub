import { useState } from 'preact/hooks';
import { Capacitor } from '@capacitor/core';
import { toast } from './common.jsx';
import { APP_VERSION } from './update.jsx';
import { abs } from '../lib/store.js';
import { relayUrl, isWeb } from '../lib/http.js';
import { aiReady } from '../lib/ai.js';
import * as sync from '../lib/sync.js';
import * as cloud from '../sources/debrid.js';
import * as qb from '../sources/qbit.js';
import { sourceAddons, recentSearches } from '../sources/sourceaddons.js';
import { buildReport, shareReport, githubIssueUrl, recentErrors, clearErrors, copyText } from '../lib/report.js';

// What's set up — names and hosts only, never keys or passwords.
const host = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return u ? '(set)' : '';
  }
};
function setupLines() {
  const a = abs.get();
  return [
    `Audiobookshelf: ${a.server ? host(a.server) + (a.altServer ? ` + ${host(a.altServer)}` : '') + (a.token ? ', signed in' : ', not signed in') : 'not set up'}`,
    `TorBox: ${cloud.tbConnected() ? 'connected' : 'no'} · Real-Debrid: ${cloud.rdConnected() ? 'connected' : 'no'}`,
    `Home server (qBittorrent): ${qb.configured() ? 'set up' : 'no'}`,
    `Sources: ${sourceAddons().map((x) => x.manifest.name).join(', ') || 'none'}`,
    `AI key: ${aiReady() ? 'yes' : 'no'} · Account: ${sync.signedIn() ? 'signed in' : 'not signed in'}`,
    ...(isWeb ? [`Web relay: ${host(relayUrl()) || 'off'}`] : []),
    'Last source searches:',
    ...(recentSearches().length
      ? recentSearches().map((s) => `  ${s.name}: ${s.reply}, ${s.usable} usable, ${s.kept} shown${s.loose ? `, ${s.loose} loose` : ''} — ${s.url}`)
      : ['  (none since the app opened)']),
  ];
}

/** Settings → Report a problem: describe it, then share into the Claude app (or GitHub). */
export function ReportCard() {
  const [note, setNote] = useState('');
  const [show, setShow] = useState(false);
  const [, bump] = useState(0);
  const text = () => buildReport({ note, version: APP_VERSION, setup: setupLines() });
  const errs = recentErrors();

  const send = async () => {
    try {
      const r = await shareReport(text());
      if (r === 'copied') toast('Report copied — paste it into your Claude chat');
      if (r === 'failed') toast('Could not share or copy — use "Show report" and copy it by hand');
    } catch (e) {
      toast(e.message);
    }
  };

  return (
    <div class="set-form report">
      <p class="muted small">
        Describe what went wrong, then send the report to the Claude app (or post it on GitHub). It adds the app version, the screen you were on, what's set up and the
        last errors — never your passwords or keys. Send a screenshot along with it if it helps.
      </p>
      <textarea rows={3} placeholder="What went wrong? e.g. Knaben shows an error on every book" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      <div class="btn-row">
        <button class="btn primary" onClick={send}>
          {Capacitor.isNativePlatform() ? 'Send to Claude…' : 'Share / copy report'}
        </button>
        <a class="btn secondary" href={githubIssueUrl(text(), note)} target="_blank" rel="noopener">
          GitHub
        </a>
      </div>
      <div class="btn-row small">
        <button class="link-btn" onClick={() => setShow(!show)}>
          {show ? 'Hide report' : 'Show report'} · {errs.length} recent error{errs.length === 1 ? '' : 's'}
        </button>
        {show && (
          <button class="link-btn" onClick={async () => toast((await copyText(text())) ? 'Copied' : 'Could not copy')}>
            Copy
          </button>
        )}
        {errs.length > 0 && (
          <button
            class="link-btn"
            onClick={() => {
              clearErrors();
              bump((x) => x + 1);
              toast('Error log cleared');
            }}
          >
            Clear log
          </button>
        )}
      </div>
      {show && <pre class="report-text">{text()}</pre>}
    </div>
  );
}
