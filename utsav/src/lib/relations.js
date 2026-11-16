// "Who are you wishing?" The relationship sets the voice of the message: you write to
// your Dadi differently from your best friend or your boss. `voice` is what the message
// composer and the AI use:
//   elder    – respectful, blessings asked for ("aap", "charan sparsh")
//   romantic – partner, warm and personal
//   peer     – friends and siblings, casual, can be playful
//   younger  – children, nieces, younger siblings, blessings given
//   formal   – boss, client, colleague, teacher: polished, no slang
//   family   – a whole household ("Sharma family")

export const RELATIONS = [
  { id: 'mother', en: 'Mother', hi: 'माँ', voice: 'elder', words: ['mother', 'mom', 'mummy', 'mum', 'maa', 'ma', 'amma', 'mata'] },
  { id: 'father', en: 'Father', hi: 'पापा', voice: 'elder', words: ['father', 'dad', 'papa', 'daddy', 'pitaji', 'appa', 'baba', 'abbu'] },
  { id: 'wife', en: 'Wife', hi: 'पत्नी', voice: 'romantic', words: ['wife', 'patni', 'biwi', 'better half'] },
  { id: 'husband', en: 'Husband', hi: 'पति', voice: 'romantic', words: ['husband', 'pati', 'hubby'] },
  { id: 'partner', en: 'Partner', hi: 'जीवनसाथी', voice: 'romantic', words: ['partner', 'girlfriend', 'boyfriend', 'love', 'fiance', 'fiancee', 'jaan'] },
  { id: 'sister', en: 'Sister', hi: 'बहन', voice: 'peer', words: ['sister', 'didi', 'behen', 'bahen', 'sis', 'akka', 'tai'] },
  { id: 'brother', en: 'Brother', hi: 'भाई', voice: 'peer', words: ['brother', 'bhai', 'bhaiya', 'bro', 'anna', 'dada'] },
  { id: 'friend', en: 'Friend', hi: 'दोस्त', voice: 'peer', words: ['friend', 'dost', 'bestie', 'buddy', 'yaar', 'bff'] },
  { id: 'son', en: 'Son', hi: 'बेटा', voice: 'younger', words: ['son', 'beta'] },
  { id: 'daughter', en: 'Daughter', hi: 'बेटी', voice: 'younger', words: ['daughter', 'beti'] },
  { id: 'grandmother', en: 'Grandmother', hi: 'दादी / नानी', voice: 'elder', words: ['grandmother', 'grandma', 'dadi', 'nani', 'paati', 'ammamma'] },
  { id: 'grandfather', en: 'Grandfather', hi: 'दादा / नाना', voice: 'elder', words: ['grandfather', 'grandpa', 'dadaji', 'nana', 'thatha'] },
  { id: 'uncle', en: 'Uncle', hi: 'चाचा / मामा', voice: 'elder', words: ['uncle', 'chacha', 'mama', 'tauji', 'mausa', 'fufa'] },
  { id: 'aunt', en: 'Aunt', hi: 'चाची / मौसी', voice: 'elder', words: ['aunt', 'aunty', 'auntie', 'chachi', 'mami', 'mausi', 'bua', 'taiji'] },
  { id: 'inlaws', en: 'In-laws', hi: 'सास-ससुर', voice: 'elder', words: ['in-law', 'in law', 'saas', 'sasur', 'mother-in-law', 'father-in-law'] },
  { id: 'cousin', en: 'Cousin', hi: 'कज़िन', voice: 'peer', words: ['cousin'] },
  { id: 'niece', en: 'Niece / Nephew', hi: 'भतीजी / भतीजा', voice: 'younger', words: ['niece', 'nephew', 'bhatija', 'bhatiji', 'bhanja', 'bhanji'] },
  { id: 'teacher', en: 'Teacher', hi: 'शिक्षक', voice: 'formal', words: ['teacher', 'sir', 'madam', 'guru', 'guruji', 'professor', 'mentor', 'principal'] },
  { id: 'boss', en: 'Boss', hi: 'बॉस', voice: 'formal', words: ['boss', 'manager', 'senior', 'head', 'director'] },
  { id: 'colleague', en: 'Colleague', hi: 'सहकर्मी', voice: 'formal', words: ['colleague', 'coworker', 'co-worker', 'team', 'office'] },
  { id: 'client', en: 'Client / Customer', hi: 'ग्राहक', voice: 'formal', words: ['client', 'customer', 'customers', 'clients', 'business'] },
  { id: 'neighbour', en: 'Neighbour', hi: 'पड़ोसी', voice: 'formal', words: ['neighbour', 'neighbor', 'padosi'] },
  { id: 'family', en: 'A family', hi: 'परिवार', voice: 'family', words: ['family', 'parivar', 'everyone', 'all of you'] },
  { id: 'student', en: 'Student', hi: 'विद्यार्थी', voice: 'younger', words: ['student', 'students'] },
];

export const relationById = (id) => RELATIONS.find((r) => r.id === id) || null;
