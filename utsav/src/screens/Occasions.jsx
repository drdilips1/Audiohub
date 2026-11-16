// Occasions: the calendar of what's coming (festivals, your people's birthdays and
// anniversaries, your own dates), the people you add, and reminder settings.
import { useMemo, useState } from 'preact/hooks';
import { useStore, set, uid } from '../lib/store.js';
import { open } from '../lib/nav.js';
import { upcoming, todayYmd, whenText, shortDate } from '../lib/calendar.js';
import { occasionById } from '../lib/occasions.js';
import { RELATIONS, relationById } from '../lib/relations.js';
import { scheduleReminders } from '../lib/reminders.js';
import { Chip, Section, toast } from '../components/ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function Occasions() {
  const [tab, setTab] = useState('upcoming');
  return (
    <div class="screen occasions">
      <header class="tab-head"><h1>Occasions</h1><p>Never miss a birthday, anniversary or festival.</p></header>
      <div class="tabs" role="tablist">
        {[['upcoming', 'Upcoming'], ['people', 'People'], ['mine', 'My dates'], ['reminders', 'Reminders']].map(([id, t]) => <button role="tab" aria-selected={tab === id ? 'true' : 'false'} class={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{t}</button>)}
      </div>
      {tab === 'upcoming' && <Upcoming />}
      {tab === 'people' && <People />}
      {tab === 'mine' && <MyDates />}
      {tab === 'reminders' && <Reminders />}
    </div>
  );
}

function Upcoming() {
  const people = useStore('people'), custom = useStore('custom'), moved = useStore('moved'), settings = useStore('settings');
  const [fix, setFix] = useState(null);
  const list = useMemo(() => upcoming({ from: todayYmd(), days: 370, people, custom, moved }), [people, custom, moved]);
  const from = settings.family || settings.name || '';
  let month = '';
  return (
    <div class="list">
      <p class="hint">Festival dates that follow the moon are marked “approx.”: they can differ by a day in your region. Tap “Change date” to set yours.</p>
      {list.map((e) => {
        const m = MONTHS[Number(e.date.slice(5, 7)) - 1];
        const head = m !== month ? (month = m, <h3 class="month">{m}</h3>) : null;
        const occ = occasionById(e.occasion);
        const req = { occasion: e.occasion === 'custom' ? null : e.occasion, customOccasion: e.kind === 'custom' ? e.label : null, theme: e.theme, relation: e.relation || occ?.rel || null, to: e.kind === 'person' ? e.name : '', from, lang: settings.lang, number: e.years || null };
        return (
          <>
            {head}
            <div class="row">
              <div class="row-date"><b>{e.date.slice(8)}</b><small>{shortDate(e.date).split(' ')[1]}</small></div>
              <div class="row-main">
                <b>{e.label}</b>
                <small>{whenText(e.daysLeft)}{e.approx ? ' · approx.' : ''}{e.years ? ` · ${e.occasion === 'birthday' ? 'turns' : ''} ${e.years}${e.occasion === 'anniversary' ? ' years' : ''}` : ''}{e.kind === 'festival' && occ?.hi ? ` · ${occ.hi}` : ''}</small>
                {e.kind === 'festival' && occ?.when?.approx && (fix === e.key
                  ? <input type="date" class="input small" value={e.date} onChange={(ev) => { const v = ev.currentTarget.value; if (v) { set('moved', (mv) => ({ ...mv, [e.occasion]: v })); setFix(null); scheduleReminders(); toast('Date updated'); } }} />
                  : <button class="link small" onClick={() => setFix(e.key)}>Change date</button>)}
              </div>
              <button class="btn small" onClick={() => open('results', { req })}>Make card</button>
            </div>
          </>
        );
      })}
    </div>
  );
}

function People() {
  const people = useStore('people');
  const [edit, setEdit] = useState(null);
  const blank = { name: '', relation: 'friend', birthday: '', anniversary: '' };
  const saveP = (p) => {
    if (!p.name.trim()) { toast('Add a name'); return; }
    set('people', (l) => (p.id ? l.map((x) => (x.id === p.id ? p : x)) : [...l, { ...p, id: uid() }]));
    setEdit(null); scheduleReminders(); toast('Saved. We’ll remind you before the day.');
  };
  if (edit) return <PersonForm person={edit} onSave={saveP} onCancel={() => setEdit(null)} onDelete={edit.id ? () => { set('people', (l) => l.filter((x) => x.id !== edit.id)); setEdit(null); scheduleReminders(); } : null} />;
  return (
    <div class="list">
      <p class="hint">Add the people you wish every year. Their dates stay on this phone.</p>
      {people.map((p) => (
        <button class="row as-btn" onClick={() => setEdit(p)}>
          <div class="avatar">{p.name.slice(0, 1).toUpperCase()}</div>
          <div class="row-main"><b>{p.name}</b><small>{relationById(p.relation)?.en || ''}{p.birthday ? ` · Birthday ${shortDate(p.birthday.length === 5 ? `2000-${p.birthday}` : p.birthday)}` : ''}{p.anniversary ? ` · Anniversary ${shortDate(p.anniversary)}` : ''}</small></div>
        </button>
      ))}
      <button class="btn primary wide" onClick={() => setEdit(blank)}>Add a person</button>
    </div>
  );
}

function PersonForm({ person, onSave, onCancel, onDelete }) {
  const [p, setP] = useState(person);
  return (
    <div class="panel">
      <label class="field"><span>Name</span><input class="input" id="p-name" value={p.name} onInput={(e) => setP({ ...p, name: e.currentTarget.value })} placeholder="e.g. Dadi, Rahul, Priya didi" /></label>
      <p class="hint">Relationship</p>
      <div class="chips-row wrap">{RELATIONS.map((r) => <Chip small on={p.relation === r.id} onClick={() => setP({ ...p, relation: r.id })}>{r.en}</Chip>)}</div>
      <div class="two">
        <label class="field"><span>Birthday</span><input class="input" type="date" id="p-bday" value={p.birthday} onInput={(e) => setP({ ...p, birthday: e.currentTarget.value })} /></label>
        <label class="field"><span>Anniversary</span><input class="input" type="date" id="p-anni" value={p.anniversary} onInput={(e) => setP({ ...p, anniversary: e.currentTarget.value })} /></label>
      </div>
      <div class="actions">
        <button class="btn primary" onClick={() => onSave(p)}>Save</button>
        <button class="btn ghost" onClick={onCancel}>Cancel</button>
        {onDelete && <button class="link danger" onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}

function MyDates() {
  const custom = useStore('custom');
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  const [yearly, setYearly] = useState(true);
  const add = () => {
    if (!label.trim() || !date) { toast('Add a name and a date'); return; }
    set('custom', (l) => [...l, { id: uid(), label: label.trim(), date, yearly }]);
    setLabel(''); setDate(''); scheduleReminders(); toast('Added');
  };
  return (
    <div class="list">
      <p class="hint">Any day that matters to you: a shop anniversary, a pet’s birthday, the day you met.</p>
      {custom.map((c) => (
        <div class="row">
          <div class="row-main"><b>{c.label}</b><small>{shortDate(c.date)}{c.yearly ? ' · every year' : ` ${c.date.slice(0, 4)}`}</small></div>
          <button class="link danger" onClick={() => set('custom', (l) => l.filter((x) => x.id !== c.id))}>Remove</button>
        </div>
      ))}
      <div class="panel">
        <label class="field"><span>What is it?</span><input class="input" id="c-label" value={label} onInput={(e) => setLabel(e.currentTarget.value)} placeholder="e.g. Sharma Sweets 10th anniversary" /></label>
        <div class="two">
          <label class="field"><span>Date</span><input class="input" type="date" id="c-date" value={date} onInput={(e) => setDate(e.currentTarget.value)} /></label>
          <label class="check"><input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.currentTarget.checked)} /> Every year</label>
        </div>
        <button class="btn primary" onClick={add}>Add date</button>
      </div>
    </div>
  );
}

function Reminders() {
  const settings = useStore('settings');
  const r = settings.reminders;
  const upd = (p) => { set('settings', (s) => ({ ...s, reminders: { ...s.reminders, ...p } })); scheduleReminders(); };
  return (
    <Section title="Reminders">
      <label class="check big"><input type="checkbox" checked={r.on} onChange={(e) => upd({ on: e.currentTarget.checked })} /> Remind me before birthdays, anniversaries and big festivals</label>
      <p class="hint">How early?</p>
      <div class="chips-row">{[[1, 'A day before'], [2, '2 days before'], [3, '3 days before'], [7, 'A week before']].map(([d, t]) => <Chip small on={r.daysBefore === d} onClick={() => upd({ daysBefore: d })}>{t}</Chip>)}</div>
      <p class="hint">At what time?</p>
      <div class="chips-row">{[[7, '7 am'], [9, '9 am'], [12, 'Noon'], [18, '6 pm'], [21, '9 pm']].map(([h, t]) => <Chip small on={r.hour === h} onClick={() => upd({ hour: h })}>{t}</Chip>)}</div>
      <p class="hint">You also get a reminder on the morning of the day itself. Reminders are set up on this phone only; nothing is sent anywhere.</p>
    </Section>
  );
}
