import { describe, it, expect } from 'vitest';
import { nthWeekday, daysBetween, dateInYear, nextDate, upcoming, whenText, reminderTimes } from '../src/lib/calendar.js';

describe('calendar arithmetic', () => {
  it('finds nth weekdays (Mother’s Day, Father’s Day, Friendship Day)', () => {
    expect(nthWeekday(2027, 5, 0, 2)).toBe('2027-05-09');
    expect(nthWeekday(2027, 6, 0, 3)).toBe('2027-06-20');
    expect(nthWeekday(2027, 8, 0, 1)).toBe('2027-08-01');
    expect(nthWeekday(2026, 5, 0, 2)).toBe('2026-05-10');
  });
  it('counts days across a year end', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2027-01-02', '2026-12-30')).toBe(-3);
  });
  it('moves 29 February birthdays to 28 February in other years', () => {
    expect(dateInYear({ fixed: '02-29' }, 2027)).toBe('2027-02-28');
    expect(dateInYear({ fixed: '02-29' }, 2028)).toBe('2028-02-29');
  });
  it('rolls fixed dates into next year once passed', () => {
    expect(nextDate({ fixed: '01-26' }, '2026-11-16')).toBe('2027-01-26');
    expect(nextDate({ fixed: '12-25' }, '2026-12-25')).toBe('2026-12-25');
  });
  it('returns null for a moon-based festival with no date for the year', () => {
    expect(nextDate({ on: { 2026: '03-04' }, approx: true }, '2026-11-16')).toBeNull();
  });
});

describe('upcoming', () => {
  const from = '2026-11-16';
  it('lists festivals soonest first and marks moon-based ones approximate', () => {
    const list = upcoming({ from, days: 60 });
    const ids = list.map((e) => e.occasion);
    expect(ids.indexOf('gurpurab')).toBeLessThan(ids.indexOf('christmas'));
    expect(list.find((e) => e.occasion === 'gurpurab').approx).toBe(true);
    expect(list.find((e) => e.occasion === 'christmas').approx).toBe(false);
    expect(list.every((e, i) => i === 0 || list[i - 1].daysLeft <= e.daysLeft)).toBe(true);
  });
  it('includes people’s birthdays with the age they turn', () => {
    const list = upcoming({ from, days: 40, people: [{ id: 'p1', name: 'Dadi', relation: 'grandmother', birthday: '1950-12-01' }] });
    const b = list.find((e) => e.kind === 'person');
    expect(b.date).toBe('2026-12-01');
    expect(b.years).toBe(76);
    expect(b.daysLeft).toBe(15);
  });
  it('accepts birthdays without a year', () => {
    const list = upcoming({ from, days: 10, people: [{ id: 'p2', name: 'Asha', birthday: '11-20' }] });
    expect(list.find((e) => e.kind === 'person').years).toBeNull();
  });
  it('uses a date the user corrected for their region', () => {
    const list = upcoming({ from, days: 30, moved: { gurpurab: '2026-11-25' } });
    const g = list.find((e) => e.occasion === 'gurpurab');
    expect(g.date).toBe('2026-11-25');
    expect(g.approx).toBe(false);
  });
  it('repeats yearly custom occasions', () => {
    const list = upcoming({ from, days: 30, custom: [{ id: 'c1', label: 'Shop anniversary', date: '2019-12-05', yearly: true }] });
    expect(list.find((e) => e.kind === 'custom').date).toBe('2026-12-05');
  });
});

describe('text helpers', () => {
  it('says today, tomorrow, days and weeks', () => {
    expect(whenText(0)).toBe('Today');
    expect(whenText(1)).toBe('Tomorrow');
    expect(whenText(5)).toBe('in 5 days');
    expect(whenText(21)).toBe('in 3 weeks');
  });
  it('plans a reminder the day before and on the day', () => {
    const r = reminderTimes({ date: '2026-12-25' }, { daysBefore: 1, hour: 9 });
    expect(r.map((x) => x.back)).toEqual([1, 0]);
    expect(r[0].at.getDate()).toBe(24);
    expect(r[0].at.getHours()).toBe(9);
  });
});
