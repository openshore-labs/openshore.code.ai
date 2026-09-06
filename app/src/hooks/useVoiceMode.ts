// The turn loop for voice mode: listen, send, speak the reply, and break at the
// right moments. It listens for a spoken utterance, sends it down the normal
// chat path (so the whole conversation still lives in the transcript as text),
// watches the reply stream into the thread and speaks it sentence by sentence,
// and at each pause consults the decision-break policy: a clarifying question or
// a plan is read out and answered by voice; authorizing your machine, spending,
// or picking from a list closes voice and hands you back to the screen, then
// voice reopens once you have tapped.
//
// The decision logic is the pure, tested code in lib/voice/*. This hook is the
// wiring: STT in, TTS out, and a small state machine over the live ThreadState.
// The turn timing is only fully provable on a device, like dictation itself.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.js';
import type { ThreadState } from '../state/types.js';
import { Speaker } from '../lib/voice/tts.js';
import { Listener } from '../lib/voice/stt.js';
import { nextSentenceEnd, toSpeakable } from '../lib/voice/spoken.js';
import {
  detectVoiceBreak,
  matchOption,
  planIntent,
  type VoiceBreak,
} from '../lib/voice/voiceBreaks.js';

export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'suspended';

export interface VoiceModeState {
  phase: VoicePhase;
  /** The live transcript while listening, or the line being spoken. */
  caption: string;
  error?: string;
}

export interface VoiceModeOptions {
  active: boolean;
  conversationId: string | undefined;
  send: (text: string) => void;
  approvePlan: () => void;
  revisePlan: () => void;
  /** Close voice and show the chat for an on-screen decision. */
  onBreakToScreen: (brk: VoiceBreak) => void;
  voiceId?: string;
  /** Normalized 0..1 speaking speed. */
  rate?: number;
  /** Speak replies aloud (off = listen and send only, replies stay on screen). */
  speakReplies: boolean;
}

export interface UseVoiceMode {
  state: VoiceModeState;
  /** Tap the orb: interrupt the reply and listen, or send what has been said. */
  interrupt: () => void;
}

function breakId(brk: VoiceBreak): string {
  return `${brk.kind}:${brk.say}`;
}

function trailingAssistant(thread: ThreadState): { id: string; text: string } | null {
  const last = thread.items[thread.items.length - 1];
  return last && last.kind === 'assistant' ? { id: last.id, text: last.text } : null;
}

// A compact signature so the store subscription only wakes the loop when
// something the loop cares about actually changed.
function threadSignature(thread: ThreadState | undefined): string {
  if (!thread) return '';
  const last = thread.items[thread.items.length - 1];
  const tail = last
    ? `${last.kind}:${'status' in last ? last.status : ''}:${'text' in last ? last.text.length : 0}`
    : '';
  return `${thread.items.length}|${thread.busy ? 1 : 0}|${thread.pendingApprovals.length}|${tail}`;
}

class VoiceController {
  private speaker = new Speaker();
  private listener = new Listener();
  private phase: VoicePhase = 'idle';
  private speakingId: string | undefined;
  private spokenLen = 0;
  private handledBreakId: string | null = null;
  private awaitingBreak: VoiceBreak | null = null;
  private chain: Promise<void> = Promise.resolve();
  private resuming = false;
  private lastSig = '';
  private disposed = false;

  constructor(
    private opts: () => VoiceModeOptions,
    private setState: (s: VoiceModeState) => void,
  ) {}

  private show(phase: VoicePhase, caption = ''): void {
    this.phase = phase;
    if (!this.disposed) this.setState({ phase, caption });
  }

  start(): void {
    // Do not re-read a reply that was already on screen when voice opened: only
    // text that arrives after this point is spoken.
    const thread = this.getThread();
    const trailing = thread ? trailingAssistant(thread) : null;
    if (trailing) {
      this.speakingId = trailing.id;
      this.spokenLen = trailing.text.length;
    }
    this.startListening();
  }

  private getThread(): ThreadState | undefined {
    const id = this.opts().conversationId;
    return id ? useApp.getState().conversations[id]?.thread : undefined;
  }

  private startListening(): void {
    if (this.disposed) return;
    this.resuming = false;
    this.show('listening', '');
    void this.listener.listen({
      onUtterance: (text) => this.onUtterance(text),
      onPartial: (text) => {
        if (this.phase === 'listening') this.show('listening', text);
      },
      onError: (message) => {
        if (message === 'microphone' || message === 'unsupported') {
          this.setState({ phase: this.phase, caption: '', error: message });
        }
      },
    });
  }

  private onUtterance(text: string): void {
    if (this.disposed) return;
    // Answering a voice-answerable break (a clarify question or a plan)?
    const brk = this.awaitingBreak;
    if (brk) {
      this.awaitingBreak = null;
      this.answerBreak(brk, text);
      return;
    }
    // An ordinary turn: hand it to the chat and wait for the reply.
    this.listener.stop();
    this.show('thinking', text);
    this.opts().send(text);
  }

  private answerBreak(brk: VoiceBreak, text: string): void {
    this.listener.stop();
    if (brk.kind === 'plan') {
      const intent = planIntent(text);
      if (intent === 'approve') {
        this.show('thinking', text);
        this.opts().approvePlan();
        return;
      }
      if (intent === 'revise') {
        // "Change something" returns to the text composer (founder's call), so
        // this is a hand-back to the screen.
        this.opts().revisePlan();
        this.opts().onBreakToScreen(brk);
        return;
      }
      // Unclear: ask once more, then listen again for the same break.
      this.awaitingBreak = brk;
      this.speakThenListen('Say start building to go ahead, or change something to revise.');
      return;
    }
    // A clarify answer: match an offered option, else send the words verbatim.
    const matched = matchOption(text, brk.options);
    this.show('thinking', text);
    this.opts().send(matched ?? text);
  }

  /** Speak a line, then open the mic for a spoken answer to the current break. */
  private speakThenListen(line: string): void {
    this.show('speaking', line);
    this.chain = this.chain
      .then(() => (this.disposed ? undefined : this.speaker.speak(line, this.speakParams())))
      .then(() => {
        if (!this.disposed) this.startListening();
      });
  }

  private speakParams(): { voiceId?: string; rate?: number } {
    const o = this.opts();
    return { voiceId: o.voiceId, rate: o.rate };
  }

  private enqueueSpeak(chunk: string): void {
    if (!chunk) return;
    this.chain = this.chain.then(() => {
      if (this.disposed) return;
      this.show('speaking', chunk);
      return this.speaker.speak(chunk, this.speakParams());
    });
  }

  private afterSpeech(fn: () => void): void {
    this.chain = this.chain.then(() => {
      if (!this.disposed) fn();
    });
  }

  onStoreChange(): void {
    if (this.disposed) return;
    const thread = this.getThread();
    const sig = threadSignature(thread);
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    if (thread) this.tick(thread);
  }

  private tick(thread: ThreadState): void {
    const o = this.opts();
    const brk = detectVoiceBreak(thread);
    const id = brk ? breakId(brk) : null;

    // A screen break preempts: announce it, then hand back to the chat screen.
    if (brk && brk.where === 'screen' && this.handledBreakId !== id) {
      this.handledBreakId = id;
      this.listener.stop();
      this.speaker.stop();
      this.chain = Promise.resolve();
      this.show('suspended', brk.say);
      this.chain = this.chain
        .then(() => (this.disposed ? undefined : this.speaker.speak(brk.say, this.speakParams())))
        .then(() => {
          if (!this.disposed) o.onBreakToScreen(brk);
        });
      return;
    }

    // Speak the reply as it streams, sentence by sentence.
    const trailing = trailingAssistant(thread);
    if (o.speakReplies && trailing) {
      if (trailing.id !== this.speakingId) {
        this.speakingId = trailing.id;
        this.spokenLen = 0;
      }
      this.speakUpTo(trailing.text);
    }

    // A voice-answerable break (plan or clarify) once the turn is idle: read it
    // out after the reply finishes, then listen for the spoken answer.
    if (brk && brk.where === 'voice' && !thread.busy && this.handledBreakId !== id) {
      this.handledBreakId = id;
      if (o.speakReplies && trailing) this.flushSpeak(trailing.text);
      this.afterSpeech(() => {
        this.awaitingBreak = brk;
        this.speakThenListen(brk.say);
      });
      return;
    }

    // Turn finished with nothing pending: flush the tail and listen again.
    if (!thread.busy && !brk && this.phase !== 'listening' && !this.resuming) {
      if (o.speakReplies && trailing) this.flushSpeak(trailing.text);
      this.resuming = true;
      this.afterSpeech(() => this.startListening());
    }
  }

  private speakUpTo(text: string): void {
    let end: number;
    while ((end = nextSentenceEnd(text, this.spokenLen)) !== -1) {
      this.enqueueSpeak(toSpeakable(text.slice(this.spokenLen, end)));
      this.spokenLen = end;
    }
  }

  private flushSpeak(text: string): void {
    if (this.spokenLen < text.length) {
      this.enqueueSpeak(toSpeakable(text.slice(this.spokenLen)));
      this.spokenLen = text.length;
    }
  }

  interrupt(): void {
    if (this.disposed) return;
    if (this.phase === 'speaking') {
      this.speaker.stop();
      this.chain = Promise.resolve();
      this.startListening();
      return;
    }
    if (this.phase === 'listening') {
      this.listener.flush();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.listener.dispose();
    this.speaker.dispose();
  }
}

export function useVoiceMode(options: VoiceModeOptions): UseVoiceMode {
  const [state, setState] = useState<VoiceModeState>({ phase: 'idle', caption: '' });
  // Latest options in a ref, so the controller reads fresh callbacks/settings
  // without tearing down and rebuilding on every render.
  const optsRef = useRef(options);
  optsRef.current = options;
  const ctrlRef = useRef<VoiceController | null>(null);

  const { active, conversationId } = options;
  useEffect(() => {
    if (!active || !conversationId) return;
    const ctrl = new VoiceController(() => optsRef.current, setState);
    ctrlRef.current = ctrl;
    const unsub = useApp.subscribe(() => ctrl.onStoreChange());
    ctrl.start();
    return () => {
      unsub();
      ctrl.dispose();
      ctrlRef.current = null;
      setState({ phase: 'idle', caption: '' });
    };
  }, [active, conversationId]);

  return {
    state,
    interrupt: () => ctrlRef.current?.interrupt(),
  };
}
