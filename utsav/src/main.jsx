import { render } from 'preact';
import { App } from './app.jsx';
import { fontsHref } from './lib/languages.js';
import './styles.css';

// All card fonts in one stylesheet; Android's own Noto fonts cover every script offline.
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = fontsHref();
document.head.append(link);

render(<App />, document.getElementById('app'));
