import { render } from 'preact';
import { App } from './app.jsx';
import './styles.css';
import { settings, library, progress, cleanLibrary, cleanProgress } from './lib/store.js';
import { ttsCfg, nativeReader } from './lib/tts.js';

// Audiohub look (v3): everyone moves onto the brand accent and Aurora theme once; later choices stick.
try {
  if ((settings.get().themeV || 0) < 3) settings.set((s) => ({ ...s, accent: 'audiohub', palette: s.mode === 'light' ? 'default' : 'aurora', themeV: 3 }));
} catch {}

// Libby was removed: forget its saved sign-in and library links.
try {
  ['inkwell:libby', 'inkwell:libbyAccount'].forEach((k) => localStorage.removeItem(k));
} catch {}

// Gemini and Mistral were replaced by Groq / OpenRouter: drop their old keys.
try {
  const a = JSON.parse(localStorage.getItem('inkwell:ai') || 'null');
  if (a && ('geminiKey' in a || 'model' in a || 'mistralKey' in a)) {
    delete a.geminiKey;
    delete a.mistralKey;
    delete a.model;
    localStorage.setItem('inkwell:ai', JSON.stringify(a));
  }
} catch {}

// Drop malformed entries (e.g. a null left by an old sync) that broke the Library screen.
try {
  const lib = library.get();
  const cleanLib = cleanLibrary(lib);
  if (Object.keys(cleanLib).length !== Object.keys(lib || {}).length) library.set(cleanLib);
  const prog = progress.get();
  const cleanProg = cleanProgress(prog);
  if (Object.keys(cleanProg).length !== Object.keys(prog || {}).length) progress.set(cleanProg);
} catch {}

// Reading aloud: switch to Microsoft's natural voices once (as in Paper to Audio);
// the offline voice stays as the fallback and can be chosen again in Settings.
try {
  if (!localStorage.getItem('inkwell:edgeDefault')) {
    localStorage.setItem('inkwell:edgeDefault', '1');
    if (nativeReader) ttsCfg.patch({ mode: 'edge' });
  }
} catch {}

render(<App />, document.getElementById('app'));
