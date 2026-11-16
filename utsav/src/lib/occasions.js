// Every occasion people in India send wishes for. The list is a starting point, not a
// limit: anything the user types ("Pihu's first day at school", "Shop anniversary")
// becomes a custom occasion and gets a design picked from its words and mood.
//
// `theme` chooses the artwork (see design.js). `when` tells the calendar its date:
//   { fixed: 'MM-DD' }                 same date every year (Independence Day)
//   { nth: [month, weekday, n] }       e.g. Mother's Day = 2nd Sunday of May
//   { on: { 2027: 'MM-DD' }, approx }  festivals that follow the moon; dates are
//                                       looked up per year and may shift by a day
//                                       in your region, so the app says so.
// Occasions without `when` (birthdays, promotions…) come from your people list or
// whenever you need them.

export const CATEGORIES = [
  { id: 'festivals', en: 'Festivals', hi: 'त्योहार' },
  { id: 'regional', en: 'Regional', hi: 'क्षेत्रीय' },
  { id: 'religious', en: 'Faith & devotion', hi: 'आस्था' },
  { id: 'relationships', en: 'Relationship days', hi: 'रिश्तों के दिन' },
  { id: 'personal', en: 'Personal', hi: 'व्यक्तिगत' },
  { id: 'professional', en: 'Work & study', hi: 'काम और पढ़ाई' },
  { id: 'life', en: 'Life events', hi: 'जीवन के पल' },
  { id: 'daily', en: 'Daily wishes', hi: 'रोज़ की शुभकामनाएँ' },
  { id: 'national', en: 'National days', hi: 'राष्ट्रीय दिवस' },
];

const A = true; // approx: moon-based date, may differ by a day locally

export const OCCASIONS = [
  // Festivals
  { id: 'diwali', en: 'Diwali', hi: 'दीपावली', cat: 'festivals', theme: 'diwali', kw: ['deepavali', 'deepawali', 'dipawali', 'diya'], when: { on: { 2026: '11-08', 2027: '10-29' }, approx: A } },
  { id: 'dhanteras', en: 'Dhanteras', hi: 'धनतेरस', cat: 'festivals', theme: 'diwali', kw: ['dhan teras'], when: { on: { 2027: '10-27' }, approx: A } },
  { id: 'bhaidooj', en: 'Bhai Dooj', hi: 'भाई दूज', cat: 'festivals', theme: 'rakhi', kw: ['bhai dooj', 'bhau beej', 'bhai phonta', 'bhaiya dooj'], when: { on: { 2027: '10-31' }, approx: A } },
  { id: 'holi', en: 'Holi', hi: 'होली', cat: 'festivals', theme: 'holi', kw: ['colours', 'colors', 'rang', 'dhulandi'], when: { on: { 2027: '03-22' }, approx: A } },
  { id: 'rakhi', en: 'Raksha Bandhan', hi: 'रक्षाबंधन', cat: 'festivals', theme: 'rakhi', kw: ['rakhi', 'raksha bandhan', 'rakshabandhan'], when: { on: { 2027: '08-17' }, approx: A } },
  { id: 'eid', en: 'Eid ul-Fitr', hi: 'ईद', cat: 'festivals', theme: 'eid', kw: ['eid', 'eid mubarak', 'ramzan eid', 'meethi eid'], when: { on: { 2027: '03-10' }, approx: A } },
  { id: 'bakrid', en: 'Eid al-Adha', hi: 'बकरीद', cat: 'festivals', theme: 'eid', kw: ['bakrid', 'bakra eid', 'eid al adha', 'eid-ul-adha'], when: { on: { 2027: '05-17' }, approx: A } },
  { id: 'christmas', en: 'Christmas', hi: 'क्रिसमस', cat: 'festivals', theme: 'christmas', kw: ['xmas', 'merry christmas', 'bada din'], when: { fixed: '12-25' } },
  { id: 'newyear', en: 'New Year', hi: 'नया साल', cat: 'festivals', theme: 'newyear', kw: ['new year', 'naya saal', 'nav varsh'], when: { fixed: '01-01' } },
  { id: 'navratri', en: 'Navratri', hi: 'नवरात्रि', cat: 'festivals', theme: 'durga', kw: ['navratri', 'garba', 'dandiya', 'navaratri'], when: { on: { 2027: '09-30' }, approx: A } },
  { id: 'dussehra', en: 'Dussehra', hi: 'दशहरा', cat: 'festivals', theme: 'durga', kw: ['dasara', 'vijayadashami', 'vijaya dashami', 'dasera'], when: { on: { 2027: '10-09' }, approx: A } },
  { id: 'durgapuja', en: 'Durga Puja', hi: 'दुर्गा पूजा', cat: 'festivals', theme: 'durga', kw: ['durga puja', 'pujo', 'sharodiya', 'bijoya'], when: { on: { 2027: '10-07' }, approx: A } },
  { id: 'ganesh', en: 'Ganesh Chaturthi', hi: 'गणेश चतुर्थी', cat: 'festivals', theme: 'ganesh', kw: ['ganesh', 'ganpati', 'vinayaka', 'chaturthi', 'bappa'], when: { on: { 2027: '09-04' }, approx: A } },
  { id: 'janmashtami', en: 'Janmashtami', hi: 'जन्माष्टमी', cat: 'festivals', theme: 'krishna', kw: ['krishna', 'janmashtami', 'gokulashtami', 'kanha'], when: { on: { 2027: '08-25' }, approx: A } },
  { id: 'makarsankranti', en: 'Makar Sankranti', hi: 'मकर संक्रांति', cat: 'festivals', theme: 'harvest', kw: ['sankranti', 'uttarayan', 'kite', 'til gul'], when: { fixed: '01-14' } },
  { id: 'karvachauth', en: 'Karva Chauth', hi: 'करवा चौथ', cat: 'festivals', theme: 'moon', kw: ['karwa chauth', 'karva chauth'] },
  { id: 'chhath', en: 'Chhath Puja', hi: 'छठ पूजा', cat: 'festivals', theme: 'sunrise', kw: ['chhath', 'chhath puja', 'chhathi maiya'], when: { on: { 2027: '11-04' }, approx: A } },

  // Regional
  { id: 'pongal', en: 'Pongal', hi: 'पोंगल', cat: 'regional', region: 'Tamil Nadu', theme: 'harvest', kw: ['pongal', 'thai pongal'], when: { on: { 2027: '01-15' }, approx: A } },
  { id: 'lohri', en: 'Lohri', hi: 'लोहड़ी', cat: 'regional', region: 'Punjab', theme: 'bonfire', kw: ['lohri'], when: { fixed: '01-13' } },
  { id: 'baisakhi', en: 'Baisakhi', hi: 'बैसाखी', cat: 'regional', region: 'Punjab', theme: 'harvest', kw: ['baisakhi', 'vaisakhi', 'vaishakhi'], when: { on: { 2027: '04-14' }, approx: A } },
  { id: 'onam', en: 'Onam', hi: 'ओणम', cat: 'regional', region: 'Kerala', theme: 'onam', kw: ['onam', 'thiruvonam', 'pookalam'] },
  { id: 'vishu', en: 'Vishu', hi: 'विशु', cat: 'regional', region: 'Kerala', theme: 'onam', kw: ['vishu', 'vishukkani'] },
  { id: 'ugadi', en: 'Ugadi', hi: 'उगादि', cat: 'regional', region: 'Andhra, Telangana, Karnataka', theme: 'newyear-trad', kw: ['ugadi', 'yugadi'], when: { on: { 2027: '04-07' }, approx: A } },
  { id: 'gudipadwa', en: 'Gudi Padwa', hi: 'गुड़ी पड़वा', cat: 'regional', region: 'Maharashtra', theme: 'newyear-trad', kw: ['gudi padwa', 'padwa'], when: { on: { 2027: '04-07' }, approx: A } },
  { id: 'bihu', en: 'Bihu', hi: 'बिहू', cat: 'regional', region: 'Assam', theme: 'harvest', kw: ['bihu', 'rongali', 'bohag'] },
  { id: 'poilabaisakh', en: 'Poila Baisakh', hi: 'पोइला बैसाख', cat: 'regional', region: 'Bengal', theme: 'newyear-trad', kw: ['poila baisakh', 'pohela boishakh', 'bengali new year', 'nobo borsho'] },
  { id: 'puthandu', en: 'Tamil New Year', hi: 'पुथांडु', cat: 'regional', region: 'Tamil Nadu', theme: 'newyear-trad', kw: ['puthandu', 'tamil new year'] },
  { id: 'rathyatra', en: 'Rath Yatra', hi: 'रथ यात्रा', cat: 'regional', region: 'Odisha', theme: 'devotional', kw: ['rath yatra', 'ratha yatra', 'jagannath'] },
  { id: 'teej', en: 'Teej', hi: 'तीज', cat: 'regional', region: 'North India', theme: 'monsoon', kw: ['teej', 'hariyali teej'] },
  { id: 'bihardiwas', en: 'Bihar Diwas', hi: 'बिहार दिवस', cat: 'regional', region: 'Bihar', theme: 'national', kw: ['bihar diwas'], when: { fixed: '03-22' } },
  { id: 'navroz', en: 'Navroz', hi: 'नवरोज़', cat: 'regional', region: 'Parsi', theme: 'spring', kw: ['navroz', 'nowruz', 'parsi new year'] },

  // Faith & devotion
  { id: 'gurpurab', en: 'Gurpurab', hi: 'गुरुपर्व', cat: 'religious', theme: 'gurpurab', kw: ['gurpurab', 'guru nanak jayanti', 'prakash parv', 'gurupurab'], when: { on: { 2026: '11-24', 2027: '11-13' }, approx: A } },
  { id: 'mahashivratri', en: 'Maha Shivratri', hi: 'महाशिवरात्रि', cat: 'religious', theme: 'shiva', kw: ['shivratri', 'mahashivratri', 'mahadev', 'bholenath'] },
  { id: 'ramnavami', en: 'Ram Navami', hi: 'राम नवमी', cat: 'religious', theme: 'devotional', kw: ['ram navami', 'rama navami'], when: { on: { 2027: '04-15' }, approx: A } },
  { id: 'hanumanjayanti', en: 'Hanuman Jayanti', hi: 'हनुमान जयंती', cat: 'religious', theme: 'devotional', kw: ['hanuman jayanti'] },
  { id: 'buddhapurnima', en: 'Buddha Purnima', hi: 'बुद्ध पूर्णिमा', cat: 'religious', theme: 'lotus', kw: ['buddha purnima', 'vesak', 'buddha jayanti'] },
  { id: 'mahavirjayanti', en: 'Mahavir Jayanti', hi: 'महावीर जयंती', cat: 'religious', theme: 'lotus', kw: ['mahavir jayanti'] },
  { id: 'gurupurnima', en: 'Guru Purnima', hi: 'गुरु पूर्णिमा', cat: 'religious', theme: 'lotus', kw: ['guru purnima'] },
  { id: 'vasantpanchami', en: 'Vasant Panchami', hi: 'वसंत पंचमी', cat: 'religious', theme: 'spring', kw: ['basant panchami', 'vasant panchami', 'saraswati puja'] },
  { id: 'ramadan', en: 'Ramadan', hi: 'रमज़ान', cat: 'religious', theme: 'eid', kw: ['ramadan', 'ramzan', 'ramadan kareem', 'roza'] },
  { id: 'easter', en: 'Easter', hi: 'ईस्टर', cat: 'religious', theme: 'spring', kw: ['easter'] },

  // Relationship days
  { id: 'mothersday', en: "Mother's Day", hi: 'मातृ दिवस', cat: 'relationships', theme: 'mother', kw: ["mother's day", 'mothers day'], when: { nth: [5, 0, 2] }, rel: 'mother' },
  { id: 'fathersday', en: "Father's Day", hi: 'पितृ दिवस', cat: 'relationships', theme: 'father', kw: ["father's day", 'fathers day'], when: { nth: [6, 0, 3] }, rel: 'father' },
  { id: 'friendshipday', en: 'Friendship Day', hi: 'मित्रता दिवस', cat: 'relationships', theme: 'friendship', kw: ['friendship day'], when: { nth: [8, 0, 1] }, rel: 'friend' },
  { id: 'valentine', en: "Valentine's Day", hi: 'वैलेंटाइन डे', cat: 'relationships', theme: 'love', kw: ['valentine', "valentine's"], when: { fixed: '02-14' }, rel: 'partner' },
  { id: 'womensday', en: "Women's Day", hi: 'महिला दिवस', cat: 'relationships', theme: 'mother', kw: ["women's day", 'womens day'], when: { fixed: '03-08' } },
  { id: 'teachersday', en: "Teachers' Day", hi: 'शिक्षक दिवस', cat: 'relationships', theme: 'teacher', kw: ["teacher's day", 'teachers day'], when: { fixed: '09-05' }, rel: 'teacher' },
  { id: 'childrensday', en: "Children's Day", hi: 'बाल दिवस', cat: 'relationships', theme: 'birthday', kw: ["children's day", 'bal diwas'], when: { fixed: '11-14' } },
  { id: 'daughtersday', en: "Daughters' Day", hi: 'बेटी दिवस', cat: 'relationships', theme: 'mother', kw: ["daughter's day", 'daughters day'], when: { nth: [9, 0, 4] }, rel: 'daughter' },
  { id: 'doctorsday', en: "Doctors' Day", hi: 'डॉक्टर्स डे', cat: 'relationships', theme: 'thanks', kw: ["doctor's day", 'doctors day'], when: { fixed: '07-01' } },

  // Personal
  { id: 'birthday', en: 'Birthday', hi: 'जन्मदिन', cat: 'personal', theme: 'birthday', kw: ['birthday', 'bday', 'janamdin', 'janmdin', 'happy birthday', 'turning'] },
  { id: 'anniversary', en: 'Anniversary', hi: 'सालगिरह', cat: 'personal', theme: 'love', kw: ['anniversary', 'salgirah', 'wedding anniversary', 'marriage anniversary'] },
  { id: 'thankyou', en: 'Thank you', hi: 'धन्यवाद', cat: 'personal', theme: 'thanks', kw: ['thank', 'thanks', 'grateful', 'shukriya', 'dhanyavaad'] },
  { id: 'sorry', en: 'Sorry', hi: 'माफ़ी', cat: 'personal', theme: 'thanks', kw: ['sorry', 'apology', 'apologise', 'apologize', 'maafi'] },
  { id: 'missyou', en: 'Miss you', hi: 'याद आ रही है', cat: 'personal', theme: 'moon', kw: ['miss you', 'missing you'] },
  { id: 'loveyou', en: 'Love you', hi: 'प्यार', cat: 'personal', theme: 'love', kw: ['love you', 'i love'] },
  { id: 'getwell', en: 'Get well soon', hi: 'जल्दी ठीक हो जाओ', cat: 'personal', theme: 'getwell', kw: ['get well', 'recovery', 'recover', 'surgery', 'feel better'] },
  { id: 'goodluck', en: 'Good luck', hi: 'शुभकामनाएँ', cat: 'personal', theme: 'achievement', kw: ['good luck', 'all the best', 'best of luck', 'exam', 'exams', 'interview'] },
  { id: 'sympathy', en: 'Condolences', hi: 'श्रद्धांजलि', cat: 'personal', theme: 'sympathy', kw: ['condolence', 'condolences', 'sympathy', 'rip', 'shraddhanjali', 'passed away', 'loss'] },

  // Work & study
  { id: 'congrats', en: 'Congratulations', hi: 'बधाई', cat: 'professional', theme: 'achievement', kw: ['congrats', 'congratulations', 'badhai', 'mubarak'] },
  { id: 'promotion', en: 'Promotion', hi: 'पदोन्नति', cat: 'professional', theme: 'achievement', kw: ['promotion', 'promoted'] },
  { id: 'newjob', en: 'New job', hi: 'नई नौकरी', cat: 'professional', theme: 'achievement', kw: ['new job', 'joining', 'offer letter'] },
  { id: 'retirement', en: 'Retirement', hi: 'सेवानिवृत्ति', cat: 'professional', theme: 'farewell', kw: ['retirement', 'retiring', 'retire'] },
  { id: 'farewell', en: 'Farewell', hi: 'विदाई', cat: 'professional', theme: 'farewell', kw: ['farewell', 'leaving', 'last day', 'goodbye', 'vidaai'] },
  { id: 'welcome', en: 'Welcome', hi: 'स्वागत', cat: 'professional', theme: 'thanks', kw: ['welcome', 'swagat'] },
  { id: 'workanniversary', en: 'Work anniversary', hi: 'कार्य वर्षगांठ', cat: 'professional', theme: 'achievement', kw: ['work anniversary', 'years at'] },
  { id: 'results', en: 'Exam results', hi: 'परीक्षा परिणाम', cat: 'professional', theme: 'achievement', kw: ['result', 'results', 'passed', 'topper', 'board exam', 'rank'] },
  { id: 'graduation', en: 'Graduation', hi: 'दीक्षांत', cat: 'professional', theme: 'achievement', kw: ['graduation', 'graduated', 'degree', 'convocation'] },
  { id: 'shopopening', en: 'Shop opening', hi: 'दुकान का उद्घाटन', cat: 'professional', theme: 'home', kw: ['shop opening', 'inauguration', 'grand opening', 'new office', 'new shop', 'udghatan'] },

  // Life events
  { id: 'wedding', en: 'Wedding', hi: 'शादी', cat: 'life', theme: 'wedding', kw: ['wedding', 'marriage', 'shaadi', 'shadi', 'vivah', 'married'] },
  { id: 'engagement', en: 'Engagement', hi: 'सगाई', cat: 'life', theme: 'wedding', kw: ['engagement', 'sagai', 'roka', 'ring ceremony'] },
  { id: 'babyshower', en: 'Baby shower', hi: 'गोद भराई', cat: 'life', theme: 'baby', kw: ['baby shower', 'godh bharai', 'seemantham', 'valaikappu'] },
  { id: 'newbaby', en: 'New baby', hi: 'नन्हा मेहमान', cat: 'life', theme: 'baby', kw: ['new baby', 'baby boy', 'baby girl', 'newborn', 'born'] },
  { id: 'naming', en: 'Naming ceremony', hi: 'नामकरण', cat: 'life', theme: 'baby', kw: ['naming ceremony', 'namkaran', 'naamkaran'] },
  { id: 'housewarming', en: 'Housewarming', hi: 'गृह प्रवेश', cat: 'life', theme: 'home', kw: ['housewarming', 'griha pravesh', 'grihapravesh', 'new home', 'new house'] },
  { id: 'newcar', en: 'New car', hi: 'नई गाड़ी', cat: 'life', theme: 'achievement', kw: ['new car', 'new bike', 'new vehicle'] },

  // Daily
  { id: 'goodmorning', en: 'Good morning', hi: 'सुप्रभात', cat: 'daily', theme: 'morning', kw: ['good morning', 'suprabhat', 'morning'] },
  { id: 'goodnight', en: 'Good night', hi: 'शुभ रात्रि', cat: 'daily', theme: 'night', kw: ['good night', 'shubh ratri', 'night'] },
  { id: 'sunday', en: 'Happy Sunday', hi: 'शुभ रविवार', cat: 'daily', theme: 'morning', kw: ['sunday', 'weekend'] },

  // National days
  { id: 'independence', en: 'Independence Day', hi: 'स्वतंत्रता दिवस', cat: 'national', theme: 'national', kw: ['independence day', '15 august', 'azadi'], when: { fixed: '08-15' } },
  { id: 'republic', en: 'Republic Day', hi: 'गणतंत्र दिवस', cat: 'national', theme: 'national', kw: ['republic day', '26 january'], when: { fixed: '01-26' } },
  { id: 'gandhijayanti', en: 'Gandhi Jayanti', hi: 'गांधी जयंती', cat: 'national', theme: 'national', kw: ['gandhi jayanti', '2 october', 'bapu'], when: { fixed: '10-02' } },
];

export const occasionById = (id) => OCCASIONS.find((o) => o.id === id) || null;

/** A user-typed occasion ("Pihu's first day at school") gets a theme from its words. */
export function customOccasion(text, theme) {
  const label = String(text || '').trim().slice(0, 60) || 'Special day';
  return { id: 'custom', en: label, hi: label, cat: 'custom', theme: theme || themeForText(label), kw: [], custom: true };
}

/** Best theme for free text: an occasion it names, else a mood word, else general festive. */
export function themeForText(text) {
  const o = matchOccasion(text);
  if (o) return o.theme;
  const t = ` ${String(text || '').toLowerCase()} `;
  const moods = [
    [/\b(love|heart|romantic|date)\b/, 'love'],
    [/\b(baby|kid|child|school|first day)\b/, 'baby'],
    [/\b(win|won|award|success|launch|achievement|milestone|cleared)\b/, 'achievement'],
    [/\b(home|house|shop|office|store)\b/, 'home'],
    [/\b(puja|pooja|temple|blessing|prayer|aarti)\b/, 'devotional'],
    [/\b(rain|monsoon|green)\b/, 'monsoon'],
    [/\b(night|moon)\b/, 'night'],
    [/\b(party|celebrat|fun)\b/, 'birthday'],
  ];
  for (const [re, th] of moods) if (re.test(t)) return th;
  return 'lights';
}

/**
 * The occasion a piece of text talks about: "Diwali wishes from our family" → diwali.
 * Longer keywords win, so "wedding anniversary" picks anniversary, not wedding.
 */
export function matchOccasion(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ')} `;
  let best = null, bestLen = 0;
  for (const o of OCCASIONS) {
    for (const k of [o.en.toLowerCase(), o.id, ...o.kw]) {
      const kk = k.toLowerCase();
      if (kk.length > bestLen && t.includes(` ${kk} `)) { best = o; bestLen = kk.length; }
    }
  }
  return best;
}

/** Search box: matches English, Hindi, keywords and region. */
export function searchOccasions(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return OCCASIONS;
  return OCCASIONS.filter((o) => [o.en, o.hi, o.region || '', ...o.kw].some((x) => x.toLowerCase().includes(s)));
}
