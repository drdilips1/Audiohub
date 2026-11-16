// Small shared pieces: page header, chips, section titles, toast.
import { useEffect, useState } from 'preact/hooks';
import { back } from '../lib/nav.js';

export function PageHeader({ title, sub, right }) {
  return (
    <header class="page-head">
      <button class="icon-btn" onClick={() => back()} aria-label="Back">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <div class="page-title"><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {right}
    </header>
  );
}

export function Chip({ on, onClick, children, small }) {
  return <button type="button" class={`chip${on ? ' on' : ''}${small ? ' sm' : ''}`} aria-pressed={on ? 'true' : 'false'} onClick={onClick}>{children}</button>;
}

export function Section({ title, action, children }) {
  return (
    <section class="section">
      <div class="section-head"><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

let toastSet = null;
export function toast(msg) { toastSet?.(msg); }
export function Toast() {
  const [msg, setMsg] = useState('');
  useEffect(() => { toastSet = setMsg; return () => { toastSet = null; }; }, []);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 3200); return () => clearTimeout(t); }, [msg]);
  return <div class={`toast${msg ? ' show' : ''}`} role="status">{msg}</div>;
}

export const Icon = {
  home: <svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" /></svg>,
  explore: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></svg>,
  create: <svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" /></svg>,
  calendar: <svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
  cards: <svg viewBox="0 0 24 24"><rect x="4" y="3.5" width="12" height="15" rx="2" /><path d="M8 20.5h10a2 2 0 0 0 2-2v-12" /></svg>,
  gear: <svg viewBox="0 0 24 24"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z" /><path d="M19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7.6 7.6 0 0 1-2 1.2l-.3 2h-3.6l-.3-2a7.6 7.6 0 0 1-2-1.2l-1.9.7-1.8-3.1 1.6-1.2a7.4 7.4 0 0 1 0-2.4L3.4 9.9l1.8-3.1 1.9.7a7.6 7.6 0 0 1 2-1.2l.3-2h3.6l.3 2a7.6 7.6 0 0 1 2 1.2l1.9-.7 1.8 3.1-1.6 1.2a7.4 7.4 0 0 1 0 2.4z" /></svg>,
};
