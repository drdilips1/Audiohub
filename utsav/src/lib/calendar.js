// Dates for the "Remember" side of the app: festivals, relationship days and the
// birthdays and anniversaries of the people you add. Pure date arithmetic, no
// state, so it is tested in tests/calendar.test.js.
//
// Dates are local calendar days written 'YYYY-MM-DD'. We never use Date for time
// zones: a birthday on 14 March is on 14 March wherever the phone is.

import { OCCASIONS, occasionById } from './occasions.js';

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const todayYmd = (now = new Date()) => ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());

function parts(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return { y, m, d };
}

/** Whole days from a to b (both 'YYYY-MM-DD'). */
export function daysBetween(a, b) {
  const A = parts(a), B = parts(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}

/** The nth weekday of a month: Mother's Day 2027 = nthWeekday(2027, 5, 0, 2) = 2027-05-09. */
export function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return ymd(year, month, day);
}

/** Valid day for a birthday on 29 Feb in a year that has none: 28 Feb. */
function clampDay(y, m, d) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return ymd(y, m, Math.min(d, last));
}

/** The date an occasion falls on in a given year, or null if we don't know it. */
export function dateInYear(when, year) {
  if (!when) return null;
  if (when.fixed) { const [m, d] = when.fixed.split('-').map(Number); return clampDay(year, m, d); }
  if (when.nth) { const [m, wd, n] = when.nth; return nthWeekday(year, m, wd, n); }
  if (when.on && when.on[year]) return `${year}-${when.on[year]}`;
  return null;
}

/** Next date on or after `from` for an occasion rule (this year or next). */
export function nextDate(when, from) {
  const y = parts(from).y;
  for (const yy of [y, y + 1]) {
    const d = dateInYear(when, yy);
    if (d && daysBetween(from, d) >= 0) return d;
  }
  return null;
}

/**
 * Everything coming up in the next `days` days, soonest first.
 * people:  [{ id, name, relation, birthday: 'YYYY-MM-DD' | 'MM-DD', anniversary }]
 * custom:  [{ id, label, date: 'YYYY-MM-DD', yearly: true, theme }]
 * moved:   { occasionId: 'YYYY-MM-DD' } dates the user corrected for their region
 */
export function upcoming({ from, days = 60, people = [], custom = [], moved = {} }) {
  const out = [];
  const push = (e) => { const left = daysBetween(from, e.date); if (left >= 0 && left <= days) out.push({ ...e, daysLeft: left }); };

  for (const o of OCCASIONS) {
    if (!o.when) continue;
    const fixedByUser = moved[o.id] && daysBetween(from, moved[o.id]) >= 0 ? moved[o.id] : null;
    const date = fixedByUser || nextDate(o.when, from);
    if (date) push({ key: `o:${o.id}:${date}`, kind: 'festival', occasion: o.id, label: o.en, labelHi: o.hi, date, approx: !fixedByUser && !!o.when.approx });
  }

  for (const p of people) {
    for (const [field, occ] of [['birthday', 'birthday'], ['anniversary', 'anniversary']]) {
      const v = p[field];
      if (!v) continue;
      const [y, m, d] = v.length === 5 ? [null, ...v.split('-').map(Number)] : v.split('-').map(Number);
      const date = nextDate({ fixed: `${pad(m)}-${pad(d)}` }, from);
      if (!date) continue;
      const years = y ? parts(date).y - y : null;
      push({ key: `p:${p.id}:${field}:${date}`, kind: 'person', occasion: occ, person: p.id, name: p.name, relation: p.relation, label: occ === 'birthday' ? `${p.name}'s birthday` : `${p.name}'s anniversary`, date, years });
    }
  }

  for (const c of custom) {
    if (!c.date) continue;
    let date = c.date;
    if (c.yearly) { const { m, d } = parts(c.date); date = nextDate({ fixed: `${pad(m)}-${pad(d)}` }, from); }
    if (date) push({ key: `c:${c.id}:${date}`, kind: 'custom', occasion: 'custom', customId: c.id, label: c.label, date, theme: c.theme });
  }

  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.label.localeCompare(b.label));
}

/** "Today", "Tomorrow", "in 5 days", "in 3 weeks". */
export function whenText(daysLeft) {
  if (daysLeft <= 0) return 'Today';
  if (daysLeft === 1) return 'Tomorrow';
  if (daysLeft < 14) return `in ${daysLeft} days`;
  return `in ${Math.round(daysLeft / 7)} weeks`;
}

/** "14 Mar" style short date for cards and lists. */
export function shortDate(s) {
  const { m, d } = parts(s);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
}

/** Reminder moments for an upcoming entry: the morning `daysBefore` days ahead and the day itself. */
export function reminderTimes(entry, { daysBefore = 1, hour = 9 } = {}) {
  const out = [];
  const { y, m, d } = parts(entry.date);
  for (const back of [...new Set([daysBefore, 0])]) {
    const at = new Date(y, m - 1, d - back, hour, 0, 0);
    out.push({ at, back });
  }
  return out;
}

export const occasionLabel = (id) => occasionById(id)?.en || '';
