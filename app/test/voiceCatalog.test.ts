// The voice list (founder, 2026-10-01): English only, a short hand-picked set
// with accents and personas, the best quality first, and no novelty voices.
import { describe, expect, it } from 'vitest';
import type { TtsVoiceInfo } from '../src/lib/ttsPlugin.js';
import {
  VOICE_LIST_MAX,
  accentOf,
  cleanName,
  curateVoices,
  premiumHint,
  resolveVoice,
  wantsPremiumHint,
} from '../src/lib/voice/voiceCatalog.js';

const v = (
  id: string,
  name: string,
  lang: string,
  quality: TtsVoiceInfo['quality'] = 'default',
): TtsVoiceInfo => ({ id, name, lang, quality });

// What the founder's iPhone listed: every language and the novelty set.
const PHONE: TtsVoiceInfo[] = [
  v('com.apple.speech.synthesis.voice.Albert', 'Albert', 'en-US'),
  v('com.apple.voice.compact.it-IT.Alice', 'Alice', 'it-IT'),
  v('com.apple.voice.compact.sv-SE.Alva', 'Alva', 'sv-SE'),
  v('com.apple.speech.synthesis.voice.BadNews', 'Bad News', 'en-US'),
  v('com.apple.speech.synthesis.voice.Bahh', 'Bahh', 'en-US'),
  v('com.apple.speech.synthesis.voice.Bubbles', 'Bubbles', 'en-US'),
  v('com.apple.eloquence.en-US.Grandpa', 'Grandpa', 'en-US'),
  v('com.apple.voice.compact.en-US.Samantha', 'Samantha', 'en-US'),
  v('com.apple.voice.compact.en-GB.Daniel', 'Daniel', 'en-GB'),
  v('com.apple.voice.compact.en-AU.Karen', 'Karen', 'en-AU'),
  v('com.apple.voice.compact.en-IE.Moira', 'Moira', 'en-IE'),
  v('com.apple.voice.compact.en-IN.Rishi', 'Rishi', 'en-IN'),
  v('com.apple.voice.compact.en-ZA.Tessa', 'Tessa', 'en-ZA'),
  v('com.apple.voice.enhanced.en-GB.Fiona', 'Fiona', 'en-GB-u-sd-gbsct', 'enhanced'),
];

describe('the voice list', () => {
  it('keeps only good English voices, each with its accent and a persona', () => {
    const list = curateVoices(PHONE);
    expect(list.map((x) => x.display)).toEqual([
      'Fiona',
      'Samantha',
      'Daniel',
      'Moira',
      'Karen',
      'Rishi',
      'Tessa',
    ]);
    expect(list.map((x) => x.accent)).toEqual([
      'Scottish',
      'American',
      'British',
      'Irish',
      'Australian',
      'Indian',
      'South African',
    ]);
    expect(list.every((x) => x.persona.length > 0)).toBe(true);
  });

  it('puts the premium voices first and keeps the best copy of each', () => {
    const list = curateVoices([
      ...PHONE,
      v('com.apple.voice.compact.en-US.Ava', 'Ava', 'en-US'),
      v('com.apple.voice.premium.en-US.Ava', 'Ava', 'en-US', 'premium'),
      v('com.apple.voice.premium.en-US.Zoe', 'Zoe', 'en-US', 'premium'),
    ]);
    expect(list.slice(0, 2).map((x) => x.id)).toEqual([
      'com.apple.voice.premium.en-US.Ava',
      'com.apple.voice.premium.en-US.Zoe',
    ]);
    expect(list.filter((x) => x.display === 'Ava')).toHaveLength(1);
  });

  it('reads the tier and the name a desktop writes into a voice name', () => {
    expect(cleanName('Ava (Premium)')).toEqual({ name: 'Ava', quality: 'premium' });
    expect(cleanName('Microsoft Zira - English (United States)')).toEqual({ name: 'Zira' });
    const list = curateVoices([v('Ava (Premium)', 'Ava (Premium)', 'en-US')]);
    expect(list[0]).toMatchObject({ display: 'Ava', quality: 'premium' });
  });

  it('never lists more than the cap', () => {
    const many = [
      'Ava',
      'Zoe',
      'Evan',
      'Nathan',
      'Noelle',
      'Serena',
      'Jamie',
      'Matilda',
      'Joelle',
    ].flatMap((n) => [v(`${n}-us`, n, 'en-US'), v(`${n}-gb`, n, 'en-GB')]);
    expect(curateVoices(many)).toHaveLength(VOICE_LIST_MAX);
  });

  it('knows the accents and leaves other languages out', () => {
    expect(accentOf('en-US')).toBe('American');
    expect(accentOf('en_GB')).toBe('British');
    expect(accentOf('en-NZ')).toBe('New Zealand');
    expect(accentOf('fr-CA')).toBeUndefined();
  });

  it('replaces a voice chosen before the list was narrowed with the best one', () => {
    const list = curateVoices(PHONE);
    expect(resolveVoice(list, 'com.apple.voice.compact.it-IT.Alice')?.display).toBe('Fiona');
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
