// Sleep detection: while a book plays, the native player watches the phone's
// motion sensor; if it lies still for the chosen time it fades out, pauses and
// rewinds to where you stopped moving.
import { registerPlugin } from '@capacitor/core';
import { isNative } from './engine.js';
import { settings } from './store.js';
import { toast } from '../components/common.jsx';

const Native = registerPlugin('InkwellPlayer');
export const sleepDetectAvailable = isNative;

const cfg = () => settings.get().sleepDetect || { on: false, minutes: 15 };
const apply = () => (isNative ? Native.setSleepDetect({ on: !!cfg().on, minutes: cfg().minutes || 15 }).catch(() => {}) : null);

export function setSleepDetect(patch) {
  settings.set((s) => ({ ...s, sleepDetect: { ...cfg(), ...patch } }));
  apply();
}

if (isNative) {
  setTimeout(apply, 1500);
  Native.addListener('autosleep', (e) => toast(`Paused — you seemed to drift off. Rewound to where you stopped moving.`));
}
