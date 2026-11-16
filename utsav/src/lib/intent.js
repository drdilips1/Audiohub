// Reads a plain request like "Make a beautiful birthday card for my elder sister,
// emotional but not too sentimental" and works out the occasion, who it's for, the
// tone, the style and the language. The AI does this better when it's available;
// this is what runs offline and also what fills the form before AI answers.

import { matchOccasion, customOccasion } from './occasions.js';
import { RELATIONS } from './relations.js';
import { LANGS } from './languages.js';

const TONE_WORDS = [
  ['funny', ['funny', 'humorous', 'humour', 'humor', 'playful', 'witty', 'cheeky', 'naughty', 'mazedaar']],
  ['emotional', ['emotional', 'sentimental', 'heartfelt', 'touching', 'deep', 'bhavuk']],
  ['formal', ['formal', 'respectful', 'professional', 'classy', 'polite', 'corporate', 'dignified']],
  ['poetic', ['poetic', 'poem', 'shayari', 'kavita', 'rhyming', 'poetry']],
  ['short', ['short', 'simple', 'brief', 'one line', 'one-line', 'quick']],
];
const STYLE_WORDS = [
  ['traditional', ['traditional', 'classic', 'ethnic', 'desi', 'cultural']],
  ['elegant', ['elegant', 'sophisticated', 'classy', 'premium', 'luxury', 'minimal']],
  ['royal', ['royal', 'grand', 'regal', 'rich', 'golden']],
  ['playful', ['fun', 'colourful', 'colorful', 'cute', 'vibrant', 'bright', 'cartoon']],
  ['romantic', ['romantic', 'love']],
];

// Script ranges, to guess the language when the request itself is written in it.
const SCRIPTS = [
  ['ur', /[؀-ۿ]/], ['pa', /[਀-੿]/], ['bn', /[ঀ-৿]/], ['gu', /[઀-૿]/],
  ['or', /[଀-୿]/], ['ta', /[஀-௿]/], ['te', /[ఀ-౿]/], ['kn', /[ಀ-೿]/],
  ['ml', /[ഀ-ൿ]/], ['hi', /[ऀ-ॿ]/],
];

const has = (t, w) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu').test(t);

/** Words after "not too" / "not" / "no" don't count: "not too sentimental" isn't a request for sentimental. */
function stripNegated(t) {
  return t.replace(/\b(?:not too|not overly|not very|not|no|without|avoid)\s+([a-z-]+)/gi, ' ');
}

export function parseRequest(text, defaults = {}) {
  const raw = String(text || '');
  const t = stripNegated(raw.toLowerCase());

  const occasion = matchOccasion(raw);

  // Relationship: the longest matching word wins ("mother-in-law" over "mother").
  let relation = null, relLen = 0;
  for (const r of RELATIONS) for (const w of r.words) if (w.length > relLen && has(t, w)) { relation = r.id; relLen = w.length; }

  let tone = null;
  for (const [id, words] of TONE_WORDS) if (words.some((w) => has(t, w))) { tone = id; break; }
  let style = null;
  for (const [id, words] of STYLE_WORDS) if (words.some((w) => has(t, w))) { style = id; break; }

  // Language: named ("in Tamil", "हिंदी में") or the script the request is written in.
  let lang = null;
  for (const [id, L] of Object.entries(LANGS)) {
    if (has(raw.toLowerCase(), L.name.toLowerCase()) || raw.includes(L.native)) { lang = id; break; }
  }
  if (!lang && /\bhinglish\b/i.test(raw)) lang = 'hi';
  if (!lang) for (const [id, re] of SCRIPTS) if (re.test(raw)) { lang = id; break; }

  // Names: "for Priya", "to Rahul", "named Asha"; sender: "from the Sharma family".
  let to = (raw.match(/\b(?:for|to|named|called)\s+([A-Z][\p{L}]+(?:\s+[A-Z][\p{L}]+)?)/u) || [])[1] || '';
  // "my elder sister Priya", "my wife Neha": a capitalised name right after the relationship.
  if (!to && relation) {
    const words = RELATIONS.find((r) => r.id === relation).words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    to = (raw.match(new RegExp(`\\b(?:${words})\\s+([A-Z][\\p{L}]+)`, 'iu')) || [])[1] || '';
    if (to && !/^\p{Lu}/u.test(to)) to = '';
  }
  let from = '';
  const f = raw.match(/\bfrom\s+(?:the\s+)?([A-Z][\p{L}]+(?:\s+(?:[A-Z][\p{L}]+|family|parivar))?|our family|my family|all of us|us)\b/u);
  if (f) from = /^(our family|my family|all of us|us)$/i.test(f[1]) ? '' : f[1];
  const fromFamily = /\bfrom\s+(our|my|the)\s+(\p{L}+\s+)?family\b/iu.test(raw) || /\bfrom (all of )?us\b/i.test(raw);

  // Ages and years: "turning 60", "25th anniversary", "60th birthday".
  const n = raw.match(/\b(\d{1,3})(?:st|nd|rd|th)\b/i) || raw.match(/\bturning\s+(\d{1,3})\b/i);
  const number = n ? Number(n[1]) : null;

  const elder = /\b(elder|older|big|bade|badi)\b/i.test(raw);

  return {
    occasion: occasion ? occasion.id : null,
    customOccasion: occasion ? null : guessCustomLabel(raw),
    relation: relation || defaults.relation || null,
    tone: tone || defaults.tone || 'warm',
    style,
    lang: lang || defaults.lang || 'en',
    to, from, fromFamily, number, elder,
  };
}

/** When no known occasion is named, keep the user's own words as the occasion. */
function guessCustomLabel(raw) {
  const m = raw.match(/\b(?:for|on)\s+(?:my\s+|our\s+|his\s+|her\s+)?([\p{L}' ]{3,40}?)(?:[,.]|\s+(?:for|to|from|in)\s|$)/iu);
  const label = m ? m[1].trim() : '';
  if (!label || RELATIONS.some((r) => r.words.includes(label.toLowerCase()))) return null;
  return customOccasion(label.replace(/^\w/, (c) => c.toUpperCase())).en;
}
