// Pick the voice, the way Claude lets you. It lists the device's installed
// system voices (including any premium neural voices the person has downloaded),
// tapping one selects it and speaks a short sample so you hear it before you
// keep it. Reached from Settings and from the voice-mode overlay's voice name.
import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { Speaker, listVoices, voiceLabel, type Voice } from '../lib/voice/tts.js';

export function VoicePicker({
  open,
  onClose,
  selectedId,
  onSelect,
  rate,
}: {
  open: boolean;
  onClose: () => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  /** Normalized 0..1, so the preview matches the chosen speed. */
  rate?: number;
}) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const speaker = useRef<Speaker | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void listVoices().then((v) => {
      if (live) setVoices(v);
    });
    speaker.current = new Speaker();
    return () => {
      live = false;
      speaker.current?.dispose();
      speaker.current = null;
    };
  }, [open]);

  const preview = (voice: Voice) => {
    // No tick here: the row is a button, and App.tsx ticks every button on the
    // capture phase (UI-7), so a second tick would read as a stutter.
    onSelect(voice.id);
    speaker.current?.stop();
    void speaker.current?.speak(`Hi, I am ${voice.name}. This is how I sound.`, {
      voiceId: voice.id,
      rate,
    });
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHead title="Voice" onClose={onClose} />
      <p className="sheet-sub">
        The voices installed on this device. Add more in the system settings; premium voices
        download once, then work offline.
      </p>
      <div className="voice-list">
        {voices === null ? (
          <p className="hint">Loading voices...</p>
        ) : voices.length === 0 ? (
          <p className="hint">No voices are installed on this device.</p>
        ) : (
          voices.map((voice) => {
            const active = voice.id === selectedId;
            return (
              <button
                key={voice.id}
                type="button"
                className={`voice-row press-fb${active ? ' active' : ''}`}
                aria-pressed={active}
                onClick={() => preview(voice)}
              >
                <span className="voice-row-name">{voiceLabel(voice)}</span>
                <span className="voice-row-lang">{voice.lang}</span>
                {active ? (
                  <span className="voice-row-check" aria-hidden="true">
                    {'✓'}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </Sheet>
  );
}
