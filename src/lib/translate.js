// Translation in the reader: any language (the AI translates, so it doesn't depend on
// the phone), read aloud in a natural Microsoft voice for that language. Whole books are
// translated as you go — the paragraphs on screen and a few ahead — and kept on the
// phone (in the app's files), so going back never asks again.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { persisted } from './store.js';
import { askAi } from './ai.js';
import { Reader as ReadAloud, nativeReader, voiceSpec, ttsCfg } from './tts.js';

const Web = registerPlugin('InkwellWeb');
const native = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');

// code, name, in its own script, Microsoft voices [female, male] (natural, online)
export const LANGS = [
  ['hi', 'Hindi', 'हिन्दी', ['hi-IN-SwaraNeural', 'hi-IN-MadhurNeural']],
  ['en', 'English', 'English', ['en-US-AvaMultilingualNeural', 'en-US-AndrewMultilingualNeural']],
  ['bn', 'Bengali', 'বাংলা', ['bn-IN-TanishaaNeural', 'bn-IN-BashkarNeural']],
  ['mr', 'Marathi', 'मराठी', ['mr-IN-AarohiNeural', 'mr-IN-ManoharNeural']],
  ['gu', 'Gujarati', 'ગુજરાતી', ['gu-IN-DhwaniNeural', 'gu-IN-NiranjanNeural']],
  ['pa', 'Punjabi', 'ਪੰਜਾਬੀ', ['en-US-AvaMultilingualNeural', 'en-US-AndrewMultilingualNeural']],
  ['ta', 'Tamil', 'தமிழ்', ['ta-IN-PallaviNeural', 'ta-IN-ValluvarNeural']],
  ['te', 'Telugu', 'తెలుగు', ['te-IN-ShrutiNeural', 'te-IN-MohanNeural']],
  ['kn', 'Kannada', 'ಕನ್ನಡ', ['kn-IN-SapnaNeural', 'kn-IN-GaganNeural']],
  ['ml', 'Malayalam', 'മലയാളം', ['ml-IN-SobhanaNeural', 'ml-IN-MidhunNeural']],
  ['ur', 'Urdu', 'اردو', ['ur-IN-GulNeural', 'ur-IN-SalmanNeural']],
  ['es', 'Spanish', 'Español', ['es-ES-ElviraNeural', 'es-ES-AlvaroNeural']],
  ['fr', 'French', 'Français', ['fr-FR-DeniseNeural', 'fr-FR-HenriNeural']],
  ['de', 'German', 'Deutsch', ['de-DE-KatjaNeural', 'de-DE-ConradNeural']],
  ['it', 'Italian', 'Italiano', ['it-IT-ElsaNeural', 'it-IT-DiegoNeural']],
  ['pt', 'Portuguese', 'Português', ['pt-BR-FranciscaNeural', 'pt-BR-AntonioNeural']],
  ['ja', 'Japanese', '日本語', ['ja-JP-NanamiNeural', 'ja-JP-KeitaNeural']],
  ['zh', 'Chinese', '中文', ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural']],
  ['ar', 'Arabic', 'العربية', ['ar-SA-ZariyahNeural', 'ar-SA-HamedNeural']],
];
export const lang = (code) => LANGS.find((l) => l[0] === code) || LANGS[0];

// to: the language; male: the voice; on: whole-book translation per book uid (-> code)
export const trCfg = persisted('translate', { to: 'hi', male: false, books: {} });

/** The voice that reads `code` (the one picked: female or male). */
export const voiceFor = (code = trCfg.get().to) => lang(code)[3][trCfg.get().male ? 1 : 0];

/** Already in that language? (Then a translation goes to English instead.) */
const SCRIPTS = { hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, bn: /[ঀ-৿]/, gu: /[઀-૿]/, pa: /[਀-੿]/, ta: /[஀-௿]/, te: /[ఀ-౿]/, kn: /[ಀ-೿]/, ml: /[ഀ-ൿ]/, ur: /[؀-ۿ]/, ar: /[؀-ۿ]/, ja: /[぀-ヿ]/, zh: /[一-鿿]/ };
export const targetFor = (text, to = trCfg.get().to) => (SCRIPTS[to]?.test(text) ? 'en' : to);

const STYLE = 'naturally and fluently, as a good published translation reads (not word for word); keep names, and keep the tone';

/** A passage, translated (the Translate button). */
export async function translateText(text, to = targetFor(text)) {
  return (await askAi(`Translate into ${lang(to)[1]}, ${STYLE}. Give only the translation.\n\n"""${text.slice(0, 2500)}"""`)).trim();
}

/** Several paragraphs at once, in order (one request). */
export async function translateParas(texts, to) {
  const body = texts.map((t, i) => `[${i + 1}] ${t.replace(/\s+/g, ' ').trim()}`).join('\n\n');
  const out = await askAi(
    `Translate each numbered paragraph of this book into ${lang(to)[1]}, ${STYLE}. Keep the numbering exactly: one "[n]" per paragraph, in the same order, nothing else.\n\n${body}`
  );
  const res = new Array(texts.length).fill('');
  const parts = String(out).split(/(?:^|\n)\s*\[(\d+)\]\s*/);
  for (let k = 1; k < parts.length; k += 2) {
    const n = +parts[k] - 1;
    if (n >= 0 && n < texts.length) res[n] = parts[k + 1].trim();
  }
  return res;
}

// ---- a book's translation, kept in the app's files --------------------------------
const hash = (s) => {
  let h = 5381;
  for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
};

/** The translation of one book into one language: paragraph index -> text. */
export function bookTranslation(uid, to) {
  const name = `tr_${hash(uid)}_${to}`;
  let map = {};
  let timer;
  const loaded = native
    ? Web.keepRead({ name })
        .then(({ text }) => (map = { ...(text ? JSON.parse(text) : {}), ...map }))
        .catch(() => {})
    : Promise.resolve();
  const save = () => {
    clearTimeout(timer);
    if (native) timer = setTimeout(() => Web.keepWrite({ name, text: JSON.stringify(map) }).catch(() => {}), 1500);
  };
  return {
    loaded,
    get: (i) => map[i],
    set(i, t) {
      map[i] = t;
      save();
    },
  };
}

/** Read a short text (a translated passage) aloud in the language's natural voice. */
export function speakText(text, code) {
  if (nativeReader)
    return ReadAloud.start({ uid: 'translation', title: 'Translation', paras: [text], from: 0, chapters: [], rate: ttsCfg.get().rate || 1, voice: { ...voiceSpec(), engine: 'edge', edgeVoice: voiceFor(code) } });
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang(code)[3][0].slice(0, 5);
  window.speechSynthesis?.cancel();
  window.speechSynthesis?.speak(u);
  return Promise.resolve();
}
export const stopSpeakingText = () => (nativeReader ? ReadAloud.stop().catch(() => {}) : window.speechSynthesis?.cancel());
