// The chat splash greeting. The landing line is a warm, time-and-day-aware
// English greeting, picked fresh each time you land on the empty state (a friend
// who knows what time it is). Tapping the line rotates on through a big pile of
// languages, in a freshly shuffled order each time so the sequence past the
// landing differs on every launch. All local: no network, no account, no device
// locale sniffing, just the device clock.

export interface Greeting {
  // The language's English name, for reference and tests. Not shown in the UI.
  lang: string;
  // BCP47 code, set on the element so a screen reader voices the native line in
  // the right accent and RTL scripts lay out correctly.
  code: string;
  // The greeting written in that language.
  native: string;
  // A natural English rendering, used as the accessible label so a screen
  // reader still announces the meaning behind a non-English line.
  english: string;
}

// A neutral English fallback. The real landing line is chosen by pickLanding
// from the time-of-day library below; this stands in only if a pool is ever
// empty, and gives tests a stable reference for the reserved 'en' code.
export const ENGLISH_GREETING: Greeting = {
  lang: 'English',
  code: 'en',
  native: 'Hi. What are we building today?',
  english: 'Hi. What are we building today?',
};

// Time-of-day buckets for the landing line. The hour ranges are half-open and
// wrap for late night (21:00 through 04:59). Kept as an ordered type so tests
// and the picker share one vocabulary.
export type TimeBucket =
  'earlyMorning' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'lateNight';

// The landing library, by time bucket. Warm maker's-delight, mostly soft
// questions, held at an even indoor volume so no random pick shouts over its
// neighbors. Final set from the Creative Studio + CMO voice pass. No em dashes,
// by policy and by design.
export const LANDING_LINES: Record<TimeBucket, readonly string[]> = {
  earlyMorning: [
    'Up before the sun?',
    'Early start today.',
    'Coffee’s brewing?',
    'First light, first commit.',
    'The world’s still asleep.',
    'Quiet hours, clear head.',
    'Fresh morning, fresh branch.',
    'A calm start today.',
  ],
  morning: [
    'Coffee and coding?',
    'Good morning. Where do we start?',
    'Morning. What’s first?',
    'A clean slate today.',
    'Ready when you are.',
    'What’s on the workbench?',
    'Let’s make something good.',
    'Morning. Pick a thread.',
    'What are we shipping today?',
  ],
  midday: [
    'Midday momentum.',
    'Halfway there, still flowing?',
    'What’s next on the list?',
    'Fueled up and ready?',
    'One more before lunch?',
    'Still in the zone?',
    'A good stretch ahead.',
  ],
  afternoon: [
    'Where were we?',
    'Afternoon stretch. What’s next?',
    'Second wind?',
    'Let’s close a few loops.',
    'What can we finish today?',
    'Chipping away today?',
    'A quiet afternoon build.',
    'Pick up the thread?',
  ],
  evening: [
    'Evening session?',
    'Winding down, or just starting?',
    'What are we building tonight?',
    'Off the clock, on a roll?',
    'Evening. Let’s tinker.',
    'A little something before bed?',
    'What’s on your mind tonight?',
  ],
  lateNight: [
    'Late night flow?',
    'The quiet hours are yours.',
    'Just you and the cursor.',
    'One more commit before bed?',
    'The world’s asleep. Let’s build.',
    'Deep in it tonight?',
    'Still up, still building?',
    'The house is quiet.',
  ],
};

// Day-flavor pools, mixed into the time bucket (see pickLanding). Weekend lines
// are time-agnostic; Monday and Friday carry the start/close of the week.
export const WEEKEND_LINES: readonly string[] = [
  'Weekend project?',
  'Saturday’s for side projects.',
  'Sunday tinkering?',
  'A slow weekend build?',
  'Weekend hours, the best kind.',
  'What are we making for fun?',
  'Time for the passion project?',
  'No rush today.',
];

export const MONDAY_LINES: readonly string[] = [
  'Fresh week. Fresh start.',
  'New week, clean branch.',
  'Monday. Let’s set the tone.',
  'The week’s first move?',
  'Ease into it. Where do we start?',
  'Monday. One thing at a time.',
];

export const FRIDAY_LINES: readonly string[] = [
  'Friday. Ship it?',
  'Land it before the weekend?',
  'Close the week out strong?',
  'One good push left?',
  'Friday flow.',
  'Almost the weekend. What’s left?',
];

// The languages the tap rotates through, after English. Warm and a touch
// cheeky, never over the top. Every line is a real greeting a speaker would
// recognize, and the English stays faithful to it.
export const GREETINGS: readonly Greeting[] = [
  {
    lang: 'Spanish',
    code: 'es',
    native: 'Hola. ¿Qué construimos hoy?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'French',
    code: 'fr',
    native: 'Bonjour. On construit quoi aujourd’hui ?',
    english: 'Hello. So what are we building today?',
  },
  {
    lang: 'German',
    code: 'de',
    native: 'Hallo. Was bauen wir heute?',
    english: 'Hello. What are we building today?',
  },
  {
    lang: 'Italian',
    code: 'it',
    native: 'Ciao. Cosa costruiamo oggi?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Portuguese',
    code: 'pt',
    native: 'Olá. O que vamos criar hoje?',
    english: 'Hi. What are we going to make today?',
  },
  {
    lang: 'Dutch',
    code: 'nl',
    native: 'Hoi. Wat gaan we vandaag bouwen?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Swedish',
    code: 'sv',
    native: 'Hej. Vad bygger vi idag?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Danish',
    code: 'da',
    native: 'Hej. Hvad bygger vi i dag?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Norwegian',
    code: 'no',
    native: 'Hei. Hva bygger vi i dag?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Finnish',
    code: 'fi',
    native: 'Moi. Mitä rakennetaan tänään?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Icelandic',
    code: 'is',
    native: 'Halló. Hvað smíðum við í dag?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Polish',
    code: 'pl',
    native: 'Cześć. Co dziś budujemy?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Czech',
    code: 'cs',
    native: 'Ahoj. Co dnes postavíme?',
    english: 'Hi. What shall we build today?',
  },
  {
    lang: 'Slovak',
    code: 'sk',
    native: 'Ahoj. Čo dnes postavíme?',
    english: 'Hi. What shall we build today?',
  },
  {
    lang: 'Slovenian',
    code: 'sl',
    native: 'Živjo. Kaj danes gradimo?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Croatian',
    code: 'hr',
    native: 'Bok. Što danas gradimo?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Serbian',
    code: 'sr',
    native: 'Здраво. Шта данас правимо?',
    english: 'Hi. What are we making today?',
  },
  {
    lang: 'Bulgarian',
    code: 'bg',
    native: 'Здравей. Какво строим днес?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Russian',
    code: 'ru',
    native: 'Привет. Что строим сегодня?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Ukrainian',
    code: 'uk',
    native: 'Привіт. Що будуємо сьогодні?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Romanian',
    code: 'ro',
    native: 'Salut. Ce construim azi?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Hungarian',
    code: 'hu',
    native: 'Szia. Mit építünk ma?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Lithuanian',
    code: 'lt',
    native: 'Sveiki. Ką šiandien kuriame?',
    english: 'Hi. What are we creating today?',
  },
  {
    lang: 'Latvian',
    code: 'lv',
    native: 'Sveiki. Ko šodien būvējam?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Estonian',
    code: 'et',
    native: 'Tere. Mida me täna ehitame?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Greek',
    code: 'el',
    native: 'Γεια. Τι φτιάχνουμε σήμερα;',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Turkish',
    code: 'tr',
    native: 'Selam. Bugün ne inşa ediyoruz?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Azerbaijani',
    code: 'az',
    native: 'Salam. Bu gün nə qururuq?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Georgian',
    code: 'ka',
    native: 'გამარჯობა. დღეს რას ვქმნით?',
    english: 'Hello. What are we creating today?',
  },
  {
    lang: 'Catalan',
    code: 'ca',
    native: 'Hola. Què construïm avui?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Galician',
    code: 'gl',
    native: 'Ola. Que construímos hoxe?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Basque',
    code: 'eu',
    native: 'Kaixo. Zer eraikiko dugu gaur?',
    english: 'Hi. What shall we build today?',
  },
  {
    lang: 'Welsh',
    code: 'cy',
    native: 'Helô. Beth ydyn ni’n ei adeiladu heddiw?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Irish',
    code: 'ga',
    native: 'Dia duit. Cad a thógfaimid inniu?',
    english: 'Hi. What shall we build today?',
  },
  {
    lang: 'Afrikaans',
    code: 'af',
    native: 'Hallo. Wat bou ons vandag?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Swahili',
    code: 'sw',
    native: 'Habari. Tujenge nini leo?',
    english: 'Hello. What shall we build today?',
  },
  {
    lang: 'Esperanto',
    code: 'eo',
    native: 'Saluton. Kion ni konstruas hodiaŭ?',
    english: 'Hello. What are we building today?',
  },
  {
    lang: 'Latin',
    code: 'la',
    native: 'Salve. Quid hodie aedificamus?',
    english: 'Hello. What are we building today?',
  },
  {
    lang: 'Arabic',
    code: 'ar',
    native: 'مرحبا. ماذا نبني اليوم؟',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Hebrew',
    code: 'he',
    native: 'שלום. מה בונים היום?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Persian',
    code: 'fa',
    native: 'سلام. امروز چه بسازیم؟',
    english: 'Hi. What shall we build today?',
  },
  {
    lang: 'Urdu',
    code: 'ur',
    native: 'سلام۔ آج کیا بنائیں؟',
    english: 'Hi. What shall we make today?',
  },
  {
    lang: 'Hindi',
    code: 'hi',
    native: 'नमस्ते। आज क्या बनाएँ?',
    english: 'Hello. What shall we build today?',
  },
  {
    lang: 'Bengali',
    code: 'bn',
    native: 'নমস্কার। আজ কী বানাবো?',
    english: 'Hello. What shall we make today?',
  },
  {
    lang: 'Nepali',
    code: 'ne',
    native: 'नमस्ते। आज के बनाउने?',
    english: 'Hello. What shall we make today?',
  },
  {
    lang: 'Thai',
    code: 'th',
    native: 'สวัสดี วันนี้เราจะสร้างอะไรดี?',
    english: 'Hello. What shall we build today?',
  },
  {
    lang: 'Vietnamese',
    code: 'vi',
    native: 'Chào. Hôm nay mình xây gì nhỉ?',
    english: 'Hi. So what are we building today?',
  },
  {
    lang: 'Indonesian',
    code: 'id',
    native: 'Halo. Kita bikin apa hari ini?',
    english: 'Hi. What are we making today?',
  },
  {
    lang: 'Malay',
    code: 'ms',
    native: 'Hai. Apa kita bina hari ini?',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Tagalog',
    code: 'tl',
    native: 'Kumusta. Ano ang gagawin natin ngayon?',
    english: 'Hi. What are we making today?',
  },
  {
    lang: 'Chinese',
    code: 'zh',
    native: '你好。今天做点什么？',
    english: 'Hello. What are we making today?',
  },
  {
    lang: 'Japanese',
    code: 'ja',
    native: 'こんにちは。今日は何を作ろうか？',
    english: 'Hello. What shall we build today?',
  },
  {
    lang: 'Korean',
    code: 'ko',
    native: '안녕하세요. 오늘은 뭐를 만들어 볼까요?',
    english: 'Hi. What shall we make today?',
  },
];

// A Fisher-Yates shuffle that leaves the input untouched. `rng` is injectable
// for tests; defaults to Math.random.
function shuffle(items: Greeting[], rng: () => number): Greeting[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Which time bucket an hour (0 to 23, local) belongs to. Half-open ranges;
// late night wraps midnight, covering 21:00 through 04:59.
export function bucketForHour(hour: number): TimeBucket {
  if (hour >= 5 && hour < 8) return 'earlyMorning';
  if (hour >= 8 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'lateNight';
}

// The day-flavor pool for a date, or null on a plain weekday (Tue to Thu). Sat
// and Sun get the weekend pool; Monday and Friday get their own. Friday is read
// as a weekday, so its flavor wins over the weekend even into Friday evening.
export function dayFlavorLines(date: Date): readonly string[] | null {
  const day = date.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return WEEKEND_LINES;
  if (day === 1) return MONDAY_LINES;
  if (day === 5) return FRIDAY_LINES;
  return null;
}

// Pick the landing line for a moment in time. The base pool is the time bucket;
// when the day carries a flavor (weekend, Monday, Friday), a gem from that pool
// lands about one time in three, so the day shows through without drowning out
// the hour. Returns a Greeting on the reserved 'en' code, with `english` equal
// to the line itself so a screen reader voices exactly what is shown. `rng` is
// injectable for tests; defaults to Math.random.
export function pickLanding(date: Date = new Date(), rng: () => number = Math.random): Greeting {
  const base = LANDING_LINES[bucketForHour(date.getHours())];
  const flavor = dayFlavorLines(date);
  const pool = flavor && rng() < 1 / 3 ? flavor : base;
  const text = pool[Math.floor(rng() * pool.length)] ?? ENGLISH_GREETING.native;
  return { lang: 'English', code: 'en', native: text, english: text };
}

// Build the tap-through rotation for one turn on the empty state: a fresh
// time-and-day-aware landing line first, then every language in a freshly
// shuffled order so the sequence past the first tap differs each launch. Tapping
// walks this list and wraps back to the same landing line at the end. `rng` and
// `now` are injectable for tests; they default to Math.random and the current
// moment.
export function buildRotation(rng: () => number = Math.random, now: Date = new Date()): Greeting[] {
  return [pickLanding(now, rng), ...shuffle([...GREETINGS], rng)];
}
