// The voice list (2026-10-01): the best-sounding English voices by
// name, Siri's first where the device offers them, split female and male, ten
// at most, and no novelty voices or other languages.
import { describe, expect, it } from 'vitest';
import type { TtsVoiceInfo } from '../src/lib/ttsPlugin.js';
import {
  VOICES_PER_GENDER,
  byGender,
  cleanName,
  curateVoices,
  isEnglish,
  premiumHint,
  resolveVoice,
  wantsPremiumHint,
} from '../src/lib/voice/voiceCatalog.js';

const v = (
  id: string,
  name: string,
  lang: string,
  quality: TtsVoiceInfo['quality'] = 'default',
  gender?: TtsVoiceInfo['gender'],
): TtsVoiceInfo => ({ id, name, lang, quality, gender });

// What a maintainer's iPhone listed: every language and the novelty set.
const PHONE: TtsVoiceInfo[] = [
  v('com.apple.speech.synthesis.voice.Albert', 'Albert', 'en-US', 'default', 'male'),
  v('com.apple.voice.compact.it-IT.Alice', 'Alice', 'it-IT', 'default', 'female'),
  v('com.apple.voice.compact.sv-SE.Alva', 'Alva', 'sv-SE', 'default', 'female'),
  v('com.apple.speech.synthesis.voice.BadNews', 'Bad News', 'en-US', 'default', 'male'),
  v('com.apple.speech.synthesis.voice.Bubbles', 'Bubbles', 'en-US', 'default', 'female'),
  v('com.apple.eloquence.en-US.Grandpa', 'Grandpa', 'en-US', 'default', 'male'),
  v('com.apple.voice.compact.en-US.Samantha', 'Samantha', 'en-US', 'default', 'female'),
  v('com.apple.voice.compact.en-GB.Daniel', 'Daniel', 'en-GB', 'default', 'male'),
  v('com.apple.voice.compact.en-AU.Karen', 'Karen', 'en-AU', 'default', 'female'),
  v('com.apple.voice.compact.en-IE.Moira', 'Moira', 'en-IE', 'default', 'female'),
  v('com.apple.voice.compact.en-IN.Rishi', 'Rishi', 'en-IN', 'default', 'male'),
];

describe('the voice list', () => {
  it('keeps only good English voices, split female and male, by name', () => {
    const { female, male } = byGender(curateVoices(PHONE));
    expect(female.map((x) => x.display)).toEqual(['Samantha', 'Karen', 'Moira']);
    expect(male.map((x) => x.display)).toEqual(['Daniel', 'Rishi']);
  });

  it("puts Siri's own voices first, by their names, then the premium ones", () => {
    const list = curateVoices([
      ...PHONE,
      v('com.apple.voice.premium.en-US.Ava', 'Ava', 'en-US', 'premium', 'female'),
      v('com.apple.ttsbundle.siri_Nicky_en-US_compact', 'Nicky', 'en-US', 'default', 'female'),
      v('com.apple.ttsbundle.siri_Aaron_en-US_premium', 'Siri Voice 2', 'en-US', 'premium', 'male'),
    ]);
    expect(list.slice(0, 2).map((x) => [x.display, x.siri])).toEqual([
      ['Nicky', true],
      ['Aaron', true],
    ]);
    expect(list[2]?.display).toBe('Ava');
  });

  it('never lists more than five of each, ten in all', () => {
    const many = ['Ava', 'Zoe', 'Noelle', 'Serena', 'Matilda', 'Joelle', 'Allison'].map((n) =>
      v(n, n, 'en-US', 'premium', 'female'),
    );
    const men = ['Evan', 'Nathan', 'Tom', 'Jamie', 'Daniel', 'Oliver', 'Arthur'].map((n) =>
      v(n, n, 'en-US', 'premium', 'male'),
    );
    const list = curateVoices([...many, ...men]);
    expect(list).toHaveLength(2 * VOICES_PER_GENDER);
    expect(byGender(list).female.map((x) => x.display)).toEqual([
      'Ava',
      'Zoe',
      'Noelle',
      'Serena',
      'Matilda',
    ]);
  });

  it('keeps the best copy of a name, once', () => {
    const list = curateVoices([
      v('c', 'Ava', 'en-US', 'default', 'female'),
      v('p', 'Ava', 'en-US', 'premium', 'female'),
    ]);
    expect(list.map((x) => x.id)).toEqual(['p']);
  });

  it('reads the name and tier a desktop writes, and knows its gender by name', () => {
    expect(cleanName('Ava (Premium)')).toEqual({ name: 'Ava', quality: 'premium' });
    expect(cleanName('Microsoft Zira - English (United States)')).toEqual({ name: 'Zira' });
    const list = curateVoices([v('Ava (Premium)', 'Ava (Premium)', 'en-US')]);
    expect(list[0]).toMatchObject({ display: 'Ava', quality: 'premium', gender: 'female' });
    expect(isEnglish('en_GB')).toBe(true);
    expect(isEnglish('fr-CA')).toBe(false);
  });

  it('replaces a voice chosen before the list was narrowed with the best one', () => {
    const list = curateVoices(PHONE);
    expect(resolveVoice(list, 'com.apple.voice.compact.it-IT.Alice')?.display).toBe('Samantha');
    expect(resolveVoice(list, 'com.apple.voice.compact.en-GB.Daniel')?.display).toBe('Daniel');
    expect(resolveVoice([], 'x')).toBeUndefined();
  });

  it('says where to get the premium voices only on an Apple device that has none', () => {
    const none = curateVoices(PHONE);
    const some = curateVoices([v('p', 'Ava', 'en-US', 'premium')]);
    expect(wantsPremiumHint(none, 'ios')).toBe(true);
    expect(wantsPremiumHint(some, 'ios')).toBe(false);
    expect(wantsPremiumHint(none, 'other')).toBe(false);
    expect(premiumHint('ios')).toMatch(/Settings, Accessibility, Spoken Content, Voices, English/);
    expect(premiumHint('mac')).toMatch(/Manage Voices/);
  });
});
