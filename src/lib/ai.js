// AI helpers using free services with your own key (Groq or OpenRouter):
// a spoiler-safe recap of the story so far / the previous chapter, a
// character glossary that only knows what has happened up to where you are,
// and the bookseller. If one service is busy the next one (or model) is tried.
import { persisted } from './store.js';
import * as player from './player.js';
import { heardText } from './transcript.js';

export const ai = persisted('ai', { groqKey: '', openrouterKey: '', last: '' });

/** Free services, in the order they are tried. All speak the OpenAI chat format. */
export const PROVIDERS = [
  {
    id: 'groq',
    name: 'Groq',
    keyField: 'groqKey',
    site: 'console.groq.com/keys',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'],
    json: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    keyField: 'openrouterKey',
    site: 'openrouter.ai/keys',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    // OpenRouter's free line-up changes often: the live list is fetched (see freeRouterModels); these are only a fallback.
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat-v3-0324:free', 'qwen/qwen-2.5-72b-instruct:free', 'mistralai/mistral-small-3.2-24b-instruct:free'],
    discover: () => freeRouterModels(),
    json: false,
    headers: { 'HTTP-Referer': 'https://drdilips1.github.io/audiohub/', 'X-Title': 'Audiohub' },
  },
];

// Families that give good book answers, best first; anything else free comes after.
const PREFER = [/^openrouter\/free$/, /deepseek-chat|deepseek-v3/, /llama-3\.3-70b|llama-4-maverick/, /qwen.*(235b|72b|32b)/, /gpt-oss/, /gemma-3-27b|gemma-3n?/, /mistral-small|mistral-nemo/, /llama/];
const routerList = persisted('aiRouterModels', { t: 0, ids: [] });

/** OpenRouter models that are free right now (public list, no key needed; cached for 12 hours). */
async function freeRouterModels() {
  const hit = routerList.get();
  if (hit.ids.length && Date.now() - hit.t < 12 * 3600e3) return hit.ids;
  // A slow or blocked list must not hold up the question: give up after 5 s (the saved or built-in list is used).
  const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error('list');
  const { data = [] } = await res.json();
  const rank = (id) => {
    const i = PREFER.findIndex((r) => r.test(id));
    return i < 0 ? PREFER.length : i;
  };
  const ids = data
    .filter((m) => {
      const free = m.id.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0);
      const text = !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text');
      return free && text && (m.context_length || 0) >= 8000;
    })
    .sort((a, b) => rank(a.id) - rank(b.id) || (b.context_length || 0) - (a.context_length || 0))
    .slice(0, 6)
    .map((m) => m.id);
  if (ids.length) routerList.set({ t: Date.now(), ids });
  return ids;
}

// Never waits for the list: the saved one (or the built-in fallback) is used at once
// and refreshed in the background when it's old.
async function modelsFor(p) {
  if (!p.discover) return p.models;
  p.discover().catch(() => {});
  return routerList.get().ids.length ? routerList.get().ids : p.models;
}

// OpenRouter refuses free models until the account allows them in its privacy settings.
const POLICY = /data policy|privacy|free model (publication|training)|No endpoints found matching/i;
const policyHelp = (name) => `${name} is blocking its free models: open openrouter.ai/settings/privacy and turn on the options for free models (training / publication), then try again`;

const keyOf = (p) => (ai.get()[p.keyField] || '').trim();
export const aiReady = () => PROVIDERS.some(keyOf);

const cache = persisted('aiCache', {}); // prompt key -> { t, v }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(p, model, prompt, json) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(p.url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keyOf(p)}`, ...(p.headers || {}) },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        ...(json && p.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data?.error?.message || data?.message || `${p.name} error ${res.status}`);
      e.status = res.status;
      throw e;
    }
    const text = (data.choices?.[0]?.message?.content || '').trim();
    if (!text) throw Object.assign(new Error(`${p.name} returned nothing`), { status: 502 });
    return text;
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error(`${p.name} took too long`), { status: 504 });
    if (e.status == null) e.status = 0; // network
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the JSON object out of a reply (some models wrap it in prose or fences). */
export function parseJson(text) {
  const t = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('bad json');
  }
}

/**
 * Ask the AI. Starts with the service/model that last worked; on a busy,
 * rate-limited or failing reply it waits briefly, retries once, then moves on
 * to the next model and the next service.
 */
export async function askAi(prompt, { json = false, skip = [] } = {}) {
  const ready = PROVIDERS.filter(keyOf);
  if (!ready.length) throw new Error('Add a free AI key (Groq or OpenRouter) in Settings → AI first');
  // Services in their fixed order (Groq, the fastest, first); within a service the model that last worked leads.
  const last = ai.get().last;
  const lists = await Promise.all(
    ready.map(async (p) => {
      let ms = (await modelsFor(p)).map((m) => [p, m]);
      const li = ms.findIndex(([, m]) => `${p.id}/${m}` === last);
      if (li > 0) ms = [ms[li], ...ms.filter((_, i) => i !== li)];
      // Skip models whose answer wasn't usable (e.g. "I don't know this book"), if others exist.
      const rest = ms.filter(([, m]) => !skip.includes(`${p.id}/${m}`));
      return rest.length ? rest : ms;
    })
  );
  const order = lists.flat();
  // A slow answer (busy model, a "thinking" model) shouldn't hold you up: after 10 s the
  // next service is asked as well, and whichever answers first is used.
  const others = lists.slice(1).flat();
  if (!others.length) return chain(order, prompt, json, ready);
  return new Promise((resolve, reject) => {
    let settled = false;
    let hedging = false;
    let failures = 0;
    const win = (t) => !settled && ((settled = true), resolve(t));
    const fail = (e) => {
      failures++;
      // The full chain already tried every service: give up unless the second try is still going.
      if (!settled && (!hedging || failures === 2)) (settled = true), reject(e);
    };
    chain(order, prompt, json, ready).then(win, fail);
    setTimeout(() => {
      if (settled) return;
      hedging = true;
      chain(others, prompt, json, ready).then(win, fail);
    }, 10000);
  });
}

async function chain(order, prompt, json, ready) {
  const errors = {};
  const deadKeys = new Set();
  const blocked = new Set();
  let retried = false; // one short wait-and-retry per request; after that, move on at once
  for (const [p, model] of order) {
    if (deadKeys.has(p.id) || blocked.has(p.id)) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await call(p, model, prompt, json);
        if (json) parseJson(text); // a garbled reply counts as a failure: try the next one
        if (ai.get().last !== `${p.id}/${model}`) ai.patch({ last: `${p.id}/${model}` });
        return text;
      } catch (e) {
        errors[p.id] = e;
        if (e.status === 401 || e.status === 403) {
          deadKeys.add(p.id); // bad key: skip the rest of this service
          break;
        }
        if (POLICY.test(e.message)) {
          blocked.add(p.id); // account setting blocks free models: no point trying others here
          break;
        }
        if (e.status === 400 || e.status === 404 || e.message === 'bad json') break; // model gone / unsupported: next model
        if (attempt === 0 && !retried && (e.status === 503 || e.status === 502 || e.status === 500 || e.status === 0)) {
          retried = true;
          await wait(1500);
          continue;
        }
        break; // 429 and others: next model / service straight away
      }
    }
  }
  if (blocked.size && blocked.size + deadKeys.size === ready.length) throw new Error(policyHelp(PROVIDERS.find((p) => blocked.has(p.id)).name));
  const bad = [...deadKeys].map((id) => PROVIDERS.find((p) => p.id === id).name);
  if (bad.length === ready.length) throw new Error(`${bad.join(' and ')} rejected the key — check it in Settings → AI`);
  throw new Error(ready.length > 1 ? 'All AI services are busy right now — try again in a minute' : `${ready[0].name} is busy right now — try again in a minute, or add a second free service in Settings → AI`);
}

/** Check one service's key; resolves a short status line. */
export async function testProvider(id) {
  const p = PROVIDERS.find((x) => x.id === id);
  let lastErr;
  for (const model of (await modelsFor(p)).slice(0, 4)) {
    try {
      await call(p, model, 'Reply with the single word OK.', false);
      return `${p.name} is working`;
    } catch (e) {
      lastErr = e;
      if (e.status === 401 || e.status === 403) throw new Error(`${p.name} rejected the key`);
      if (POLICY.test(e.message)) throw new Error(policyHelp(p.name));
    }
  }
  throw new Error(`${p.name}: ${lastErr?.message || 'not reachable'}`);
}

/** Where the listener is: chapter title, number, and % through the book. */
export function position(upToChapter) {
  const ps = player.getState();
  const b = ps.book;
  if (!b) throw new Error('Start a book first');
  const chapters = player.chapters();
  const g = player.globalTime();
  const total = player.totalDuration() || 0;
  let ci = chapters.findIndex((c) => g >= c.start && g < (c.end || Infinity));
  if (ci < 0) ci = Math.max(0, chapters.length - 1);
  const at = upToChapter != null ? Math.min(upToChapter, ci) : ci;
  const pct = total ? Math.round(((upToChapter != null && upToChapter < ci ? chapters[at].end || g : g) / total) * 100) : null;
  return {
    book: b,
    chapters,
    current: ci,
    at,
    pct,
    label: `${chapters[at]?.title || `Part ${at + 1}`} (${at + 1} of ${chapters.length || 1})${pct != null ? `, about ${pct}% through the book` : ''}`,
    heard: heardText(b.uid, ps.index, ps.time),
  };
}

const bookLine = (b) => `"${b.title}"${b.author ? ` by ${b.author}` : ''}`;
const RULES = `Strict spoiler rules: use ONLY events and facts revealed up to and including the listener's current position. Never mention, hint at or foreshadow anything later — no deaths, twists, reveals or fates that happen afterwards. If you are not sure whether something has happened yet, leave it out. If you don't know this book and the transcript is empty, say so briefly instead of inventing.`;

async function cached(key, fn) {
  const hit = cache.get()[key];
  if (hit && Date.now() - hit.t < 30 * 86400e3) return hit.v;
  const v = await fn();
  cache.set((c) => {
    const keys = Object.keys(c);
    const next = keys.length > 60 ? Object.fromEntries(keys.slice(-40).map((k) => [k, c[k]])) : { ...c };
    next[key] = { t: Date.now(), v };
    return next;
  });
  return v;
}

/** mode: 'story' (the story so far) or 'chapter' (the previous chapter). */
export async function recap(mode = 'story') {
  const p = position();
  const target = mode === 'chapter' ? Math.max(0, p.current - 1) : p.current;
  const key = `recap:${p.book.uid}:${mode}:${target}`;
  return cached(key, () =>
    askAi(
      `You help someone listening to the audiobook ${bookLine(p.book)}. They are at: ${p.label}.
${mode === 'chapter' ? `Write a recap of the previous chapter (${p.chapters[target]?.title || `part ${target + 1}`}) only.` : 'Write "The story so far": a recap of everything up to their current position.'}
${RULES}
Style: warm, clear, spoken-friendly prose (it may be read aloud), ${mode === 'chapter' ? '120–200' : '200–350'} words, no headings or bullet points, no preamble.
${p.heard ? `Transcript of what they have heard (may contain recognition errors; trust it over your memory for this edition):\n"""${p.heard}"""` : ''}`,
    ),
  );
}

/** Characters known up to a chapter index (defaults to the current one). */
export async function characters(upToChapter) {
  const p = position(upToChapter);
  const key = `chars:${p.book.uid}:${p.at}`;
  const raw = await cached(key, () =>
    askAi(
      `List the characters of the audiobook ${bookLine(p.book)} as known to a listener who has reached: ${p.label}.
${RULES}
Return JSON: {"characters":[{"name":"","aliases":[""],"role":"one short line","about":"2–3 sentences, only what is known by this point"}]}. At most 20 characters, most important first. Omit characters who have not appeared yet.
${p.heard ? `Transcript of what they have heard:\n"""${p.heard}"""` : ''}`,
      { json: true },
    ),
  );
  try {
    const d = parseJson(raw);
    return { position: p, list: (d.characters || []).filter((c) => c && c.name) };
  } catch {
    throw new Error('The AI sent an unexpected reply — try again');
  }
}
