// Text-to-speech with two backends behind one interface, the same shape as
// dictation's two-backend split:
//   - iOS (the packaged app): the native OscodeTts plugin, AVSpeechSynthesizer,
//     synthesized on the phone so a reply is spoken offline and no audio leaves
//     the device.
//   - desktop / web: the Web Speech API (speechSynthesis), where the platform
//     provides it.
// Voices in both cases are the system voices the person has installed, so the
// picker is real, and premium (neural) voices show up once downloaded.
//
// The Speaker resolves each speak() when that utterance finishes, so the turn
// loop can await sentence by sentence, and stop() is an immediate barge-in.
import { isPhone } from '../platform.js';
import { OscodeTts, type TtsVoiceInfo } from '../ttsPlugin.js';
import type { PluginListenerHandle } from '@capacitor/core';

export type Voice = TtsVoiceInfo;

/** Is spoken output usable here at all? Native probes the plugin; the web path
 *  checks for the Speech Synthesis API. Where neither exists, voice mode still
 *  works as listen-and-read but says replies stay on screen. */
export async function ttsAvailable(): Promise<boolean> {
  if (isPhone()) {
    try {
      return (await OscodeTts.available()).available;
    } catch {
      return false;
    }
  }
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** The installed voices, best quality first. Web voices arrive asynchronously on
 *  first call (the browser populates them lazily), so wait a beat for them. */
export async function listVoices(): Promise<Voice[]> {
  if (isPhone()) {
    try {
      return (await OscodeTts.voices()).voices;
    } catch {
      return [];
    }
  }
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const read = (): Voice[] =>
    window.speechSynthesis.getVoices().map((v) => ({
      id: v.voiceURI,
      name: v.name,
      lang: v.lang,
      // The Web Speech API does not expose Apple's quality tier; treat local
      // voices as default and remote ones as, at best, enhanced.
      quality: v.localService ? 'default' : 'enhanced',
    }));
  const now = read();
  if (now.length) return now;
  return new Promise<Voice[]>((resolve) => {
    const done = () => resolve(read());
    window.speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    // Some browsers never fire the event if voices are already loaded; do not
    // hang the picker on it.
    setTimeout(done, 400);
  });
}

/** A readable one-line label for a voice, with a quality tag when it earns one. */
export function voiceLabel(voice: Voice): string {
  const tag =
    voice.quality === 'premium' ? ' (Premium)' : voice.quality === 'enhanced' ? ' (Enhanced)' : '';
  return `${voice.name}${tag}`;
}

/** A sensible default voice when the person has not chosen one: the best-quality
 *  voice matching the app's language, else the best-quality voice at all. */
export function pickDefaultVoice(voices: Voice[], lang: string): Voice | undefined {
  if (!voices.length) return undefined;
  const base = (lang || 'en').slice(0, 2).toLowerCase();
  const matching = voices.filter((v) => v.lang.slice(0, 2).toLowerCase() === base);
  return (matching.length ? matching : voices)[0];
}

/** Map the normalized 0..1 rate (0.5 is natural) onto the Web Speech range,
 *  where 1 is natural. Native does its own mapping in Swift from the same 0..1. */
export function mapWebRate(normalized: number | undefined): number {
  const n = Math.max(0, Math.min(1, normalized ?? 0.5));
  return n <= 0.5 ? 0.5 + n : 1 + (n - 0.5) * 2;
}

export interface SpeakParams {
  voiceId?: string;
  /** Normalized 0..1, 0.5 natural. */
  rate?: number;
}

/** Speaks utterances one at a time and lets the caller barge in. One instance
 *  per voice session; dispose() removes native listeners. */
export class Speaker {
  private native = isPhone();
  private seq = 0;
  private pending = new Map<string, () => void>();
  private handles: PluginListenerHandle[] = [];
  private ready: Promise<void> | undefined;

  private ensureNativeListeners(): Promise<void> {
    if (!this.native) return Promise.resolve();
    if (!this.ready) {
      this.ready = (async () => {
        const settle = (id: string) => {
          const resolve = this.pending.get(id);
          if (resolve) {
            this.pending.delete(id);
            resolve();
          }
        };
        this.handles.push(await OscodeTts.addListener('done', (d) => settle(d.utteranceId)));
        this.handles.push(await OscodeTts.addListener('error', (d) => settle(d.utteranceId)));
      })();
    }
    return this.ready;
  }

  /** Speak one chunk; resolves when it finishes or is stopped. Never rejects, so
   *  a turn loop can await it in sequence without a try around every line. */
  async speak(text: string, params: SpeakParams = {}): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.native) {
      await this.ensureNativeListeners();
      const id = `u${++this.seq}`;
      return new Promise<void>((resolve) => {
        this.pending.set(id, resolve);
        void OscodeTts.speak({
          text: trimmed,
          utteranceId: id,
          voiceId: params.voiceId,
          rate: params.rate,
        }).catch(() => {
          if (this.pending.delete(id)) resolve();
        });
      });
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(trimmed);
      u.rate = mapWebRate(params.rate);
      if (params.voiceId) {
        const voice = window.speechSynthesis.getVoices().find((v) => v.voiceURI === params.voiceId);
        if (voice) u.voice = voice;
      }
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      u.onend = settle;
      u.onerror = settle;
      window.speechSynthesis.speak(u);
    });
  }

  /** Cut off whatever is speaking, now, and resolve every awaiting speak(). */
  stop(): void {
    if (this.native) {
      void OscodeTts.stop().catch(() => {});
    } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    // Resolve any promises whose done event may not arrive after a cancel, so
    // the turn loop never wedges waiting on an utterance that was killed.
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const resolve of waiting) resolve();
  }

  dispose(): void {
    this.stop();
    for (const h of this.handles) void h.remove();
    this.handles = [];
    this.ready = undefined;
  }
}
