// Words for a card when AI isn't available (no internet, no key): a heading, a message
// and a sign-off in the card's language, shaped by who you're wishing and the tone.
// English and Hindi have full coverage; the other languages have hand-written headings
// for the big occasions and a warm general message. AI writing is still the best path
// for those, and the Create screen says so.
//
// These strings need a native-speaker review before a public launch.

import { occasionById } from './occasions.js';
import { relationById } from './relations.js';
import { LANGS } from './languages.js';

export const TONES = [
  { id: 'warm', en: 'Warm', hi: 'आत्मीय' },
  { id: 'emotional', en: 'Emotional', hi: 'भावुक' },
  { id: 'funny', en: 'Funny', hi: 'मज़ेदार' },
  { id: 'formal', en: 'Respectful', hi: 'औपचारिक' },
  { id: 'short', en: 'Short & sweet', hi: 'छोटा और प्यारा' },
  { id: 'poetic', en: 'Poetic', hi: 'शायराना' },
];

// --- Headings ---------------------------------------------------------------------

const EN_HEAD = {
  eid: 'Eid Mubarak', bakrid: 'Eid al-Adha Mubarak', ramadan: 'Ramadan Kareem', christmas: 'Merry Christmas',
  wedding: 'Happy Married Life', thankyou: 'Thank You', sorry: "I'm Sorry", missyou: 'Missing You', loveyou: 'I Love You',
  getwell: 'Get Well Soon', goodluck: 'Best of Luck', sympathy: 'With Deepest Sympathy', congrats: 'Congratulations!',
  promotion: 'Congratulations on Your Promotion', newjob: 'Congratulations on the New Job', farewell: 'Farewell & Best Wishes',
  welcome: 'Welcome!', results: 'Congratulations on Your Results', graduation: 'Congratulations, Graduate!',
  shopopening: 'Congratulations on the Grand Opening', engagement: 'Congratulations on Your Engagement',
  babyshower: 'Blessings for the Little One', newbaby: 'Welcome, Little One', naming: 'Blessings on the Naming Ceremony',
  housewarming: 'Happy Griha Pravesh', newcar: 'Congratulations on the New Ride', goodmorning: 'Good Morning',
  goodnight: 'Good Night', workanniversary: 'Happy Work Anniversary', durgapuja: 'Shubho Bijoya & Happy Durga Puja',
};

const HI_HEAD = {
  diwali: 'शुभ दीपावली', eid: 'ईद मुबारक', bakrid: 'ईद-उल-अज़हा मुबारक', ramadan: 'रमज़ान मुबारक', birthday: 'जन्मदिन मुबारक हो',
  anniversary: 'शादी की सालगिरह मुबारक', thankyou: 'दिल से धन्यवाद', sorry: 'मुझे माफ़ कर दो', missyou: 'तुम्हारी याद आ रही है',
  loveyou: 'तुमसे बहुत प्यार है', getwell: 'जल्दी स्वस्थ हो जाइए', goodluck: 'ढेरों शुभकामनाएँ', sympathy: 'भावभीनी श्रद्धांजलि',
  congrats: 'हार्दिक बधाई', promotion: 'पदोन्नति की हार्दिक बधाई', newjob: 'नई नौकरी की बधाई', welcome: 'हार्दिक स्वागत',
  results: 'शानदार परिणाम की बधाई', graduation: 'दीक्षांत की हार्दिक बधाई', shopopening: 'नए व्यवसाय की हार्दिक बधाई',
  wedding: 'शुभ विवाह', engagement: 'सगाई की हार्दिक बधाई', newbaby: 'नन्हे मेहमान के आगमन की बधाई', goodmorning: 'सुप्रभात',
  goodnight: 'शुभ रात्रि', sunday: 'शुभ रविवार', newyear: 'नव वर्ष की हार्दिक शुभकामनाएँ', newcar: 'नई गाड़ी की बधाई',
};

// Other languages: the big occasions, written by hand. `generic` is the fallback heading.
const HEAD = {
  mr: { diwali: 'दिवाळीच्या हार्दिक शुभेच्छा', holi: 'होळीच्या हार्दिक शुभेच्छा', rakhi: 'रक्षाबंधनाच्या हार्दिक शुभेच्छा', eid: 'ईद मुबारक', makarsankranti: 'मकर संक्रांतीच्या हार्दिक शुभेच्छा', navratri: 'नवरात्रीच्या हार्दिक शुभेच्छा', ganesh: 'गणेश चतुर्थीच्या हार्दिक शुभेच्छा', wedding: 'शुभ विवाह', birthday: 'वाढदिवसाच्या हार्दिक शुभेच्छा', christmas: 'नाताळच्या हार्दिक शुभेच्छा', newyear: 'नववर्षाच्या हार्दिक शुभेच्छा', anniversary: 'लग्नाच्या वाढदिवसाच्या हार्दिक शुभेच्छा', independence: 'स्वातंत्र्य दिनाच्या हार्दिक शुभेच्छा', goodmorning: 'शुभ सकाळ', congrats: 'हार्दिक अभिनंदन', thankyou: 'धन्यवाद', gudipadwa: 'गुढीपाडव्याच्या हार्दिक शुभेच्छा', generic: 'हार्दिक शुभेच्छा' },
  ta: { diwali: 'தீபாவளி நல்வாழ்த்துகள்', holi: 'ஹோலி நல்வாழ்த்துகள்', rakhi: 'ரக்ஷா பந்தன் நல்வாழ்த்துகள்', eid: 'ஈத் முபாரக்', pongal: 'இனிய பொங்கல் நல்வாழ்த்துகள்', makarsankranti: 'இனிய பொங்கல் நல்வாழ்த்துகள்', navratri: 'நவராத்திரி நல்வாழ்த்துகள்', ganesh: 'விநாயகர் சதுர்த்தி நல்வாழ்த்துகள்', wedding: 'இனிய திருமண வாழ்த்துகள்', birthday: 'இனிய பிறந்தநாள் வாழ்த்துகள்', christmas: 'கிறிஸ்துமஸ் நல்வாழ்த்துகள்', newyear: 'இனிய புத்தாண்டு நல்வாழ்த்துகள்', puthandu: 'இனிய தமிழ்ப் புத்தாண்டு நல்வாழ்த்துகள்', anniversary: 'இனிய திருமண நாள் வாழ்த்துகள்', independence: 'சுதந்திர தின நல்வாழ்த்துகள்', goodmorning: 'காலை வணக்கம்', congrats: 'வாழ்த்துகள்', thankyou: 'நன்றி', onam: 'ஓணம் நல்வாழ்த்துகள்', generic: 'நல்வாழ்த்துகள்' },
  bn: { diwali: 'শুভ দীপাবলি', holi: 'শুভ দোলযাত্রা', rakhi: 'শুভ রাখিবন্ধন', eid: 'ঈদ মোবারক', makarsankranti: 'শুভ মকর সংক্রান্তি', navratri: 'শুভ শারদীয়া', durgapuja: 'শুভ শারদীয়া', dussehra: 'শুভ বিজয়া', ganesh: 'শুভ গণেশ চতুর্থী', wedding: 'শুভ বিবাহ', birthday: 'শুভ জন্মদিন', christmas: 'শুভ বড়দিন', newyear: 'শুভ নববর্ষ', poilabaisakh: 'শুভ নববর্ষ', anniversary: 'শুভ বিবাহবার্ষিকী', independence: 'স্বাধীনতা দিবসের শুভেচ্ছা', goodmorning: 'সুপ্রভাত', congrats: 'অভিনন্দন', thankyou: 'ধন্যবাদ', generic: 'শুভেচ্ছা' },
  gu: { diwali: 'દિવાળીની હાર્દિક શુભેચ્છાઓ', holi: 'હોળીની હાર્દિક શુભેચ્છાઓ', rakhi: 'રક્ષાબંધનની શુભકામનાઓ', eid: 'ઈદ મુબારક', makarsankranti: 'ઉત્તરાયણની શુભકામનાઓ', navratri: 'નવરાત્રિની શુભકામનાઓ', ganesh: 'ગણેશ ચતુર્થીની શુભકામનાઓ', wedding: 'શુભ લગ્ન', birthday: 'જન્મદિવસની હાર્દિક શુભેચ્છાઓ', christmas: 'નાતાલની શુભકામનાઓ', newyear: 'નવા વર્ષની શુભકામનાઓ', anniversary: 'લગ્નતિથિની હાર્દિક શુભેચ્છાઓ', independence: 'સ્વાતંત્ર્ય દિનની શુભેચ્છાઓ', goodmorning: 'સુપ્રભાત', congrats: 'અભિનંદન', thankyou: 'આભાર', generic: 'શુભેચ્છાઓ' },
  ml: { diwali: 'ദീപാവലി ആശംസകൾ', holi: 'ഹോളി ആശംസകൾ', rakhi: 'രക്ഷാബന്ധൻ ആശംസകൾ', eid: 'ഈദ് മുബാറക്', makarsankranti: 'മകരസംക്രാന്തി ആശംസകൾ', onam: 'ഓണാശംസകൾ', vishu: 'വിഷു ആശംസകൾ', navratri: 'നവരാത്രി ആശംസകൾ', ganesh: 'വിനായക ചതുർത്ഥി ആശംസകൾ', wedding: 'വിവാഹ മംഗളാശംസകൾ', birthday: 'ജന്മദിനാശംസകൾ', christmas: 'ക്രിസ്മസ് ആശംസകൾ', newyear: 'പുതുവത്സരാശംസകൾ', anniversary: 'വിവാഹ വാർഷിക ആശംസകൾ', independence: 'സ്വാതന്ത്ര്യദിനാശംസകൾ', goodmorning: 'സുപ്രഭാതം', congrats: 'അഭിനന്ദനങ്ങൾ', thankyou: 'നന്ദി', generic: 'ആശംസകൾ' },
  te: { diwali: 'దీపావళి శుభాకాంక్షలు', holi: 'హోలీ శుభాకాంక్షలు', rakhi: 'రాఖీ పండుగ శుభాకాంక్షలు', eid: 'ఈద్ ముబారక్', makarsankranti: 'సంక్రాంతి శుభాకాంక్షలు', navratri: 'దసరా శుభాకాంక్షలు', dussehra: 'దసరా శుభాకాంక్షలు', ganesh: 'వినాయక చవితి శుభాకాంక్షలు', ugadi: 'ఉగాది శుభాకాంక్షలు', wedding: 'వివాహ శుభాకాంక్షలు', birthday: 'పుట్టినరోజు శుభాకాంక్షలు', christmas: 'క్రిస్మస్ శుభాకాంక్షలు', newyear: 'నూతన సంవత్సర శుభాకాంక్షలు', anniversary: 'వివాహ వార్షికోత్సవ శుభాకాంక్షలు', independence: 'స్వాతంత్ర్య దినోత్సవ శుభాకాంక్షలు', goodmorning: 'శుభోదయం', congrats: 'అభినందనలు', thankyou: 'ధన్యవాదాలు', generic: 'శుభాకాంక్షలు' },
  kn: { diwali: 'ದೀಪಾವಳಿ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು', holi: 'ಹೋಳಿ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು', rakhi: 'ರಕ್ಷಾ ಬಂಧನದ ಶುಭಾಶಯಗಳು', eid: 'ಈದ್ ಮುಬಾರಕ್', makarsankranti: 'ಮಕರ ಸಂಕ್ರಾಂತಿಯ ಶುಭಾಶಯಗಳು', navratri: 'ದಸರಾ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು', dussehra: 'ದಸರಾ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು', ganesh: 'ಗಣೇಶ ಚತುರ್ಥಿಯ ಶುಭಾಶಯಗಳು', ugadi: 'ಯುಗಾದಿ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು', wedding: 'ವಿವಾಹದ ಶುಭಾಶಯಗಳು', birthday: 'ಹುಟ್ಟುಹಬ್ಬದ ಶುಭಾಶಯಗಳು', christmas: 'ಕ್ರಿಸ್ಮಸ್ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು', newyear: 'ಹೊಸ ವರ್ಷದ ಶುಭಾಶಯಗಳು', anniversary: 'ವಿವಾಹ ವಾರ್ಷಿಕೋತ್ಸವದ ಶುಭಾಶಯಗಳು', independence: 'ಸ್ವಾತಂತ್ರ್ಯ ದಿನಾಚರಣೆಯ ಶುಭಾಶಯಗಳು', goodmorning: 'ಶುಭೋದಯ', congrats: 'ಅಭಿನಂದನೆಗಳು', thankyou: 'ಧನ್ಯವಾದಗಳು', generic: 'ಶುಭಾಶಯಗಳು' },
  pa: { diwali: 'ਦੀਵਾਲੀ ਦੀਆਂ ਲੱਖ-ਲੱਖ ਵਧਾਈਆਂ', holi: 'ਹੋਲੀ ਦੀਆਂ ਵਧਾਈਆਂ', rakhi: 'ਰੱਖੜੀ ਦੀਆਂ ਵਧਾਈਆਂ', eid: 'ਈਦ ਮੁਬਾਰਕ', lohri: 'ਲੋਹੜੀ ਦੀਆਂ ਲੱਖ-ਲੱਖ ਵਧਾਈਆਂ', baisakhi: 'ਵਿਸਾਖੀ ਦੀਆਂ ਵਧਾਈਆਂ', gurpurab: 'ਗੁਰਪੁਰਬ ਦੀਆਂ ਲੱਖ-ਲੱਖ ਵਧਾਈਆਂ', wedding: 'ਵਿਆਹ ਦੀਆਂ ਲੱਖ-ਲੱਖ ਵਧਾਈਆਂ', birthday: 'ਜਨਮਦਿਨ ਦੀਆਂ ਵਧਾਈਆਂ', christmas: 'ਕ੍ਰਿਸਮਸ ਦੀਆਂ ਵਧਾਈਆਂ', newyear: 'ਨਵੇਂ ਸਾਲ ਦੀਆਂ ਵਧਾਈਆਂ', anniversary: 'ਵਿਆਹ ਦੀ ਵਰ੍ਹੇਗੰਢ ਦੀਆਂ ਵਧਾਈਆਂ', independence: 'ਆਜ਼ਾਦੀ ਦਿਵਸ ਦੀਆਂ ਵਧਾਈਆਂ', goodmorning: 'ਸ਼ੁਭ ਸਵੇਰ', congrats: 'ਬਹੁਤ-ਬਹੁਤ ਵਧਾਈਆਂ', thankyou: 'ਧੰਨਵਾਦ', generic: 'ਸ਼ੁਭਕਾਮਨਾਵਾਂ' },
  or: { diwali: 'ଦୀପାବଳିର ହାର୍ଦ୍ଦିକ ଶୁଭେଚ୍ଛା', holi: 'ହୋଲିର ଶୁଭେଚ୍ଛା', rakhi: 'ରକ୍ଷାବନ୍ଧନର ଶୁଭେଚ୍ଛା', eid: 'ଇଦ୍ ମୁବାରକ୍', makarsankranti: 'ମକର ସଂକ୍ରାନ୍ତିର ଶୁଭେଚ୍ଛା', navratri: 'ଦୁର୍ଗାପୂଜାର ଶୁଭେଚ୍ଛା', durgapuja: 'ଦୁର୍ଗାପୂଜାର ଶୁଭେଚ୍ଛା', ganesh: 'ଗଣେଶ ପୂଜାର ଶୁଭେଚ୍ଛା', rathyatra: 'ରଥଯାତ୍ରାର ଶୁଭେଚ୍ଛା', wedding: 'ବିବାହର ଶୁଭେଚ୍ଛା', birthday: 'ଜନ୍ମଦିନର ଶୁଭେଚ୍ଛା', christmas: 'ଖ୍ରୀଷ୍ଟମାସର ଶୁଭେଚ୍ଛା', newyear: 'ନୂଆ ବର୍ଷର ଶୁଭେଚ୍ଛା', anniversary: 'ବିବାହ ବାର୍ଷିକୀର ଶୁଭେଚ୍ଛା', independence: 'ସ୍ୱାଧୀନତା ଦିବସର ଶୁଭେଚ୍ଛା', goodmorning: 'ଶୁଭ ସକାଳ', congrats: 'ଅଭିନନ୍ଦନ', thankyou: 'ଧନ୍ୟବାଦ', generic: 'ଶୁଭେଚ୍ଛା' },
  ur: { diwali: 'دیوالی مبارک', holi: 'ہولی مبارک', rakhi: 'رکشا بندھن مبارک', eid: 'عید مبارک', bakrid: 'عید الاضحیٰ مبارک', ramadan: 'رمضان مبارک', wedding: 'شادی مبارک', birthday: 'سالگرہ مبارک', christmas: 'کرسمس مبارک', newyear: 'نیا سال مبارک', anniversary: 'شادی کی سالگرہ مبارک', independence: 'یومِ آزادی مبارک', goodmorning: 'صبح بخیر', goodnight: 'شب بخیر', congrats: 'بہت بہت مبارک ہو', thankyou: 'شکریہ', generic: 'نیک خواہشات' },
};

// Occasions that share another's heading in the regional tables.
const ALIAS = { dussehra: 'navratri', durgapuja: 'navratri', bakrid: 'eid', pongal: 'makarsankranti', dhanteras: 'diwali', results: 'congrats', promotion: 'congrats', newjob: 'congrats', graduation: 'congrats', engagement: 'wedding' };

export function headingFor(occ, lang) {
  if (!occ) return '';
  if (occ.custom) return lang === 'en' ? occ.en : lang === 'hi' ? 'हार्दिक शुभकामनाएँ' : (HEAD[lang]?.generic || occ.en);
  if (lang === 'en') return EN_HEAD[occ.id] || `Happy ${occ.en}`;
  if (lang === 'hi') return HI_HEAD[occ.id] || `${occ.hi} की हार्दिक शुभकामनाएँ`;
  const t = HEAD[lang] || {};
  return t[occ.id] || t[ALIAS[occ.id]] || t.generic || headingFor(occ, 'en');
}

// --- Messages ----------------------------------------------------------------------

const EN_OCC = {
  diwali: 'May the light of a thousand diyas fill your home with joy, health and prosperity.',
  holi: 'Wishing you a day full of colour, laughter and plenty of gujiya.',
  rakhi: 'To the one who has always had my back. This thread carries all my love and a promise for life.',
  eid: 'May this Eid bring peace to your heart and joy to your home.',
  bakrid: 'May your sacrifices be accepted and your home be filled with blessings.',
  christmas: 'Wishing you a season of warmth, cake and the company of the people you love.',
  newyear: 'Here is to fresh starts, good health and a year full of happy surprises.',
  navratri: 'May Maa Durga bless you with strength, courage and nine nights of joy.',
  dussehra: 'May goodness win in every battle of your life. Happy Vijayadashami.',
  durgapuja: 'May Maa Durga bless you with strength, courage and endless happiness.',
  ganesh: 'May Bappa remove every obstacle from your path and fill your home with joy.',
  janmashtami: 'May Kanha fill your life with love, music and a little bit of mischief.',
  makarsankranti: 'May your joys fly as high as the kites today. Til gul ghya, god god bola!',
  pongal: 'May this harvest bring sweetness to every day of the year ahead. Pongalo Pongal!',
  lohri: 'May the warmth of the Lohri fire keep sadness away and bring you closer to the people you love.',
  baisakhi: 'May this harvest season fill your granary and your heart.',
  onam: "May Mahabali's homecoming bring you plenty, a full sadya and happy days.",
  gurpurab: 'May the teachings of Guru Nanak Dev Ji light your path with kindness and truth.',
  birthday: 'Wishing you good health, big laughs and a year full of good news.',
  anniversary: 'Here is to the love you share, the life you have built and many more years together.',
  wedding: 'Wishing you both a lifetime of love, laughter and togetherness.',
  engagement: 'Wishing you both a beautiful journey from this ring to forever.',
  thankyou: 'Your kindness meant more than you know. Thank you from the bottom of my heart.',
  sorry: 'I was wrong and I am truly sorry. You matter too much to me to let this stay between us.',
  missyou: 'Every day feels a little emptier without you. Counting the days until we meet.',
  loveyou: 'You are my favourite person, my safe place and my best decision.',
  getwell: 'Sending you strength and good wishes for a quick and complete recovery.',
  goodluck: 'You have worked hard for this. Go in calm and confident. You have got this!',
  sympathy: 'We are deeply sorry for your loss. May their soul rest in peace, and may you find strength in their memories.',
  congrats: 'So proud of what you have achieved. Here is to many more milestones.',
  promotion: 'Your hard work has paid off. This is just the beginning of bigger things.',
  newjob: 'Wishing you a great start, kind colleagues and lots of success in your new role.',
  retirement: 'Thank you for years of dedication. Wishing you a retirement full of rest, travel and time with family.',
  farewell: 'It has been a privilege to work with you. Wishing you every success in your next chapter.',
  welcome: 'We are so happy to have you with us. Welcome aboard!',
  results: 'Your hard work shows. Wishing you an even brighter road ahead.',
  graduation: 'The world is ready for you. Go chase every dream.',
  shopopening: 'Wishing your new venture great success, loyal customers and lots of growth.',
  babyshower: 'Wishing the mother-to-be good health and the little one a lifetime of love.',
  newbaby: 'A tiny miracle has arrived. Wishing the little one health, happiness and a lifetime of love.',
  naming: 'Wishing the little one a beautiful name and a life as bright as it sounds.',
  housewarming: 'May your new home be filled with peace, laughter and countless happy memories.',
  newcar: 'Wishing you safe drives and many happy journeys.',
  goodmorning: 'May your day be as bright as your smile. Have a wonderful day!',
  goodnight: 'Rest well and dream sweet. Tomorrow is a fresh start.',
  sunday: 'Slow mornings, good chai and time with family. Have a lovely Sunday.',
  independence: 'Proud to be Indian. Let us honour the freedom we were given. Jai Hind!',
  republic: 'Celebrating the spirit of our Constitution and the strength of our unity. Jai Hind!',
  gandhijayanti: "Let us remember Bapu's message of truth and non-violence today and every day.",
  mothersday: 'For every sacrifice you never mentioned and every hug that fixed everything, thank you, Maa.',
  fathersday: 'For your quiet strength and endless support, thank you, Papa. You are my hero.',
  friendshipday: 'Friends like you are the family we choose. Thank you for every laugh and every late-night talk.',
  valentine: 'Every day with you feels like Valentine’s Day.',
  teachersday: 'Thank you for your patience, guidance and belief in me. You shaped who I am.',
  womensday: 'Celebrating your strength, your grace and everything you make possible.',
};

const HI_OCC = {
  diwali: 'दीपों की रोशनी आपके घर को सुख, समृद्धि और खुशियों से भर दे।',
  holi: 'रंगों का यह त्योहार आपके जीवन में खुशियों के रंग भर दे।',
  rakhi: 'यह धागा मेरे प्यार और ज़िंदगी भर साथ निभाने का वादा है।',
  eid: 'यह ईद आपके दिल में सुकून और घर में खुशियाँ लाए।',
  birthday: 'आपका यह नया साल सेहत, खुशियों और सफलता से भरा हो।',
  anniversary: 'आपका साथ यूँ ही बना रहे और हर साल प्यार और गहरा होता जाए।',
  wedding: 'आप दोनों का जीवन प्यार, खुशियों और साथ से भरा रहे।',
  ganesh: 'गणपति बप्पा आपके सारे विघ्न दूर करें। गणपति बप्पा मोरया!',
  navratri: 'माँ दुर्गा आपको शक्ति, साहस और सुख का आशीर्वाद दें।',
  janmashtami: 'कान्हा आपके जीवन को प्रेम और आनंद से भर दें। जय श्री कृष्ण!',
  makarsankranti: 'तिल-गुड़ की मिठास और पतंगों की उड़ान आपके जीवन में खुशियाँ लाए।',
  thankyou: 'आपकी मदद और अपनापन मेरे लिए बहुत मायने रखता है। दिल से धन्यवाद।',
  getwell: 'ईश्वर आपको जल्दी पूरी तरह स्वस्थ करें। अपना ख्याल रखिए।',
  sympathy: 'ईश्वर दिवंगत आत्मा को शांति दें और आपके परिवार को यह दुख सहने की शक्ति दें।',
  goodmorning: 'आपका दिन मंगलमय और खुशियों से भरा हो।',
  goodnight: 'मीठे सपनों के साथ चैन की नींद सोइए।',
  independence: 'हमें भारतीय होने पर गर्व है। जय हिन्द!',
  republic: 'संविधान के सम्मान और एकता की शक्ति को सलाम। जय हिन्द!',
  mothersday: 'माँ, आपके हर त्याग और हर दुलार के लिए दिल से धन्यवाद।',
  fathersday: 'पापा, आपकी हिम्मत और साथ के लिए धन्यवाद। आप मेरे हीरो हैं।',
  teachersday: 'आपके मार्गदर्शन और विश्वास के लिए धन्यवाद। आपने मुझे गढ़ा है।',
  housewarming: 'आपका नया घर सुख, शांति और खुशियों से भरा रहे।',
  retirement: 'आपकी वर्षों की सेवा को नमन। अब परिवार और अपने शौक के साथ सुकून भरे दिन बिताइए।',
};

const EN_CAT = {
  festivals: (o) => `Wishing you and your loved ones a joyful ${o.en}, full of light, laughter and togetherness.`,
  regional: (o) => `Wishing you and your family a happy ${o.en}, full of good food, good company and good fortune.`,
  religious: (o) => `On ${o.en}, may you be blessed with peace, wisdom and happiness.`,
  relationships: (o) => `Happy ${o.en}! Thank you for everything you do.`,
  personal: (o) => `Thinking of you and sending all my best wishes.`,
  professional: () => 'So proud of what you have achieved. Here is to many more milestones.',
  life: () => 'Wishing you a lifetime of happiness as you begin this beautiful new chapter.',
  daily: () => 'Wishing you a calm and happy day.',
  national: () => 'Proud to be Indian. Jai Hind!',
  custom: (o) => `Wishing you all the happiness on this special day.`,
};

const HI_CAT = {
  festivals: (o) => `आपको और आपके परिवार को ${o.hi} की ढेर सारी शुभकामनाएँ। यह पर्व आपके जीवन में सुख, शांति और समृद्धि लाए।`,
  regional: (o) => `आपको और आपके परिवार को ${o.hi} की हार्दिक शुभकामनाएँ।`,
  religious: (o) => `${o.hi} के पावन अवसर पर आपको सुख, शांति और आशीर्वाद मिले।`,
  relationships: () => 'आप जो कुछ भी करते हैं, उसके लिए दिल से धन्यवाद।',
  personal: () => 'आपके लिए ढेर सारी शुभकामनाएँ।',
  professional: () => 'आपकी इस सफलता पर हार्दिक बधाई। आप यूँ ही आगे बढ़ते रहें।',
  life: () => 'जीवन के इस नए अध्याय के लिए ढेर सारी शुभकामनाएँ।',
  daily: () => 'आपका दिन शुभ हो।',
  national: () => 'जय हिन्द!',
  custom: () => 'इस खास दिन पर आपको ढेर सारी खुशियाँ मिलें।',
};

const VOICE = {
  en: { elder: 'Your blessings mean the world to me.', romantic: 'Every day with you is my favourite day.', peer: 'So lucky to have you in my life.', younger: 'Keep shining and keep smiling. So proud of you.', formal: 'It is a privilege to know you.', family: 'Warm wishes to everyone at home.' },
  hi: { elder: 'आपका आशीर्वाद हमेशा बना रहे।', romantic: 'तुम्हारे साथ हर दिन खास है।', peer: 'तुम्हारे जैसा साथ किस्मत से मिलता है।', younger: 'यूँ ही मुस्कुराते रहो और आगे बढ़ते रहो।', formal: 'आपको जानना सम्मान की बात है।', family: 'पूरे परिवार को हार्दिक शुभकामनाएँ।' },
};

const FUNNY_EN = {
  birthday: 'Another year older, and still not a day wiser. Just kidding! Have the best day.',
  holi: 'Wishing you colours that come off easily and memories that never do.',
  diwali: 'May your sweets be plenty and your calories invisible.',
  friendshipday: 'Thank you for being the friend who knows all my secrets and still hangs out with me.',
  anniversary: 'Congratulations on putting up with each other for another whole year!',
  newyear: 'New year, same me, but with better excuses. Happy New Year!',
  retirement: 'No more alarms, no more meetings. Welcome to the best job ever: doing nothing!',
  _: 'Sending you good vibes, big smiles and zero boring moments.',
};

const EMOTIONAL_EN = 'Thank you for being exactly who you are.';
const EMOTIONAL_HI = 'आप जैसे हैं, वैसे ही बने रहिए।';

// A warm general message for languages without per-occasion text.
const GENERIC_MSG = {
  mr: 'तुमचे आयुष्य सदैव आनंद, आरोग्य आणि यशाने भरलेले राहो.',
  ta: 'உங்கள் வாழ்க்கை என்றும் மகிழ்ச்சி, ஆரோக்கியம் மற்றும் வெற்றியால் நிறைந்திருக்கட்டும்.',
  bn: 'আপনার জীবন সবসময় আনন্দ, সুস্বাস্থ্য আর সাফল্যে ভরে থাকুক।',
  gu: 'તમારું જીવન હંમેશા ખુશી, સ્વાસ્થ્ય અને સફળતાથી ભરેલું રહે.',
  ml: 'നിങ്ങളുടെ ജീവിതം എന്നും സന്തോഷവും ആരോഗ്യവും വിജയവും നിറഞ്ഞതാകട്ടെ.',
  te: 'మీ జీవితం ఎల్లప్పుడూ ఆనందం, ఆరోగ్యం మరియు విజయాలతో నిండి ఉండాలి.',
  kn: 'ನಿಮ್ಮ ಜೀವನ ಸದಾ ಸಂತೋಷ, ಆರೋಗ್ಯ ಮತ್ತು ಯಶಸ್ಸಿನಿಂದ ತುಂಬಿರಲಿ.',
  pa: 'ਤੁਹਾਡੀ ਜ਼ਿੰਦਗੀ ਹਮੇਸ਼ਾ ਖੁਸ਼ੀਆਂ, ਸਿਹਤ ਅਤੇ ਕਾਮਯਾਬੀ ਨਾਲ ਭਰੀ ਰਹੇ।',
  or: 'ଆପଣଙ୍କ ଜୀବନ ସର୍ବଦା ସୁଖ, ସ୍ୱାସ୍ଥ୍ୟ ଓ ସଫଳତାରେ ଭରି ରହୁ।',
  ur: 'آپ کی زندگی ہمیشہ خوشیوں، صحت اور کامیابیوں سے بھری رہے۔',
};

// A few hand-written occasion messages beyond English and Hindi.
const MSG = {
  mr: { diwali: 'दिव्यांचा प्रकाश तुमचे घर आनंद आणि समृद्धीने उजळून टाको.', makarsankranti: 'तिळगूळ घ्या, गोड गोड बोला!', ganesh: 'गणपती बाप्पा मोरया! बाप्पा तुमची सर्व विघ्ने दूर करो.' },
  ta: { diwali: 'தீபங்களின் ஒளி உங்கள் இல்லத்தை மகிழ்ச்சியாலும் வளத்தாலும் நிரப்பட்டும்.', pongal: 'பொங்கலோ பொங்கல்! இந்த அறுவடைத் திருநாள் உங்கள் வாழ்வில் இனிமை பொங்கச் செய்யட்டும்.' },
  bn: { diwali: 'প্রদীপের আলো আপনার ঘর আনন্দ আর সমৃদ্ধিতে ভরিয়ে দিক।', durgapuja: 'মা দুর্গা আপনাকে শক্তি, সাহস আর আনন্দ দিন।' },
  gu: { diwali: 'દીવાનો પ્રકાશ તમારા ઘરને સુખ અને સમૃદ્ધિથી ભરી દે.', makarsankranti: 'પતંગની જેમ તમારી ખુશીઓ પણ આકાશને આંબે.' },
  ml: { onam: 'മാവേലി നാടുവാണീടും കാലം പോലെ, ഈ ഓണം നിങ്ങൾക്ക് സമൃദ്ധിയും സന്തോഷവും നൽകട്ടെ.', diwali: 'ദീപങ്ങളുടെ വെളിച്ചം നിങ്ങളുടെ വീട്ടിൽ സന്തോഷവും ഐശ്വര്യവും നിറയ്ക്കട്ടെ.' },
  ur: { eid: 'یہ عید آپ کے دل میں سکون اور گھر میں خوشیاں لائے۔' },
};

const NO_VOICE = new Set(['sympathy', 'goodmorning', 'goodnight', 'sunday', 'independence', 'republic', 'gandhijayanti']);

export function messageFor(occ, { lang = 'en', relation = null, tone = 'warm' } = {}) {
  if (!occ) return '';
  const voice = relationById(relation)?.voice;
  if (lang === 'en' || lang === 'hi') {
    const en = lang === 'en';
    let base = (en ? EN_OCC : HI_OCC)[occ.id] || (en ? EN_CAT : HI_CAT)[occ.cat]?.(occ) || (en ? EN_CAT : HI_CAT).custom(occ);
    if (tone === 'funny' && en && occ.id !== 'sympathy') base = FUNNY_EN[occ.id] || FUNNY_EN._;
    if (tone === 'short') return base.split(/(?<=[.!।])\s/)[0];
    const parts = [base];
    if (voice && !NO_VOICE.has(occ.id) && tone !== 'funny') parts.push(VOICE[lang][voice]);
    if (tone === 'emotional' && !NO_VOICE.has(occ.id)) parts.push(en ? EMOTIONAL_EN : EMOTIONAL_HI);
    return parts.join(' ');
  }
  return MSG[lang]?.[occ.id] || MSG[lang]?.[ALIAS[occ.id]] || GENERIC_MSG[lang] || messageFor(occ, { lang: 'en', relation, tone });
}

/** The line above the sender's name: "With love," / "Warm regards," / "सादर प्रणाम,". */
export function signoffFor(lang, relation, occ) {
  const voice = relationById(relation)?.voice;
  if (occ?.id === 'sympathy') return lang === 'hi' ? 'शोक संवेदना सहित,' : lang === 'en' ? 'With heartfelt condolences,' : (LANGS[lang] || LANGS.en).love;
  if (lang === 'en') return voice === 'formal' ? 'Warm regards,' : voice === 'elder' ? 'With love and respect,' : 'With love,';
  if (lang === 'hi') return voice === 'formal' ? 'सादर,' : voice === 'elder' ? 'सादर प्रणाम,' : LANGS.hi.love;
  return (LANGS[lang] || LANGS.en).love;
}

/** True when this language has hand-written words for this occasion (not just the general fallback). */
export function hasOwnWords(occ, lang) {
  if (lang === 'en' || lang === 'hi') return true;
  return !!(HEAD[lang]?.[occ?.id] || HEAD[lang]?.[ALIAS[occ?.id]]);
}

export const occasionText = (id, lang, relation, tone) => {
  const o = occasionById(id);
  return { heading: headingFor(o, lang), message: messageFor(o, { lang, relation, tone }), signoff: signoffFor(lang, relation, o) };
};
