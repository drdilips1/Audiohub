// Every language a card can be written in. Each script gets a rounded display face
// (the Baloo 2 family covers all Indian scripts with one look), a classical serif face,
// and a plain face for the message. Android ships Noto fonts for every script, so if a
// web font can't load (no internet) the card still renders in the right script.

export const LANGS = {
  en: { name: 'English', native: 'English', ai: 'English', display: 'Baloo 2', serif: 'Playfair Display', script: 'Great Vibes', body: 'Mukta', sys: 'Noto Sans', dear: 'Dear', love: 'With love,' },
  hi: { name: 'Hindi', native: 'हिन्दी', ai: 'Hindi (Devanagari script)', display: 'Baloo 2', serif: 'Tiro Devanagari Hindi', body: 'Mukta', sys: 'Noto Sans Devanagari', dear: 'प्रिय', love: 'शुभकामनाओं सहित,' },
  ur: { name: 'Urdu', native: 'اردو', ai: 'Urdu (Nastaliq, Urdu script)', display: 'Baloo Bhaijaan 2', serif: 'Noto Nastaliq Urdu', body: 'Noto Nastaliq Urdu', sys: 'Noto Nastaliq Urdu', rtl: true, tall: true, dear: 'پیارے', love: 'محبت کے ساتھ،' },
  pa: { name: 'Punjabi', native: 'ਪੰਜਾਬੀ', ai: 'Punjabi (Gurmukhi script)', display: 'Baloo Paaji 2', serif: 'Tiro Gurmukhi', body: 'Mukta Mahee', sys: 'Noto Sans Gurmukhi', dear: 'ਪਿਆਰੇ', love: 'ਪਿਆਰ ਨਾਲ,' },
  bn: { name: 'Bengali', native: 'বাংলা', ai: 'Bengali (Bengali script)', display: 'Baloo Da 2', serif: 'Tiro Bangla', body: 'Hind Siliguri', sys: 'Noto Sans Bengali', dear: 'প্রিয়', love: 'শুভেচ্ছা সহ,' },
  ta: { name: 'Tamil', native: 'தமிழ்', ai: 'Tamil (Tamil script)', display: 'Baloo Thambi 2', serif: 'Tiro Tamil', body: 'Mukta Malar', sys: 'Noto Sans Tamil', dear: 'அன்புள்ள', love: 'அன்புடன்,' },
  te: { name: 'Telugu', native: 'తెలుగు', ai: 'Telugu (Telugu script)', display: 'Baloo Tammudu 2', serif: 'Tiro Telugu', body: 'Noto Sans Telugu', sys: 'Noto Sans Telugu', dear: 'ప్రియమైన', love: 'ప్రేమతో,' },
  mr: { name: 'Marathi', native: 'मराठी', ai: 'Marathi (Devanagari script)', display: 'Baloo 2', serif: 'Tiro Devanagari Marathi', body: 'Mukta', sys: 'Noto Sans Devanagari', dear: 'प्रिय', love: 'शुभेच्छांसह,' },
  gu: { name: 'Gujarati', native: 'ગુજરાતી', ai: 'Gujarati (Gujarati script)', display: 'Baloo Bhai 2', serif: 'Rasa', body: 'Hind Vadodara', sys: 'Noto Sans Gujarati', dear: 'પ્રિય', love: 'શુભેચ્છાઓ સાથે,' },
  kn: { name: 'Kannada', native: 'ಕನ್ನಡ', ai: 'Kannada (Kannada script)', display: 'Baloo Tamma 2', serif: 'Tiro Kannada', body: 'Noto Sans Kannada', sys: 'Noto Sans Kannada', dear: 'ಪ್ರೀತಿಯ', love: 'ಪ್ರೀತಿಯಿಂದ,' },
  ml: { name: 'Malayalam', native: 'മലയാളം', ai: 'Malayalam (Malayalam script)', display: 'Baloo Chettan 2', serif: 'Manjari', body: 'Manjari', sys: 'Noto Sans Malayalam', dear: 'പ്രിയപ്പെട്ട', love: 'സ്നേഹപൂർവ്വം,' },
  or: { name: 'Odia', native: 'ଓଡ଼ିଆ', ai: 'Odia (Odia script)', display: 'Baloo Bhaina 2', serif: 'Noto Serif Oriya', body: 'Noto Sans Oriya', sys: 'Noto Sans Oriya', dear: 'ପ୍ରିୟ', love: 'ଶୁଭେଚ୍ଛା ସହ,' },
};

export const LANG_IDS = Object.keys(LANGS);

/** "Dear Priya," in the card's language. English puts the name after "Dear" too. */
export function dearLine(lang, name) {
  const n = (name || '').trim();
  if (!n) return '';
  const L = LANGS[lang] || LANGS.en;
  return lang === 'ur' ? `${L.dear} ${n}،` : `${L.dear} ${n},`;
}

/** Google Fonts stylesheet for every face above, loaded once at start-up. */
export function fontsHref() {
  const fams = new Set();
  for (const L of Object.values(LANGS)) {
    for (const k of ['display', 'serif', 'script', 'body']) if (L[k]) fams.add(L[k]);
  }
  fams.add('Yatra One');
  const spec = (f) => {
    const name = f.replace(/ /g, '+');
    if (/^Baloo/.test(f)) return `family=${name}:wght@500;700;800`;
    if (/^(Mukta|Mukta Malar|Mukta Mahee|Hind Siliguri|Hind Vadodara)$/.test(f)) return `family=${name}:wght@400;500;700`;
    if (/^(Playfair Display|Rasa|Manjari|Noto Nastaliq Urdu|Noto Serif Oriya|Noto Sans Telugu|Noto Sans Kannada|Noto Sans Oriya)$/.test(f)) return `family=${name}:wght@400;700`;
    return `family=${name}`;
  };
  return `https://fonts.googleapis.com/css2?${[...fams].map(spec).join('&')}&display=swap`;
}
