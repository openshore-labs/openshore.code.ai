// The voices OpenShore offers (2026-10-01): the best-sounding
// English voices only, by name, split into female and male, ten at most. A
// device carries dozens of system voices, most of them other languages,
// novelty sounds (Bubbles, Bad News, Zarvox) or the old robotic set; the raw
// list read as low quality. Pure, so the rules are tested.
//
// A maintainer asked for the Siri voices, since they sound the best. Apple
// keeps them for Siri and the system: a third-party app's speech synthesizer
// is not given them. Where a device does list one to the app it leads here,
// under its own name. Otherwise the best on offer are Apple's premium (neural)
// voices, free and fully on-device once downloaded, and when none is installed
// the picker says where to get them (premiumHint).
import type { TtsVoiceInfo } from '../ttsPlugin.js';

export type Gender = 'female' | 'male';

/** A voice on the list: the system voice plus what the picker shows. */
export interface CuratedVoice extends TtsVoiceInfo {
  /** The voice's own name, cleaned of the system's tags ("Ava", not
   *  "Ava (Premium)" or "Microsoft Zira - English (United States)"). */
  display: string;
  gender: Gender;
  /** One of Siri's own voices, where the device offers it to the app. */
  siri: boolean;
}

/**
 * The hand-picked voices and their gender, in the order they are offered at
 * the same quality: the most natural first. Apple's names (Siri's among them),
 * then the Windows desktop's own. A voice not here is offered only when it is
 * a Siri voice whose gender the system reports.
 */
const CATALOG: Array<[name: string, gender: Gender]> = [
  ['Ava', 'female'],
  ['Zoe', 'female'],
  ['Evan', 'male'],
  ['Nathan', 'male'],
  ['Noelle', 'female'],
  ['Tom', 'male'],
  ['Serena', 'female'],
  ['Jamie', 'male'],
  ['Matilda', 'female'],
  ['Joelle', 'female'],
  ['Nicky', 'female'],
  ['Aaron', 'male'],
  ['Allison', 'female'],
  ['Susan', 'female'],
  ['Samantha', 'female'],
  ['Daniel', 'male'],
  ['Kate', 'female'],
  ['Oliver', 'male'],
  ['Arthur', 'male'],
  ['Martha', 'female'],
  ['Stephanie', 'female'],
  ['Gordon', 'male'],
  ['Lee', 'male'],
  ['Catherine', 'female'],
  ['Karen', 'female'],
  ['Moira', 'female'],
  ['Fiona', 'female'],
  ['Rishi', 'male'],
  ['Tessa', 'female'],
  // The Windows desktop's built-in voices.
  ['Aria', 'female'],
  ['Jenny', 'female'],
  ['Guy', 'male'],
  ['Zira', 'female'],
  ['David', 'male'],
  ['Mark', 'male'],
  ['Hazel', 'female'],
  ['George', 'male'],
];
const RANK = new Map(CATALOG.map(([name], i) => [name.toLowerCase(), i]));
const GENDER = new Map(CATALOG.map(([name, gender]) => [name.toLowerCase(), gender]));

/** At most this many of each, so the list is ten voices at most. */
export const VOICES_PER_GENDER = 5;

/** The voices to get when no premium (or Siri) voice is installed. */
export const PREMIUM_PICKS = ['Ava', 'Zoe', 'Evan', 'Nathan'];

/** How good a voice sounds, best highest: Siri's own, then Apple's tiers. */
function tier(v: { quality: TtsVoiceInfo['quality']; siri: boolean }): number {
  if (v.siri) return 3;
  return v.quality === 'premium' ? 2 : v.quality === 'enhanced' ? 1 : 0;
}

/** Whether a language tag is English. */
export function isEnglish(lang: string): boolean {
  return /^en([-_]|$)/i.test(lang);
}

/** Whether the system marks this as one of Siri's voices. */
export function isSiriVoice(v: Pick<TtsVoiceInfo, 'id' | 'name'>): boolean {
  return /siri/i.test(v.id) || /siri/i.test(v.name);
}

/** The voice's own name and any quality the system wrote into it. A Siri
 *  voice's name is read from its id ("com.apple.ttsbundle.siri_Nicky_en-US"). */
export function cleanName(
  raw: string,
  id = '',
): { name: string; quality?: TtsVoiceInfo['quality'] } {
  const siri = id.match(/siri_([A-Za-z]+)_/);
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
  if (siri && (!name || /siri|voice\s*\d/i.test(name))) name = siri[1]!;
  return { name, quality };
}

/**
 * The list the picker shows: English voices, one per name at the best quality
 * installed, ranked Siri first, then premium, then by the catalog's order, at
 * most VOICES_PER_GENDER of each gender. Best first overall, so the first is
 * the default.
 */
export function curateVoices(voices: readonly TtsVoiceInfo[]): CuratedVoice[] {
  const best = new Map<string, CuratedVoice>();
  for (const v of voices) {
    if (!isEnglish(v.lang)) continue;
    const siri = isSiriVoice(v);
    const { name, quality: tagged } = cleanName(v.name, v.id);
    const known = GENDER.get(name.toLowerCase());
    const reported = v.gender === 'female' || v.gender === 'male' ? v.gender : undefined;
    // A voice on the catalog, or a Siri voice the system names a gender for.
    if (!known && !(siri && reported)) continue;
    const gender = reported ?? known!;
    const quality =
      tagged && tier({ quality: tagged, siri: false }) > tier({ quality: v.quality, siri: false })
        ? tagged
        : v.quality;
    const voice: CuratedVoice = { ...v, quality, display: name, gender, siri };
    const key = name.toLowerCase();
    const held = best.get(key);
    if (!held || tier(voice) > tier(held)) best.set(key, voice);
  }
  const ranked = [...best.values()].sort(
    (a, b) =>
      tier(b) - tier(a) ||
      (RANK.get(a.display.toLowerCase()) ?? CATALOG.length) -
        (RANK.get(b.display.toLowerCase()) ?? CATALOG.length) ||
      a.display.localeCompare(b.display),
  );
  const count: Record<Gender, number> = { female: 0, male: 0 };
  return ranked.filter((v) => ++count[v.gender] <= VOICES_PER_GENDER);
}

/** The list split for the picker, each in its ranked order. */
export function byGender(curated: readonly CuratedVoice[]): Record<Gender, CuratedVoice[]> {
  return {
    female: curated.filter((v) => v.gender === 'female'),
    male: curated.filter((v) => v.gender === 'male'),
  };
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
 *  device with neither a premium nor a Siri voice on the list. */
export function wantsPremiumHint(
  curated: readonly CuratedVoice[],
  where: 'ios' | 'mac' | 'other',
): boolean {
  return where !== 'other' && !curated.some((v) => tier(v) >= 2);
}

/** Where the premium voices are downloaded, in the device's own words. */
export function premiumHint(where: 'ios' | 'mac'): string {
  const path =
    where === 'ios'
      ? 'Settings, Accessibility, Spoken Content, Voices, English'
      : 'System Settings, Accessibility, Spoken Content, System voice, Manage Voices';
  return `For the most natural sound, download Apple's premium voices: ${PREMIUM_PICKS.join(', ')}. They are free, and work offline once downloaded. ${path}.`;
}
