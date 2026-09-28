// Hindi section: KukuFM-style categories. Each works like a genre page with
// the user's own Hindi books, Audible India listings and free Internet Archive audio.
const HI = (name, en, match, au, ia, hue) => ({ name, en, match, au, ia, hue, hindi: true });

export const HINDI_ALL = HI('हिंदी', 'Hindi', /./, '', '', 25);

// Genres follow Kuku FM's list (Love, Personal Finance, Historical, Information,
// Career, Religion, Self Help) plus stories, mystery, comedy, poetry and kids.
export const HINDI_GENRES = [
  HI('कहानियाँ', 'Stories', /stor|kahani|कहानी|कथा|fiction|novel|उपन्यास/i, 'कहानियाँ', 'kahani OR कहानी OR stories OR katha', 25),
  HI('प्रेम', 'Love', /romance|love|prem|प्रेम|ishq|इश्क/i, 'romance', 'prem OR romance OR ishq', 340),
  HI('ऐतिहासिक', 'Historical', /histor|itihas|इतिहास|empire|साम्राज्य|biograph|जीवनी/i, 'history', 'itihas OR इतिहास OR history', 20),
  HI('धर्म और भक्ति', 'Religion', /devot|spiritual|religio|bhakti|भक्ति|अध्यात्म|gita|गीता|ramayan|रामायण|mahabharat|महाभारत|hanuman|हनुमान/i, 'spirituality', 'bhakti OR gita OR ramayan OR mahabharat OR भजन', 45),
  HI('सेल्फ़-हेल्प', 'Self Help', /self|motivat|success|प्रेरणा|personal development|psycholog|habit/i, 'self help', 'motivation OR prerna OR प्रेरणा', 160),
  HI('पर्सनल फ़ाइनेंस', 'Personal Finance', /financ|money|invest|paisa|पैसा|wealth|stock|शेयर/i, 'personal finance', 'finance OR paisa OR investment', 140),
  HI('करियर', 'Career', /career|job|interview|leadership|business|व्यापार|entrepreneur/i, 'career', 'career OR business OR vyapar', 200),
  HI('ज्ञान', 'Information', /science|knowledge|gyan|ज्ञान|facts|explain|teach yourself|general knowledge/i, 'knowledge', 'gyan OR ज्ञान OR vigyan', 190),
  HI('रहस्य और सच्ची घटनाएँ', 'Mystery & True crime', /myster|thrill|crime|detective|jasoos|जासूस|रहस्य|scam|spy|murder|true crime/i, 'thriller', 'jasoosi OR रहस्य OR mystery OR crime', 265),
  HI('प्रेमचंद और क्लासिक', 'Classics', /premchand|प्रेमचंद|classic|sahitya|साहित्य/i, 'premchand', 'premchand OR प्रेमचंद OR sahitya', 40),
  HI('हास्य', 'Comedy', /humou?r|comed|hasya|हास्य|व्यंग्य/i, 'comedy', 'hasya OR हास्य OR vyangya', 55),
  HI('कविता', 'Poetry', /poe|kavita|कविता|shayari|शायरी|ghazal/i, 'poetry', 'kavita OR कविता OR shayari OR ghazal', 310),
  HI('बच्चों के लिए', 'Kids', /child|kids|bal|बाल|panchatantra|पंचतंत्र/i, 'kids', 'panchatantra OR बाल OR children', 95),
];

/** Is this book in Hindi? (language tag, Devanagari title, or a Hindi genre tag) */
export const isHindi = (b) =>
  /^(hi|hin|hindi)\b/i.test(b.language || '') || /[ऀ-ॿ]/.test(`${b.title} ${b.author || ''}`) || (b.genres || []).some((g) => /hindi|हिंदी|हिन्दी/i.test(g));
