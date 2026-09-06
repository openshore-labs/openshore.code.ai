// On-device text-to-speech plugin: AVSpeechSynthesizer on iOS, reached through a
// small Capacitor plugin (Swift side in app/plugins/oscode-tts). This file is the
// JS contract plus a web mock that reports "unavailable", so on desktop and web
// the voice layer falls through to the Web Speech API (speechSynthesis) instead
// (see lib/voice/tts.ts). Synthesis is on-device, so a reply can be spoken with
// no connection and no audio leaves the phone.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** One installed system voice. `quality` is Apple's tier: a downloaded premium
 *  (neural) voice sounds best, then enhanced, then the default compact voice. */
export interface TtsVoiceInfo {
  id: string;
  name: string;
  lang: string;
  quality: 'default' | 'enhanced' | 'premium';
}

export interface TtsStart {
  utteranceId: string;
}
export interface TtsDone {
  utteranceId: string;
  cancelled: boolean;
}
export interface TtsError {
  utteranceId: string;
  message: string;
}

export interface SpeakOptions {
  text: string;
  /** A caller-supplied id echoed back on the start/done events, so the turn loop
   *  can tell which utterance just finished. */
  utteranceId?: string;
  /** A voice id from `voices()`. Omitted uses the device's default voice. */
  voiceId?: string;
  /** Speaking speed, normalized 0..1 where 0.5 is the natural default, so one
   *  slider reads the same on iOS and on the web backend. */
  rate?: number;
  /** Pitch multiplier, 0.5..2, default 1. */
  pitch?: number;
}

export interface OscodeTtsContract {
  /** Is on-device speech synthesis usable here? (At least one voice installed.)
   *  Synthesis never leaves the phone, so where it is absent this is false and
   *  the voice layer uses the Web Speech API path. */
  available(): Promise<{ available: boolean }>;
  /** The system voices installed on this device, best quality first. */
  voices(): Promise<{ voices: TtsVoiceInfo[] }>;
  /** Speak the text. Resolves once queued; the spoken life is reported by the
   *  'start' and 'done' events. */
  speak(options: SpeakOptions): Promise<void>;
  /** Stop immediately (a barge-in cuts the reply off now, not at a word end). */
  stop(): Promise<void>;

  addListener(event: 'start', cb: (data: TtsStart) => void): Promise<PluginListenerHandle>;
  addListener(event: 'done', cb: (data: TtsDone) => void): Promise<PluginListenerHandle>;
  addListener(event: 'error', cb: (data: TtsError) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

class TtsWeb {
  async available() {
    return { available: false };
  }
  async voices() {
    return { voices: [] as TtsVoiceInfo[] };
  }
  async speak() {
    /* no-op: web uses the Web Speech API path in lib/voice/tts.ts */
  }
  async stop() {
    /* no-op */
  }
  async addListener() {
    return { remove: async () => {} };
  }
  async removeAllListeners() {
    /* no-op */
  }
}

export const OscodeTts = registerPlugin<OscodeTtsContract>('OscodeTts', {
  web: () => new TtsWeb() as unknown as OscodeTtsContract,
});
