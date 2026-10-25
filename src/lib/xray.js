// X-Ray: who and where, while you listen (like Prime Video's X-Ray). Your AI service
// names the people, places and topic of each chapter up to where you are (never past
// it); the live transcript, when it ran, adds the exact moments each name was said.
import * as player from './player.js';
import { askAi, parseJson, position } from './ai.js';
import { heardLines } from './transcript.js';
import { persisted } from './store.js';

const store = persisted('xray', {}); // uid -> { at, data, t }

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Every way a name can be said: full name, aliases, and a distinctive first or last name. */
export function namesOf(x) {
  const parts = x.name.split(/\s+/);
  const out = new Set([x.name, ...(x.aliases || [])]);
  if (parts.length > 1) for (const p of [parts[0], parts[parts.length - 1]]) if (p.length > 3 && !/^(the|mr|mrs|miss|dr|sir|lady|lord|king|queen|uncle|aunt|professor)\.?$/i.test(p)) out.add(p);
  return [...out].filter((n) => n && n.length > 2);
}
// Built once per name (the X-Ray line checks them several times a second while playing).
const matchers = new Map();
const matcher = (x) => {
  if (!matchers.has(x.name)) {
    if (matchers.size > 300) matchers.clear();
    matchers.set(x.name, new RegExp(`\\b(${namesOf(x).map(esc).sort((a, b) => b.length - a.length).join('|')})\\b`, 'i'));
  }
  return matchers.get(x.name);
};

const asList = (a) => (Array.isArray(a) ? a : []).filter((x) => x && x.name);
const nums = (a) => (Array.isArray(a) ? a.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);

/**
 * The cast, places and chapter topics known up to where you are:
 * { at, chapters, people: [{ name, aliases, role, about, chapters:[i] }], places: [...], topics: { i: text } }
 * Chapter numbers are indexes into player.chapters(). One AI request per chapter you reach.
 */
export async function loadXray({ force = false } = {}) {
  const p = position();
  const uid = p.book.uid;
  const hit = store.get()[uid];
  if (!force && hit && hit.at === p.current) return hit.data;
  const list = p.chapters
    .slice(0, p.current + 1)
    .map((c, i) => `${i + 1}. ${c.title || `Part ${i + 1}`}`)
    .join('\n');
  const raw = await askAi(
    `X-Ray for someone listening to the audiobook "${p.book.title}"${p.book.author ? ` by ${p.book.author}` : ''}. They are at: ${p.label}.
Its parts so far, numbered:
${list.length > 6000 ? '…' + list.slice(-6000) : list}

Strict spoiler rules: use ONLY what is revealed up to and including part ${p.current + 1}. Never mention anything later. If unsure, leave it out.
Return JSON:
{"people":[{"name":"","aliases":[""],"role":"one short line","about":"2 sentences, only what is known by now","parts":[1,2]}],
 "places":[{"name":"","about":"one sentence","parts":[1]}],
 "topics":[{"part":1,"topic":"what happens or is discussed in this part, under 10 words"}]}
"parts" are the part numbers above where that person or place appears. For non-fiction, people are the people discussed, and topics are the sub-topics. At most 25 people and 12 places, most important first. Include a topic for every part you can.
${p.heard ? `Transcript of what they have heard (may contain recognition errors):\n"""${p.heard.slice(-8000)}"""` : ''}`,
    { json: true }
  );
  let d;
  try {
    d = parseJson(raw);
  } catch {
    throw new Error('The AI sent an unexpected reply — try again');
  }
  const max = p.current;
  const fix = (x) => ({ ...x, aliases: (x.aliases || []).filter(Boolean), chapters: [...new Set(nums(x.parts).map((n) => n - 1).filter((i) => i <= max))].sort((a, b) => a - b) });
  const topics = {};
  for (const t of Array.isArray(d.topics) ? d.topics : []) if (t && Number(t.part) >= 1 && Number(t.part) - 1 <= max && t.topic) topics[Number(t.part) - 1] = String(t.topic);
  const data = { at: max, people: asList(d.people).map(fix), places: asList(d.places).map(fix), topics };
  store.set((all) => {
    const keys = Object.keys(all);
    const next = keys.length > 30 ? Object.fromEntries(keys.slice(-20).map((k) => [k, all[k]])) : { ...all };
    next[uid] = { at: max, data, t: Date.now() };
    return next;
  });
  return data;
}

/** What's already known for the playing book (no AI call), or null. */
export function cachedXray(uid) {
  return store.get()[uid]?.data || null;
}

/** The chapter index a moment (part + time in it) falls in. */
function chapterAt(chapters, g) {
  let ci = chapters.findIndex((c) => g >= c.start && g < (c.end || Infinity));
  return ci < 0 ? Math.max(0, chapters.length - 1) : ci;
}

/**
 * Where someone or somewhere appears, chapter by chapter, up to where you are:
 * [{ chapter, title, g (where to start, in book seconds), said (from the transcript) }].
 */
export function timeline(x, data) {
  const chapters = player.chapters();
  const s = player.getState();
  const now = player.globalTime();
  const re = matcher(x);
  const out = new Map();
  // Heard: the first time the name was said in each chapter.
  for (const l of heardLines(s.book.uid)) {
    const g = player.trackOffset(l.track) + l.start;
    if (g > now + 1 || !re.test(l.text)) continue;
    const ci = chapterAt(chapters, g);
    if (!out.has(ci)) out.set(ci, { chapter: ci, g: Math.max(chapters[ci]?.start || 0, g - 5), said: l.text });
  }
  // The AI's chapters you haven't heard with the transcript on: from the chapter's start.
  for (const ci of x.chapters || []) if (ci <= (data?.at ?? ci) && chapters[ci] && !out.has(ci)) out.set(ci, { chapter: ci, g: chapters[ci].start, said: '' });
  return [...out.values()].sort((a, b) => a.chapter - b.chapter).map((e) => ({ ...e, title: chapters[e.chapter]?.title || `Part ${e.chapter + 1}` }));
}

/** Who and where is in the scene now: named in the last few minutes heard, else the chapter's cast. */
export function inScene(data, lines) {
  if (!data) return { people: [], places: [], heard: false };
  const recent = lines.join(' ');
  if (recent.trim()) {
    const people = data.people.filter((x) => matcher(x).test(recent));
    const places = data.places.filter((x) => matcher(x).test(recent));
    if (people.length || places.length) return { people, places, heard: true };
  }
  const ci = chapterAt(player.chapters(), player.globalTime());
  return { people: data.people.filter((x) => x.chapters.includes(ci)).slice(0, 6), places: data.places.filter((x) => x.chapters.includes(ci)).slice(0, 3), heard: false };
}
