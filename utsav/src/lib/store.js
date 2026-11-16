// A tiny reactive store saved on the phone (localStorage). Everything personal stays on
// the device: your people, dates, saved cards and AI key. Keys use the "utsav:" prefix;
// never rename it, or everyone's saved cards and reminders disappear.

import { useEffect, useState } from 'preact/hooks';

const PREFIX = 'utsav:';
const listeners = new Set();

const DEFAULTS = {
  settings: {
    name: '', family: '', lang: 'hi', ai: 'auto', apiKey: '', model: 'claude-opus-5-5', onboarded: false,
    reminders: { on: true, daysBefore: 1, hour: 9 },
  },
  people: [],
  custom: [],
  moved: {},
  cards: [],
};

function read(key) {
  try { const v = localStorage.getItem(PREFIX + key); return v ? JSON.parse(v) : null; } catch { return null; }
}

const state = {};
for (const k of Object.keys(DEFAULTS)) {
  const v = read(k);
  state[k] = v == null ? structuredClone(DEFAULTS[k]) : k === 'settings' ? { ...DEFAULTS.settings, ...v, reminders: { ...DEFAULTS.settings.reminders, ...(v.reminders || {}) } } : v;
}

export function get(key) { return state[key]; }

export function set(key, value) {
  state[key] = typeof value === 'function' ? value(state[key]) : value;
  try { localStorage.setItem(PREFIX + key, JSON.stringify(state[key])); } catch (e) {
    // Storage full (usually photos in saved cards): keep working in memory.
    console.warn('Could not save', key, e);
  }
  listeners.forEach((fn) => fn(key));
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Preact hook: re-render when this key changes. */
export function useStore(key) {
  const [, tick] = useState(0);
  useEffect(() => subscribe((k) => { if (k === key) tick((n) => n + 1); }), [key]);
  return state[key];
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Save or update a card. Newest first; keeps the last 200. */
export function saveCard(spec) {
  const id = spec.id || uid();
  const card = { ...spec, id, savedAt: Date.now() };
  set('cards', (list) => [card, ...list.filter((c) => c.id !== id)].slice(0, 200));
  return card;
}
