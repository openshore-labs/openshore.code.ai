// The voices OpenShore offers (founder, 2026-10-01): English only, a short
// hand-picked list, the best quality first. A device carries dozens of system
// voices, most of them other languages, novelty sounds (Bubbles, Bad News,
// Zarvox) or the old robotic set; the raw list read as low quality. Here each
// good English voice is named once, with its accent and a one-word persona,
// and anything not on the list stays out. Pure, so the rules are tested.
//
// The gold standard on Apple devices is the premium (neural) tier: free from
// Apple, downloaded once, then fully on-device. When none is installed the
// picker says how to get them (premiumHint), rather than pretending the
// compact voices are the best there is.
import type { TtsVoiceInfo } from '../ttsPlugin.js';

export type Accent =
  | 'American'
  | 'British'
  | 'Scottish'
  | 'Irish'
  | 'Australian'
  | 'New Zealand'
  | 'Indian'
  | 'South African';

/** The order accents are listed in, once quality has been ranked. */
export const ACCENTS: Accent[] = [
  'American',
  'British',
  'Scottish',
  'Irish',
  'Australian',
  'New Zealand',
  'Indian',
  'South African',
];

/** A voice on the list: the system voice plus what the picker says about it. */
export interface CuratedVoice extends TtsVoiceInfo {
  /** The voice's own name, cleaned of the system's tags ("Ava", not
   *  "Ava (Premium)" or "Microsoft Zira - English (United States)"). */
  display: string;
  accent: Accent;
  persona: string;
}

/**
 * The hand-picked voices, in the order they are offered at the same quality:
 * the voices that sound most natural first. Apple's names, then the Windows
 * desktop's own. A voice that is not here is not offered.
 */
const CATALOG: Array<[name: string, persona: string]> = [
  ['Ava', 'Warm and natural'],
  ['Zoe', 'Bright and friendly'],
  ['Evan', 'Calm and even'],
  ['Nathan', 'Relaxed'],
  ['Noelle', 'Soft-spoken'],
  ['Serena', 'Polished'],
  ['Jamie', 'Easygoing'],
  ['Matilda', 'Lively'],
  ['Joelle', 'Upbeat'],
  ['Tom', 'Steady narrator'],
  ['Allison', 'Clear and crisp'],
  ['Susan', 'Measured'],
  ['Samantha', 'The classic'],
  ['Daniel', 'Composed'],
  ['Kate', 'Crisp'],
  ['Stephanie', 'Poised'],
  ['Oliver', 'Friendly'],
  ['Arthur', 'Gentle'],
  ['Martha', 'Warm'],
  ['Fiona', 'Bright'],
  ['Moira', 'Gentle'],
  ['Karen', 'Friendly'],
  ['Lee', 'Laid-back'],
  ['Catherine', 'Clear'],
  ['Gordon', 'Grounded'],
  ['Rishi', 'Clear and warm'],
  ['Veena', 'Bright'],
  ['Isha', 'Friendly'],
  ['Sangeeta', 'Calm'],
  ['Tessa', 'Warm'],
  // The Windows desktop's built-in voices.
  ['Aria', 'Warm and natural'],
  ['Jenny', 'Friendly'],
  ['Guy', 'Relaxed'],
  ['Zira', 'Clear'],
  ['David', 'Steady'],
  ['Mark', 'Relaxed'],
  ['Hazel', 'Polished'],
  ['George', 'Composed'],
];
const RANK = new Map(CATALOG.map(([name], i) => [name.toLowerCase(), i]));
const PERSONA = new Map(CATALOG.map(([name, persona]) => [name.toLowerCase(), persona]));

/** The most voices the picker lists. Enough to choose a sound and an accent,
 *  few enough to read at a glance. */
export const VOICE_LIST_MAX = 12;

/** The voices to get when none of the premium tier is installed. */
export const PREMIUM_PICKS = ['Ava', 'Zoe', 'Evan'];

const QUALITY_RANK: Record<TtsVoiceInfo['quality'], number> = {
  premium: 2,
  enhanced: 1,
  default: 0,
};

/** The accent a language tag speaks, or undefined when it is not English. */
export function accentOf(lang: string): Accent | undefined {
  const tag = lang.toLowerCase().replace(/_/g, '-');
  if (!/^en(-|$)/.test(tag)) return undefined;
  if (tag.includes('scotland') || tag.includes('gbsct')) return 'Scottish';
  const region = tag.split('-')[1];
  switch (region) {
    case 'gb':
    case 'uk':
      return 'British';
    case 'ie':
      return 'Irish';
    case 'au':
      return 'Australian';
    case 'nz':
      return 'New Zealand';
    case 'in':
      return 'Indian';
    case 'za':
      return 'South African';
    default:
      return 'American';
  }
}

/** The voice's own name and any quality the system wrote into it. */
export function cleanName(raw: string): { name: string; quality?: TtsVoiceInfo['quality'] } {
  let name = raw.trim();
  let quality: TtsVoiceInfo['quality'] | undefined;
  const tagged = name.match(/\s*\((premium|enhanced)\)\s*$/i);
  if (tagged) {
    quality = tagged[1]!.toLowerCase() as TtsVoiceInfo['quality'];
    name = name.slice(0, tagged.index).trim();
  }
  // "Microsoft Zira - English (United States)", "Microsoft Aria Online (Natural)".
  name = name.replace(/^Microsoft\s+/i, '').replace(/\s+-\s+.*$/, '');
  name = name.replace(/\s+Online(\s*\(Natural\))?$/i, '').trim();
  return { name, quality };
}

/**
 * The list the picker shows: English voices on the catalog, one per name and
 * accent at the best quality installed, ranked premium first, then by the
 * catalog's order, capped at VOICE_LIST_MAX.
 */
export function curateVoices(voices: readonly TtsVoiceInfo[]): CuratedVoice[] {
  const best = new Map<string, CuratedVoice>();
  for (const v of voices) {
    const accent = accentOf(v.lang);
    if (!accent) continue;
    const { name, quality: tagged } = cleanName(v.name);
    const persona = PERSONA.get(name.toLowerCase());
    if (!persona) continue;
    const quality = tagged && QUALITY_RANK[tagged] > QUALITY_RANK[v.quality] ? tagged : v.quality;
    const voice: CuratedVoice = { ...v, quality, display: name, accent, persona };
    const key = `${name.toLowerCase()}|${accent}`;
    const held = best.get(key);
    if (!held || QUALITY_RANK[quality] > QUALITY_RANK[held.quality]) best.set(key, voice);
  }
  return [...best.values()]
    .sort(
      (a, b) =>
        QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality] ||
        RANK.get(a.display.toLowerCase())! - RANK.get(b.display.toLowerCase())! ||
        ACCENTS.indexOf(a.accent) - ACCENTS.indexOf(b.accent),
    )
    .slice(0, VOICE_LIST_MAX);
}

/** The voice to use: the chosen one while it is on the list, else the best
 *  on the list (a voice picked before the list was narrowed, Italian or a
 *  novelty, gives way to the best English voice). */
export function resolveVoice(
  curated: readonly CuratedVoice[],
  chosenId: string | undefined,
): CuratedVoice | undefined {
  return curated.find((v) => v.id === chosenId) ?? curated[0];
}

/** Whether the picker should say how to get the premium voices: on an Apple
 *  device with none of the premium tier installed. */
export function wantsPremiumHint(
  curated: readonly CuratedVoice[],
  where: 'ios' | 'mac' | 'other',
): boolean {
  return where !== 'other' && !curated.some((v) => v.quality === 'premium');
}

/** Where the premium voices are downloaded, in the device's own words. */
export function premiumHint(where: 'ios' | 'mac'): string {
  const path =
    where === 'ios'
      ? 'Settings, Accessibility, Spoken Content, Voices, English'
      : 'System Settings, Accessibility, Spoken Content, System voice, Manage Voices';
  return `For the most natural sound, download Apple's premium voices: ${PREMIUM_PICKS.join(', ')}. They are free, and work offline once downloaded. ${path}.`;
}
