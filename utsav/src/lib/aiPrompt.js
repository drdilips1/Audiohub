// What we ask the AI for, and the exact JSON shape it must answer in. Shared by the
// app (own-key mode) and the Utsav AI server (server/utsav-ai), so both ask the same
// way. Pure: no network here. `npm run server:sync` copies this file to the server.

import { THEME_IDS, MOTIF_NAMES, FONTS } from './design.js';

export const CARD_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          message: { type: 'string' },
          signoff: { type: 'string' },
          theme: { type: 'string', enum: THEME_IDS },
          motifs: { type: 'array', items: { type: 'string', enum: MOTIF_NAMES } },
          palette: {
            type: 'object',
            properties: {
              bg: { type: 'array', items: { type: 'string' } },
              ink: { type: 'string' },
              sub: { type: 'string' },
              c: { type: 'array', items: { type: 'string' } },
            },
            required: ['bg', 'ink', 'sub', 'c'],
            additionalProperties: false,
          },
          font: { type: 'string', enum: FONTS },
        },
        required: ['heading', 'message', 'signoff', 'theme', 'motifs', 'palette', 'font'],
        additionalProperties: false,
      },
    },
  },
  required: ['cards'],
  additionalProperties: false,
};

const MOTIF_GUIDE = `Artwork pieces you can place (pick 2-4; at most one frame, one top band, one bottom band):
- top band: string-lights, toran (marigold garland), bunting, clouds, fireworks, moon-full
- top corner: lanterns, kites, sun, crescent (moon and star), birds
- bottom: rangoli, diyas, skyline (domes), kolam, pot (pongal pot), sugarcane, wheat, bonfire, pookalam, modaks, flute, lotus, xmas-tree, gifts, kalash, cake, house, books, sunrise-water, rakhi, marigolds, tiranga, laurel
- frame: frame-gold, arch-frame (mandap arch), kasavu (Kerala gold border), laal-paar (red sari border)
- corners: florals-corner, alpana-corners, mehndi-corners, leaves, peacock-feathers
- scattered: sparkles, confetti, splashes (Holi colours), stars, hearts, snow, shiuli flowers, rain, balloons
- background: bandhani dots, night-sky, sunburst, chakra`;

/**
 * The request in plain words, built from the form (never free-form instructions from
 * a server caller): occasion, who it's for, language, tone, names and the user's note.
 */
export function buildPrompt(r) {
  const lines = [
    'You design Indian greeting cards. Write 3 different cards for this request. Each card has its own wording and its own look.',
    '',
    `Occasion: ${r.occasionLabel || 'not stated, work it out from the note'}`,
    r.relationLabel ? `Who it is for: the sender's ${r.relationLabel}${r.elder ? ' (elder)' : ''}` : '',
    r.to ? `Recipient's name: ${r.to}` : '',
    r.from ? `Sender: ${r.from}` : '',
    r.number ? `Number to mention if it fits (age or years): ${r.number}` : '',
    `Language: ${r.langLabel}. Write heading, message and sign-off only in this language and its own script, never transliterated.`,
    `Tone: ${r.tone || 'warm'}${r.style ? `; visual style: ${r.style}` : ''}`,
    r.note ? `The sender's own words about what they want: """${String(r.note).slice(0, 600)}"""` : '',
    '',
    'Writing rules:',
    '- Heading: 2 to 6 words, the greeting itself (for example "Happy Diwali", "जन्मदिन मुबारक हो").',
    '- Message: 1 to 3 short sentences, at most 45 words, personal to the relationship, natural the way people in India really write. No emoji, no hashtags, no quotation marks.',
    '- Do not start the message with "Dear ..." and do not add the sender name: the card adds both.',
    '- Sign-off: 1 to 3 words ending in a comma, for example "With love," or "सादर प्रणाम,".',
    '- For elders be respectful; for a boss, client or teacher be polished; for friends and siblings you may be playful; for condolences be gentle, with no celebration words.',
    '- Respect the faith of the occasion. Do not invent rituals or facts.',
    '',
    'Design rules:',
    `- theme: one of ${THEME_IDS.join(', ')}. Use the one that fits the occasion.`,
    MOTIF_GUIDE,
    '- palette: bg is two colours for a top-to-bottom gradient, ink is the heading colour, sub is the message colour, c is 4 accent colours. All "#RRGGBB". Text must be easy to read on the background.',
    '- font: display (rounded, festive), serif (classic, elegant) or script (romantic, English only).',
    '- Make the 3 cards clearly different: for example one traditional, one elegant, one bright and modern.',
  ];
  return lines.filter((l) => l !== '').join('\n');
}

export function buildRewritePrompt({ heading, message, signoff }, { langLabel, tone, occasionLabel, relationLabel }) {
  return [
    `Rewrite this greeting card text in ${langLabel}, in its own script, never transliterated.`,
    `Occasion: ${occasionLabel || 'greeting'}. ${relationLabel ? `It is for the sender's ${relationLabel}.` : ''} Tone: ${tone || 'warm'}.`,
    'Keep it natural, the way people in India really write. Heading 2 to 6 words, message at most 45 words, sign-off 1 to 3 words ending in a comma. No emoji.',
    `Heading: ${heading}`,
    `Message: ${message}`,
    `Sign-off: ${signoff}`,
  ].join('\n');
}

export const REWRITE_SCHEMA = {
  type: 'object',
  properties: { heading: { type: 'string' }, message: { type: 'string' }, signoff: { type: 'string' } },
  required: ['heading', 'message', 'signoff'],
  additionalProperties: false,
};
