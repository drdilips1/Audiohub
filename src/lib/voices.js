// Built-in voices (sherpa-onnx), downloaded inside the app and run offline.
import { Capacitor, registerPlugin } from '@capacitor/core';

export const Voices = registerPlugin('InkwellVoices');
export const builtinAvailable = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellVoices');

const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/';

const kokoroSpeakers = [
  ['Default (US, female)', 0],
  ['Bella (US, female)', 1],
  ['Nicole (US, female, soft)', 2],
  ['Sarah (US, female)', 3],
  ['Sky (US, female)', 4],
  ['Adam (US, male)', 5],
  ['Michael (US, male)', 6],
  ['Emma (UK, female)', 7],
  ['Isabella (UK, female)', 8],
  ['George (UK, male)', 9],
  ['Lewis (UK, male)', 10],
];

const piper = (id, label, what, size) => ({
  id: `vits-piper-${id}`,
  name: label,
  what,
  size,
  type: 'vits',
  model: `${id}.onnx`,
  family: 'Piper',
  speakers: [[label, 0]],
});

/** Voice packages you can download in the app. */
export const CATALOG = [
  {
    id: 'kokoro-en-v0_19',
    name: 'Kokoro',
    what: 'Most natural · 11 US & UK voices · slower on older phones',
    size: '≈ 330 MB',
    type: 'kokoro',
    model: 'model.onnx',
    family: 'Kokoro',
    best: true,
    speakers: kokoroSpeakers,
  },
  piper('en_US-lessac-medium', 'Lessac', 'US English · clear female narrator · fast', '≈ 64 MB'),
  piper('en_US-ryan-medium', 'Ryan', 'US English · warm male narrator · fast', '≈ 64 MB'),
  piper('en_US-amy-medium', 'Amy', 'US English · female · fast', '≈ 64 MB'),
  piper('en_US-joe-medium', 'Joe', 'US English · male · fast', '≈ 64 MB'),
  piper('en_GB-alba-medium', 'Alba', 'British English · female · fast', '≈ 64 MB'),
  piper('en_GB-northern_english_male-medium', 'Northern English', 'British English · male · fast', '≈ 64 MB'),
  {
    id: 'kitten-nano-en-v0_1-fp16',
    name: 'Kitten',
    what: 'Tiny download · 8 voices · decent quality',
    size: '≈ 25 MB',
    type: 'kitten',
    model: 'model.fp16.onnx',
    family: 'Kitten',
    speakers: [
      ['Voice 1 (male)', 0],
      ['Voice 2 (female)', 1],
      ['Voice 3 (male)', 2],
      ['Voice 4 (female)', 3],
      ['Voice 5 (male)', 4],
      ['Voice 6 (female)', 5],
      ['Voice 7 (male)', 6],
      ['Voice 8 (female)', 7],
    ],
  },
].map((v) => ({ ...v, url: `${BASE}${v.id}.tar.bz2` }));

export const byId = (id) => CATALOG.find((v) => v.id === id);

export async function installedIds() {
  if (!builtinAvailable) return [];
  try {
    return (await Voices.installed()).ids || [];
  } catch {
    return [];
  }
}

export function download(voice, onProgress) {
  const h = Voices.addListener('progress', (e) => e.id === voice.id && onProgress?.(e));
  return Voices.download({ id: voice.id, url: voice.url })
    .catch((e) => (e?.message === 'ALREADY' ? follow(voice.id, onProgress) : Promise.reject(e)))
    .finally(() => h.then((x) => x.remove()));
}

/** A voice download still running in the background (e.g. the app was closed and reopened). */
export async function activeDownload() {
  if (!builtinAvailable) return null;
  try {
    const a = await Voices.active();
    return a?.id ? a : null;
  } catch {
    return null;
  }
}

/** Follow a running download until it finishes; resolves when the voice is ready. */
export function follow(id, onProgress) {
  return new Promise((resolve, reject) => {
    const h = Voices.addListener('progress', (e) => e.id === id && onProgress?.(e));
    const done = (ok) => {
      clearInterval(t);
      h.then((x) => x.remove());
      ok ? resolve() : reject(new Error('The download stopped — tap Download to try again'));
    };
    const t = setInterval(async () => {
      if (await activeDownload()) return;
      done((await installedIds()).includes(id));
    }, 2000);
  });
}

export const remove = (id) => Voices.remove({ id });

/** Render text with a built-in voice to a WAV in the app cache; resolves the file URI. */
export async function render(voiceId, speaker, text, path) {
  const v = byId(voiceId);
  if (!v) throw new Error('Pick a voice in Settings → Voices first');
  const r = await Voices.synthesize({ id: v.id, type: v.type, model: v.model, speaker, text, path, speed: 1 });
  return r.uri;
}

export const playableUrl = (uri) => Capacitor.convertFileSrc(uri);
