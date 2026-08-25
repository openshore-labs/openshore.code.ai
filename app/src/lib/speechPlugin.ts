// On-device dictation plugin: SFSpeechRecognizer on iOS, reached through a small
// Capacitor plugin (Swift side in app/plugins/oscode-speech). This file is the
// JS contract plus a web mock that reports "unavailable", so on desktop and web
// the composer falls through to the Web Speech API instead (see useDictation).
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface SpeechResult {
  text: string;
}
export interface SpeechPartial {
  text: string;
  isFinal: boolean;
}
export interface SpeechError {
  message: string;
}

export interface OscodeSpeechContract {
  /** Is on-device recognition usable on this device and language right now?
   *  Audio never leaves the phone, so this is false where on-device is absent. */
  available(): Promise<{ available: boolean }>;
  /** Ask for speech AND microphone permission. `reason` names the denial. */
  requestPermission(): Promise<{ granted: boolean; reason?: string }>;
  /** Begin listening. Transcript arrives via the 'partial' event; the final
   *  text via 'result'. Failures and interruptions via 'error'. */
  start(): Promise<void>;
  stop(): Promise<void>;

  addListener(
    event: 'partial',
    cb: (data: SpeechPartial) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: 'result', cb: (data: SpeechResult) => void): Promise<PluginListenerHandle>;
  addListener(event: 'error', cb: (data: SpeechError) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

class SpeechWeb {
  async available() {
    return { available: false };
  }
  async requestPermission() {
    return { granted: false, reason: 'unsupported' };
  }
  async start() {
    /* no-op: web uses the Web Speech API path in useDictation */
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

export const OscodeSpeech = registerPlugin<OscodeSpeechContract>('OscodeSpeech', {
  web: () => new SpeechWeb() as unknown as OscodeSpeechContract,
});
