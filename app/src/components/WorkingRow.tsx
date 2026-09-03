// The "agent is working" row: the OpenShore mark rolling as surf, a word for
// what is happening, and, once a couple of seconds have passed, how long it
// has been at it. This is what fills the seconds (ten to forty on a cold local
// model) before the first token, so the screen never reads as dead. While the
// note is plain "Thinking" the word turns over slowly through the house
// lexicon (lib/thinkingWords.ts); any other note (a tool summary, "Writing",
// "Waiting for your approval") shows verbatim and holds. Sits at the tail of
// the transcript while the thread is busy and nothing is streaming, and eases
// out over the arriving reply when the first token lands (`closing`).
import { useEffect, useRef, useState } from 'react';
import { FIRST_WORD, WORD_SWAP_MS, nextThinkingWord } from '../lib/thinkingWords.js';
import { WaveMark } from './WaveMark.js';

/** Show the counter only after this long; a fast answer never needs one. */
const COUNTER_AFTER_MS = 2000;

/** How long the outgoing word stays for its fall (--dur-6, plus a hair). */
const WORD_EXIT_MS = 480;

export function WorkingRow({
  since,
  note,
  closing = false,
}: {
  since?: number;
  note?: string;
  /** The exit is playing: the reply has started and the row eases out. */
  closing?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const started = useRef(since ?? Date.now());
  if (since) started.current = since;
  const elapsed = now - started.current;
  const seconds = Math.floor(elapsed / 1000);

  const label = note ?? FIRST_WORD;
  const rotating = label === FIRST_WORD;

  // The word on screen, the one leaving (held for its fall), and a key so a
  // swap remounts the incoming span and replays its rise.
  const [word, setWord] = useState<{ current: string; prev?: string; key: number }>({
    current: FIRST_WORD,
    key: 0,
  });
  useEffect(() => {
    if (!rotating || closing) return;
    const shown: string[] = [FIRST_WORD];
    const t = setInterval(() => {
      const next = nextThinkingWord(Date.now() - started.current, shown);
      shown.push(next);
      setWord((w) => ({ current: next, prev: w.current, key: w.key + 1 }));
    }, WORD_SWAP_MS);
    return () => clearInterval(t);
  }, [rotating, closing]);
  useEffect(() => {
    if (!word.prev) return;
    const t = setTimeout(() => setWord((w) => ({ ...w, prev: undefined })), WORD_EXIT_MS);
    return () => clearTimeout(t);
  }, [word.key, word.prev]);

  return (
    <div className={`working-row${closing ? ' closing' : ''}`} role="status" aria-live="polite">
      <WaveMark />
      <span className="working-note">
        {rotating ? (
          <>
            <span className="working-word" aria-hidden="true">
              {word.prev ? (
                <span key={`out${word.key}`} className="working-word-out">
                  {word.prev}
                </span>
              ) : null}
              <span key={word.key} className={word.key > 0 ? 'working-word-in' : undefined}>
                {word.current}
              </span>
            </span>
            <span className="visually-hidden">{FIRST_WORD}</span>
          </>
        ) : (
          label
        )}
      </span>
      {elapsed > COUNTER_AFTER_MS ? (
        <span className="working-elapsed">
          {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}
        </span>
      ) : null}
    </div>
  );
}
