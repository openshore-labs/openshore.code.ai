// The listening half of voice mode, the counterpart to Speaker. It wraps the
// same two backends dictation uses (the on-device OscodeSpeech plugin on iOS, the
// Web Speech API on desktop and web), but adds what a hands-free conversation
// needs and the composer mic does not: it finalizes an utterance on its own when
// you stop talking, so you never press a button to send. Finalization fires on
// whichever comes first, the backend's own final result or a short silence after
// the last partial, and then it keeps listening for the next utterance.
//
// Audio stays on the phone on iOS (the plugin forces on-device recognition), so
// voice mode listens offline and no audio ever leaves the device.
import type { PluginListenerHandle } from '@capacitor/core';
import { isPhone } from '../platform.js';
import { OscodeSpeech } from '../speechPlugin.js';

/** How long a pause counts as the end of a spoken turn. */
export const SILENCE_MS = 1200;

export interface ListenHandlers {
  /** A completed utterance, ready to act on. */
  onUtterance: (text: string) => void;
  /** The growing transcript, for a live caption. */
  onPartial?: (text: string) => void;
  onError?: (message: string) => void;
}

interface WebRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    ((e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type WebRecCtor = new () => WebRec;

function webCtor(): WebRecCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: WebRecCtor;
    webkitSpeechRecognition?: WebRecCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export async function sttAvailable(): Promise<boolean> {
  if (isPhone()) {
    try {
      return (await OscodeSpeech.available()).available;
    } catch {
      return false;
    }
  }
  return Boolean(webCtor());
}

export class Listener {
  private native = isPhone();
  private handlers: ListenHandlers | null = null;
  private handles: PluginListenerHandle[] = [];
  private web: WebRec | null = null;
  private current = '';
  private silence: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  /** Begin (or resume) listening. Utterances arrive via handlers.onUtterance. */
  async listen(handlers: ListenHandlers): Promise<void> {
    this.handlers = handlers;
    this.stopped = false;
    this.current = '';
    if (this.native) return this.startNative();
    this.startWeb();
  }

  private armSilence(): void {
    if (this.silence) clearTimeout(this.silence);
    this.silence = setTimeout(() => this.finalize(), SILENCE_MS);
  }

  private finalize(): void {
    if (this.silence) {
      clearTimeout(this.silence);
      this.silence = null;
    }
    const text = this.current.trim();
    this.current = '';
    if (!text) return; // silence with nothing said: keep the mic open
    this.handlers?.onUtterance(text);
    // A fresh session for the next utterance, so its transcript starts clean.
    if (!this.stopped) void this.restart();
  }

  private async restart(): Promise<void> {
    if (this.native) {
      await OscodeSpeech.stop().catch(() => {});
      if (!this.stopped) await this.startNative();
      return;
    }
    // The web recognizer's onend restarts it; stopping triggers that path.
    this.web?.stop();
  }

  private async startNative(): Promise<void> {
    const perm = await OscodeSpeech.requestPermission().catch(() => ({ granted: false }));
    if (!perm.granted) {
      this.handlers?.onError?.('microphone');
      return;
    }
    for (const h of this.handles) void h.remove();
    this.handles = [];
    this.handles.push(
      await OscodeSpeech.addListener('partial', (d) => {
        this.current = d.text;
        this.handlers?.onPartial?.(d.text);
        this.armSilence();
      }),
    );
    this.handles.push(
      await OscodeSpeech.addListener('result', (d) => {
        this.current = d.text;
        this.finalize();
      }),
    );
    this.handles.push(
      await OscodeSpeech.addListener('error', () => this.handlers?.onError?.('recognition')),
    );
    await OscodeSpeech.start().catch(() => this.handlers?.onError?.('start'));
  }

  private startWeb(): void {
    const Ctor = webCtor();
    if (!Ctor) {
      this.handlers?.onError?.('unsupported');
      return;
    }
    const rec = new Ctor();
    rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let text = '';
      let sawFinal = false;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i]![0].transcript;
        if (e.results[i]!.isFinal) sawFinal = true;
      }
      this.current = text;
      this.handlers?.onPartial?.(text);
      if (sawFinal) this.finalize();
      else this.armSilence();
    };
    rec.onerror = () => {
      /* onend follows and handles the restart */
    };
    rec.onend = () => {
      this.web = null;
      if (!this.stopped) this.startWeb();
    };
    this.web = rec;
    rec.start();
  }

  /** Finalize whatever has been said so far, right now (a tap on the orb to send
   *  without waiting out the silence). A no-op if nothing has been said yet. */
  flush(): void {
    if (!this.stopped) this.finalize();
  }

  /** Stop listening now, with no finalize (the caller is taking over, e.g. to
   *  speak). Safe to call repeatedly. */
  stop(): void {
    this.stopped = true;
    if (this.silence) {
      clearTimeout(this.silence);
      this.silence = null;
    }
    this.current = '';
    if (this.native) {
      for (const h of this.handles) void h.remove();
      this.handles = [];
      void OscodeSpeech.stop().catch(() => {});
    } else {
      const rec = this.web;
      this.web = null;
      rec?.abort();
    }
  }

  dispose(): void {
    this.stop();
    this.handlers = null;
  }
}
