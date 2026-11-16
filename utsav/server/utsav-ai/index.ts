// Utsav AI server: a Supabase Edge Function (Deno) that writes and designs cards.
// The Anthropic API key lives here as a secret (ANTHROPIC_API_KEY), never in the app.
//
// Deploy:
//   npm run server:sync                      # copies aiPrompt.js + design.js next to this file
//   supabase functions deploy utsav-ai --no-verify-jwt
//   supabase secrets set ANTHROPIC_API_KEY=...   (and optionally UTSAV_MODEL, UTSAV_DAILY_LIMIT)
// Then set the app's VITE_AI_URL (GitHub repository variable UTSAV_AI_URL) to the function URL.
//
// It only accepts the card form's fields and builds the prompt itself, so it can't be
// used as a general-purpose chatbot. The daily limit here is per server instance and
// resets on restart; move it to a database table before a large public launch.

import Anthropic from 'npm:@anthropic-ai/sdk';
import { buildPrompt, buildRewritePrompt, CARD_SCHEMA, REWRITE_SCHEMA } from './aiPrompt.js';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
const MODEL = Deno.env.get('UTSAV_MODEL') || 'claude-opus-5-5';
const LIMIT = Number(Deno.env.get('UTSAV_DAILY_LIMIT') || 20);
const used = new Map<string, { day: string; n: number }>();

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

async function ask(prompt: string, schema: object) {
  const params = {
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }],
  };
  // Opus and Sonnet hand a declined request to another model instead of stopping.
  const res = /opus-5-5|sonnet-5-5/.test(MODEL)
    ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as never)
    : await client.messages.create(params as never);
  if ((res as { stop_reason: string }).stop_reason === 'refusal') throw new Error('refused');
  const text = (res as { content: { type: string; text?: string }[] }).content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }

  const device = str(body.device, 64) || req.headers.get('x-forwarded-for') || 'anon';
  const day = new Date().toISOString().slice(0, 10);
  const u = used.get(device);
  const n = u && u.day === day ? u.n : 0;
  if (n >= LIMIT) return json({ error: 'Daily limit reached' }, 429);
  used.set(device, { day, n: n + 1 });

  try {
    if (body.kind === 'cards') {
      const r = (body.request || {}) as Record<string, unknown>;
      const request = {
        occasionLabel: str(r.occasionLabel, 80), relationLabel: str(r.relationLabel, 40), elder: !!r.elder,
        to: str(r.to, 50), from: str(r.from, 60), number: Number.isFinite(r.number) ? Number(r.number) : null,
        langLabel: str(r.langLabel, 60) || 'English', tone: str(r.tone, 20), style: str(r.style, 20), note: str(r.note, 600),
      };
      return json(await ask(buildPrompt(request), CARD_SCHEMA));
    }
    if (body.kind === 'rewrite') {
      const t = (body.text || {}) as Record<string, unknown>, o = (body.opts || {}) as Record<string, unknown>;
      return json(await ask(buildRewritePrompt(
        { heading: str(t.heading, 80), message: str(t.message, 400), signoff: str(t.signoff, 40) },
        { langLabel: str(o.langLabel, 60) || 'English', tone: str(o.tone, 20), occasionLabel: str(o.occasionLabel, 80), relationLabel: str(o.relationLabel, 40) },
      ), REWRITE_SCHEMA));
    }
    return json({ error: 'Unknown request' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'The AI could not answer' }, 502);
  }
});
