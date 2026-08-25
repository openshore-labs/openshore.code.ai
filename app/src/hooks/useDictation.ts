// Voice-to-text for the composer mic. Uses the Web Speech API where the
// platform provides it: desktop browsers and the Electron shell do, and so
// does Safari on iOS. The iOS WKWebView (where the packaged app runs) does NOT
// expose SpeechRecognition, so `supported` comes back false there and the mic
// button hides itself rather than pretending. Real native iOS dictation needs a
// Capacitor speech plugin; that is a deliberate follow-up, tracked in PROGRESS,
// kept out of this change so it cannot destabilize the iOS archive.
import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal shapes for the vendor-prefixed API; the DOM lib does not type it.
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export interface Dictation {
  supported: boolean;
  listening: boolean;
  toggle: () => void;
  stop: () => void;
}

// onText receives the growing transcript for the current dictation session; the
// caller appends it to the field. onText fires with the full session text each
// time so the caller can replace the in-progress tail cleanly.
export function useDictation(onText: (text: string) => void): Dictation {
  const [supported] = useState(() => Boolean(getCtor()));
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (!supported) return;
    if (recRef.current) {
      recRef.current.stop();
      return;
    }
    const Ctor = getCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    let sessionText = '';
    rec.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      sessionText = text;
      onTextRef.current(sessionText);
    };
    const finish = () => {
      recRef.current = null;
      setListening(false);
    };
    rec.onerror = finish;
    rec.onend = finish;
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, [supported]);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, toggle, stop };
}
