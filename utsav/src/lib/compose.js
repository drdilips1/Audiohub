// Turning a request into finished card specs: offline (built-in words + theme designs)
// or by merging what the AI sent back. Pure, so it is tested.

import { occasionById, customOccasion } from './occasions.js';
import { relationById } from './relations.js';
import { LANGS } from './languages.js';
import { designFor, sanitizeSpec, THEMES } from './design.js';
import { headingFor, messageFor, signoffFor } from './messages.js';

/** The occasion object for a request: a known one, or the user's own words. */
export function occasionOf(req) {
  return (req.occasion && occasionById(req.occasion)) || customOccasion(req.customOccasion || 'Special day', req.theme);
}

/** The structured request the AI prompt is built from. */
export function aiRequest(req) {
  const occ = occasionOf(req);
  return {
    occasionLabel: occ.custom ? occ.en : `${occ.en}${occ.region ? ` (${occ.region})` : ''}`,
    relationLabel: relationById(req.relation)?.en.toLowerCase() || '',
    elder: !!req.elder,
    to: req.to || '', from: req.from || '', number: req.number || null,
    langLabel: (LANGS[req.lang] || LANGS.en).ai,
    tone: req.tone || 'warm', style: req.style || '',
    note: req.note || '',
  };
}

/** `count` offline designs, each a different look, with the built-in words. */
export function offlineCards(req, count = 4, offset = 0) {
  const occ = occasionOf(req);
  const lang = LANGS[req.lang] ? req.lang : 'en';
  const words = {
    heading: headingFor(occ, lang),
    message: messageFor(occ, { lang, relation: req.relation, tone: req.tone }),
    signoff: signoffFor(lang, req.relation, occ),
  };
  if (req.number && occ.id === 'birthday' && lang === 'en') words.heading = `Happy ${ordinal(req.number)} Birthday`;
  if (req.number && occ.id === 'anniversary' && lang === 'en') words.heading = `Happy ${ordinal(req.number)} Anniversary`;
  const out = [];
  for (let i = 0; i < count; i++) {
    const v = i + offset;
    out.push(sanitizeSpec({
      ...designFor({ theme: occ.theme, variant: v, style: req.style, tone: req.tone, lang, seed: v * 131 + 17 }),
      ...words, ...base(req, occ, lang), source: 'offline',
    }));
  }
  return out;
}

/** Merge an AI card (words + design) into a spec, repairing anything off. */
export function fromAi(card, req, i = 0) {
  const occ = occasionOf(req);
  const lang = LANGS[req.lang] ? req.lang : 'en';
  return sanitizeSpec({
    theme: THEMES[card.theme] ? card.theme : occ.theme,
    motifs: card.motifs, palette: card.palette, font: card.font, seed: i * 131 + 29,
    heading: card.heading, message: card.message, signoff: card.signoff,
    ...base(req, occ, lang), source: 'ai',
  });
}

function base(req, occ, lang) {
  return {
    occasion: occ.custom ? 'custom' : occ.id, customLabel: occ.custom ? occ.en : '',
    relation: req.relation || null, tone: req.tone || 'warm', lang,
    to: req.to || '', from: req.from || '', format: req.format || 'post', photo: req.photo || null,
  };
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
