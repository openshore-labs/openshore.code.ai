// The chat splash greeting. A rotating, lightly playful welcome in a different
// language each time the empty state appears, with its English translation kept
// alongside. Tapping the line swaps it to English and back, an unlabeled Easter
// egg. All local: no network, no account, no device locale sniffing.

export interface Greeting {
  // The language's English name, for reference and tests. Not shown in the UI.
  lang: string;
  // BCP47 code, set on the element so a screen reader voices the native line in
  // the right accent and RTL scripts lay out correctly.
  code: string;
  // The greeting written in that language.
  native: string;
  // A natural English rendering, revealed on tap.
  english: string;
}

// Warm and a touch cheeky, never over the top. Every line is a real greeting a
// speaker would recognize, and the English stays faithful to it.
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
  {
    lang: 'Chinese',
    code: 'zh',
    native: '你好。今天做点什么？',
    english: 'Hello. What are we making today?',
  },
  {
    lang: 'Hindi',
    code: 'hi',
    native: 'नमस्ते। आज क्या बनाएँ?',
    english: 'Hello. What shall we build today?',
  },
  {
    lang: 'Arabic',
    code: 'ar',
    native: 'مرحبا. ماذا نبني اليوم؟',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Greek',
    code: 'el',
    native: 'Γεια. Τι φτιάχνουμε σήμερα;',
    english: 'Hi. What are we building today?',
  },
  {
    lang: 'Swahili',
    code: 'sw',
    native: 'Habari. Tujenge nini leo?',
    english: 'Hello. What shall we build today?',
  },
  {
    lang: 'Turkish',
    code: 'tr',
    native: 'Selam. Bugün ne inşa ediyoruz?',
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
    lang: 'Vietnamese',
    code: 'vi',
    native: 'Chào. Hôm nay mình xây gì nhỉ?',
    english: 'Hi. So what are we building today?',
  },
  {
    lang: 'Polish',
    code: 'pl',
    native: 'Cześć. Co dziś budujemy?',
    english: 'Hi. What are we building today?',
  },
];

// Pick a greeting at random, avoiding an immediate repeat so the rotation reads
// as a rotation. `rng` is injectable for tests; defaults to Math.random.
export function pickGreeting(exclude?: number, rng: () => number = Math.random): number {
  if (GREETINGS.length <= 1) return 0;
  let i = Math.floor(rng() * GREETINGS.length);
  if (i === exclude) i = (i + 1) % GREETINGS.length;
  return i;
}
