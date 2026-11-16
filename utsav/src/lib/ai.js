// Talking to the AI. Three ways in, tried in this order:
//   1. Utsav AI server (VITE_AI_URL): the normal path for a public app. The server holds
//      the API key and limits how much each phone can ask for.
//   2. Your own Anthropic API key (Settings → AI): handy for testing before the server
//      exists. The key stays on this phone and is sent only to api.anthropic.com.
//   3. Inside a claude.ai preview: the page's built-in Claude.
// With none of these the app still works, using the built-in words in messages.js.

import { buildPrompt, buildRewritePrompt, CARD_SCHEMA, REWRITE_SCHEMA } from './aiPrompt.js';

const SERVER = import.meta.env?.VITE_AI_URL || '';
let preview; // claude.ai preview runtime, if any

async function previewSample() {
  if (preview !== undefined) return preview;
  preview = null;
  try { if (window.claude?.use) preview = await window.claude.use('sample'); } catch { preview = null; }
  return preview;
}

/** Which AI path is usable right now, or null for offline words. */
export async function aiMode(settings) {
  if (settings.ai === 'off') return null;
  if (settings.apiKey) return 'key';
  if (SERVER) return 'server';
  if (await previewSample()) return 'preview';
  return null;
}

export const MODELS = [
  { id: 'claude-opus-5-5', en: 'Claude Opus 5.5 — best writing (default)' },
  { id: 'claude-sonnet-5-5', en: 'Claude Sonnet 5.5 — fast and very good' },
  { id: 'claude-haiku-5-5', en: 'Claude Haiku 5.5 — fastest, lowest cost' },
];

async function askWithKey(settings, prompt, schema) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // The key belongs to the phone's owner and only ever goes to Anthropic.
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
  const model = settings.model || 'claude-opus-5-5';
  const params = {
    model,
    max_tokens: 16000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }],
  };
  // Opus and Sonnet can hand a declined request to another model instead of stopping.
  const res = /opus-5-5|sonnet-5-5/.test(model)
    ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : await client.messages.create(params);
  if (res.stop_reason === 'refusal') throw Object.assign(new Error('The AI declined this request. Try different words.'), { code: 'refused' });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

async function askServer(kind, payload) {
  const res = await fetch(SERVER, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, ...payload, device: deviceId() }) });
  if (res.status === 429) throw Object.assign(new Error('You have used today’s free AI cards. Built-in words still work.'), { code: 'limit' });
  if (!res.ok) throw new Error(`The AI server answered ${res.status}.`);
  return res.json();
}

async function askPreview(prompt, shapeHint) {
  const sample = await previewSample();
  return sample.json(`${prompt}\n\nReply with only JSON shaped like: ${shapeHint}`, { modelTier: 'default', cache: false });
}

function deviceId() {
  try {
    let id = localStorage.getItem('utsav:device');
    if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('utsav:device', id); }
    return id;
  } catch { return 'unknown'; }
}

/** Three AI-designed cards for a request. Returns { cards, mode } or throws. */
export async function generateCards(request, settings) {
  const mode = await aiMode(settings);
  if (!mode) return { cards: [], mode: null };
  const prompt = buildPrompt(request);
  let out;
  if (mode === 'key') out = await askWithKey(settings, prompt, CARD_SCHEMA);
  else if (mode === 'server') out = await askServer('cards', { request });
  else out = await askPreview(prompt, '{"cards":[{"heading":"","message":"","signoff":"","theme":"","motifs":[""],"palette":{"bg":["#",""],"ink":"#","sub":"#","c":["#"]},"font":"display"}]}');
  return { cards: Array.isArray(out?.cards) ? out.cards.slice(0, 4) : [], mode };
}

/** New words for an existing card, e.g. in another language or tone. */
export async function rewriteText(text, opts, settings) {
  const mode = await aiMode(settings);
  if (!mode) return null;
  const prompt = buildRewritePrompt(text, opts);
  if (mode === 'key') return askWithKey(settings, prompt, REWRITE_SCHEMA);
  if (mode === 'server') return askServer('rewrite', { text, opts });
  return askPreview(prompt, '{"heading":"","message":"","signoff":""}');
}
