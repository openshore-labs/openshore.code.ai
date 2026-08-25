// Voice-to-text for the composer mic, with two backends behind one interface:
//  - iOS (the packaged app): the native OscodeSpeech plugin, on-device only, so
//    mic audio never leaves the phone.
//  - desktop / web: the Web Speech API, where the platform provides it.
// Either way, onText receives the growing transcript for the session and the
// caller appends it to the field. Where neither backend exists, `supported` is
// false and the mic button hides itself rather than pretending.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { isPhone } from '../lib/platform.js';
import { OscodeSpeech } from '../lib/speechPlugin.js';

// Minimal shapes for the vendor-prefixed Web Speech API; the DOM lib omits it.
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
  results: ArrayLike<{ 0: { transcript: string } }>;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function webCtor(): SpeechRecognitionCtor | undefined {
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

export function useDictation(onText: (text: string) => void): Dictation {
  const native = isPhone();
  const [supported, setSupported] = useState<boolean>(() => (native ? false : Boolean(webCtor())));
  const [listening, setListening] = useState(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const handlesRef = useRef<PluginListenerHandle[]>([]);
  const webRef = useRef<SpeechRecognitionLike | null>(null);

  // Native capability probe: on-device recognition may be absent on older
  // devices or the current language.
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    void OscodeSpeech.available()
      .then((r) => {
        if (!cancelled) setSupported(r.available);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [native]);

  const stopNative = useCallback(() => {
    for (const h of handlesRef.current) void h.remove();
    handlesRef.current = [];
    void OscodeSpeech.stop().catch(() => {});
    setListening(false);
  }, []);

  const startNative = useCallback(async () => {
    const perm = await OscodeSpeech.requestPermission().catch(() => ({ granted: false }));
    if (!perm.granted) return;
    const partial = await OscodeSpeech.addListener('partial', (d) => onTextRef.current(d.text));
    const result = await OscodeSpeech.addListener('result', (d) => {
      onTextRef.current(d.text);
      stopNative();
    });
    const error = await OscodeSpeech.addListener('error', () => stopNative());
    handlesRef.current = [partial, result, error];
    try {
      await OscodeSpeech.start();
      setListening(true);
    } catch {
      stopNative();
    }
  }, [stopNative]);

  const startWeb = useCallback(() => {
    const Ctor = webCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      onTextRef.current(text);
    };
    const finish = () => {
      webRef.current = null;
      setListening(false);
    };
    rec.onerror = finish;
    rec.onend = finish;
    webRef.current = rec;
    setListening(true);
    rec.start();
  }, []);

  const stop = useCallback(() => {
    if (native) stopNative();
    else webRef.current?.stop();
  }, [native, stopNative]);

  const toggle = useCallback(() => {
    if (!supported) return;
    if (native) {
      if (listening) stopNative();
      else void startNative();
      return;
    }
    if (webRef.current) webRef.current.stop();
    else startWeb();
  }, [supported, native, listening, stopNative, startNative, startWeb]);

  useEffect(
    () => () => {
      if (native) stopNative();
      else webRef.current?.abort();
    },
    [native, stopNative],
  );

  return { supported, listening, toggle, stop };
}
