// Devanagari → plain Latin letters ("गोदान" → "godan", "प्रेमचंद" → "premchand"),
// so Hindi titles can be searched in sources that list books in English letters.
const CONS = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh',
  ष: 'sh', स: 's', ह: 'h', क़: 'q', ख़: 'kh', ग़: 'g', ज़: 'z', ड़: 'r', ढ़: 'rh', फ़: 'f', य़: 'y',
};
const NUKTA = { k: 'q', j: 'z', ph: 'f', d: 'r', dh: 'rh', g: 'g', kh: 'kh' };
const VOWELS = { अ: 'a', आ: 'a', इ: 'i', ई: 'i', उ: 'u', ऊ: 'u', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o', ऍ: 'e' };
const MATRAS = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'e', 'ॉ': 'o' };
const VIRAMA = '्';
const NUKTA_SIGN = '़';
const DIGITS = '०१२३४५६७८९';

export const hasDevanagari = (s) => /[ऀ-ॿ]/.test(String(s || ''));

function word(w) {
  // units: { c: consonant latin, v: vowel latin | 'a' (inherent) | '' (virama) } or { v } for independent vowels
  const units = [];
  const chars = [...w.normalize('NFC')];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (CONS[ch]) units.push({ c: CONS[ch], v: 'a', inherent: true });
    else if (ch === NUKTA_SIGN && units.length && units[units.length - 1].c) {
      const u = units[units.length - 1];
      u.c = NUKTA[u.c] || u.c;
    } else if (MATRAS[ch] && units.length && units[units.length - 1].c) {
      const u = units[units.length - 1];
      u.v = MATRAS[ch];
      u.inherent = false;
    } else if (ch === VIRAMA && units.length && units[units.length - 1].c) {
      const u = units[units.length - 1];
      u.v = '';
      u.inherent = false;
    } else if (VOWELS[ch]) units.push({ c: '', v: VOWELS[ch] });
    else if (ch === 'ं' || ch === 'ँ') units.push({ c: 'n', v: '', nasal: true });
    else if (ch === 'ः') units.push({ c: 'h', v: '' });
    else if (DIGITS.includes(ch)) units.push({ c: String(DIGITS.indexOf(ch)), v: '' });
    else if (ch !== '‍' && ch !== '‌') units.push({ c: ch, v: '', raw: true });
  }
  // Hindi schwa deletion: drop the inherent "a" at the end of a word, and in
  // the middle when a vowel comes before it and a consonant+vowel after it.
  const hasVowel = (u) => u && (u.v !== '' || false);
  const cons = units.filter((u) => u.c && !u.raw && !u.nasal);
  if (cons.length > 1) {
    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i];
      if (!u.inherent) continue;
      const rest = units.slice(i + 1).filter((x) => !x.raw);
      const isLast = rest.every((x) => x.nasal) && rest.length === 0;
      if (isLast && i > 0) {
        u.v = '';
        continue;
      }
      const prev = units[i - 1];
      const next = units[i + 1];
      if (prev && hasVowel(prev) && !prev.nasal && next && next.c && !next.nasal && !next.raw && hasVowel(next)) u.v = '';
    }
  }
  return units.map((u) => u.c + u.v).join('');
}

/** Transliterate any Devanagari in the text; other characters are kept. */
export function translit(text) {
  return String(text || '')
    .split(/([^\u0900-\u097F]+)/)
    .map((w) => (hasDevanagari(w) ? word(w) : w))
    .join('');
}
