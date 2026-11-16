// Phone notifications before birthdays, anniversaries and festivals, so the app can
// suggest a card before the day instead of waiting to be opened. Uses Android's local
// notifications: nothing leaves the phone. Rescheduled whenever dates or settings change.

import { Capacitor } from '@capacitor/core';
import { upcoming, reminderTimes, todayYmd } from './calendar.js';
import { get } from './store.js';

const BASE_ID = 7000;
const MAX = 60;

function title(e, back) {
  const when = back === 0 ? 'is today' : back === 1 ? 'is tomorrow' : `is in ${back} days`;
  return e.kind === 'person' ? `${e.label} ${when}` : `${e.label} ${when}`;
}

export async function scheduleReminders() {
  if (!Capacitor.isNativePlatform()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const s = get('settings');
  const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] }));
  const ours = pending.notifications.filter((n) => n.id >= BASE_ID && n.id < BASE_ID + MAX);
  if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
  if (!s.reminders?.on) return;
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') { const r = await LocalNotifications.requestPermissions(); if (r.display !== 'granted') return; }

  const list = upcoming({ from: todayYmd(), days: 45, people: get('people'), custom: get('custom'), moved: get('moved') })
    // Festivals: only the big ones and anything the user asked to follow, so we don't nag.
    .filter((e) => e.kind !== 'festival' || BIG.has(e.occasion));
  const now = Date.now();
  const notifications = [];
  for (const e of list) {
    for (const r of reminderTimes(e, s.reminders)) {
      if (r.at.getTime() <= now || notifications.length >= MAX) continue;
      notifications.push({ id: BASE_ID + notifications.length, title: title(e, r.back), body: 'Make a card in 30 seconds and send it with love.', schedule: { at: r.at, allowWhileIdle: true }, extra: { key: e.key, occasion: e.occasion, person: e.person || null } });
    }
  }
  if (notifications.length) await LocalNotifications.schedule({ notifications });
}

const BIG = new Set(['diwali', 'holi', 'rakhi', 'eid', 'bakrid', 'christmas', 'newyear', 'navratri', 'dussehra', 'ganesh', 'janmashtami', 'makarsankranti', 'pongal', 'lohri', 'baisakhi', 'gurpurab', 'mothersday', 'fathersday', 'friendshipday', 'valentine', 'teachersday', 'independence', 'republic', 'bhaidooj', 'chhath', 'ugadi', 'gudipadwa']);

/** Tapping a reminder opens the app on that occasion. */
export async function onReminderTap(handler) {
  if (!Capacitor.isNativePlatform()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  LocalNotifications.addListener('localNotificationActionPerformed', (a) => handler(a.notification?.extra || {}));
}
