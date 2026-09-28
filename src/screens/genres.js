export const GENRES = [
  // match: tested against a book's genres/tags (Audible categories, Hardcover
  // tags, Audiobookshelf genres) to find it in the user's own libraries.
  { name: 'Mystery', match: /mystery|mysteries|detective|crime|thriller|suspense|noir|whodunit/i, ia: 'mystery OR detective', gb: 'detective', ol: 'mystery', hue: 265 },
  { name: 'Sci‑Fi', match: /science fiction|sci-?fi|space opera|cyberpunk|dystopia|time travel|aliens?/i, ia: 'science fiction', gb: 'science fiction', ol: 'science_fiction', hue: 195 },
  { name: 'Adventure', match: /adventure|action|exploration|survival/i, ia: 'adventure', gb: 'adventure', ol: 'adventure', hue: 28 },
  { name: 'Romance', match: /romance|romantic|love stor/i, ia: 'romance OR love', gb: 'love stories', ol: 'romance', hue: 340 },
  { name: 'Horror', match: /horror|ghost|supernatural|vampire|zombie|haunt/i, ia: 'horror OR ghost', gb: 'horror', ol: 'horror', hue: 0 },
  { name: 'Fantasy', match: /fantasy|magic|dragons?|fairy|myth|epic/i, ia: 'fantasy OR fairy', gb: 'fantasy', ol: 'fantasy', hue: 290 },
  { name: 'Philosophy', match: /philosoph|stoic|ethics|meaning of life/i, ia: 'philosophy', gb: 'philosophy', ol: 'philosophy', hue: 45 },
  { name: 'History', match: /history|historical|biograph|memoir|war/i, ia: 'history', gb: 'history', ol: 'history', hue: 20 },
  { name: 'Poetry', match: /poetry|poems?|verse/i, ia: 'poetry', gb: 'poetry', ol: 'poetry', hue: 310 },
  { name: 'Children', match: /children|kids|juvenile|young adult|teen|middle grade/i, ia: 'children', gb: 'children', ol: 'children', hue: 95 },
  { name: 'Humor', match: /humou?r|comed|funny|satire/i, ia: 'humor OR humour', gb: 'humor', ol: 'humor', hue: 55 },
  { name: 'Old‑Time Radio', match: /radio|drama|theat/i, ia: 'collection:oldtimeradio', gb: 'drama', ol: 'radio', hue: 170 },
];

export const GENRE_EXTRA = [
  { name: 'Self-help', match: /self-help|self help|personal development|productivity|psychology|motivation|success/i, ia: 'self help', gb: 'conduct of life', ol: 'self-help', hue: 160 },
  { name: 'Business', match: /business|finance|money|investing|economics|entrepreneur|management/i, ia: 'business', gb: 'economics', ol: 'business', hue: 200 },
];

GENRES.push(...GENRE_EXTRA);

// The user's own categories, shown first. `au` is the Audible bestseller search.
export const GENRE_MINE = [
  { name: 'Psychology & Human Behavior', au: 'psychology human behavior', match: /psycholog|behavio|cognitive|mind|emotion|social science|neuroscience/i, ia: 'psychology', gb: 'psychology', ol: 'psychology', hue: 280 },
  { name: 'Science & Biology', au: 'biology science', match: /science|biolog|evolution|genetic|nature|medicine|health|neuro/i, ia: 'science OR biology', gb: 'science', ol: 'biology', hue: 150 },
  { name: 'Cosmos & Physics', au: 'physics cosmology astronomy', match: /physics|cosmos|cosmolog|astronom|universe|quantum|space|relativity/i, ia: 'physics OR astronomy', gb: 'astronomy', ol: 'physics', hue: 230 },
  { name: 'Spirituality & Consciousness', au: 'spirituality consciousness', match: /spiritual|conscious|meditat|mindful|awaken|soul|mystic|zen|yoga/i, ia: 'spirituality OR meditation', gb: 'mysticism', ol: 'spirituality', hue: 300 },
  { name: 'Religion & Philosophy', au: 'religion philosophy', match: /religio|philosoph|theolog|bible|buddh|hindu|islam|christian|stoic|ethics/i, ia: 'religion OR philosophy', gb: 'philosophy', ol: 'religion', hue: 45 },
  { name: 'History & Civilization', au: 'history civilization', match: /histor|civili[sz]ation|ancient|empire|war|medieval|world history/i, ia: 'history', gb: 'history', ol: 'history', hue: 20 },
  { name: 'India', au: 'india', match: /india|indian|hindu|mughal|gandhi|bharat|delhi|mumbai|bengal|raj\b/i, ia: 'india', gb: 'india', ol: 'india', hue: 30 },
  { name: 'AI & Future', au: 'artificial intelligence future', match: /artificial intelligence|\bai\b|machine learning|robot|future|technolog|futur|digital/i, ia: 'artificial intelligence OR technology', gb: 'technology', ol: 'artificial_intelligence', hue: 190 },
  { name: 'Money, Economics & Capitalism', au: 'economics money capitalism', match: /money|econom|capitalis|financ|invest|wealth|market|business/i, ia: 'economics', gb: 'economics', ol: 'economics', hue: 140 },
  { name: 'Parenting & Education', au: 'parenting education', match: /parent|child development|education|teach|learning|school|family/i, ia: 'education OR parenting', gb: 'education', ol: 'parenting', hue: 95 },
  { name: 'Crime, Mystery & Human Darkness', au: 'true crime mystery', match: /crime|murder|mystery|thriller|detective|serial killer|dark|noir|psychopath/i, ia: 'crime OR mystery', gb: 'detective', ol: 'true_crime', hue: 350 },
  { name: 'Society & Human Civilization', au: 'society culture sociology', match: /societ|sociolog|culture|anthropolog|politic|inequality|civili[sz]ation/i, ia: 'sociology OR society', gb: 'sociology', ol: 'sociology', hue: 210 },
  { name: 'Big Ideas', au: 'big ideas popular science', match: /ideas|thinking|popular science|innovation|essays|nonfiction|non-fiction|big picture/i, ia: 'essays', gb: 'essays', ol: 'popular_science', hue: 260 },
];
GENRES.unshift(...GENRE_MINE);
