// Pick the voice, the way Claude lets you. A short hand-picked list of English
// voices (lib/voice/voiceCatalog.ts), each named with its accent and a
// one-word persona, the most natural first; tapping one selects it and speaks
// a short sample so you hear it before you keep it. On an Apple device with
// none of the premium voices installed, a note says where to get them.
// Reached from Settings and from the voice-mode overlay's voice name.
import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { Speaker, listVoices } from '../lib/voice/tts.js';
import {
  curateVoices,
  premiumHint,
  resolveVoice,
  wantsPremiumHint,
  type CuratedVoice,
} from '../lib/voice/voiceCatalog.js';
import { platform } from '../lib/platform.js';

/** Where the premium voices come from on this device, if anywhere. */
export function voiceHome(): 'ios' | 'mac' | 'other' {
  if (platform() === 'ios') return 'ios';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Macintosh|Mac OS X/.test(ua) ? 'mac' : 'other';
}

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
  const [voices, setVoices] = useState<CuratedVoice[] | null>(null);
  const speaker = useRef<Speaker | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void listVoices().then((v) => {
      if (live) setVoices(curateVoices(v));
    });
    speaker.current = new Speaker();
    return () => {
      live = false;
      speaker.current?.dispose();
      speaker.current = null;
    };
  }, [open]);

  const preview = (voice: CuratedVoice) => {
    // No tick here: the row is a button, and App.tsx ticks every button on the
    // capture phase (UI-7), so a second tick would read as a stutter.
    onSelect(voice.id);
    speaker.current?.stop();
    void speaker.current?.speak(
      `Hi, I'm ${voice.display}. I'll read your replies just like this.`,
      {
        voiceId: voice.id,
        rate,
      },
    );
  };

  // The chosen voice as the list knows it: one picked before the list was
  // narrowed shows the voice actually in use.
  const current = voices ? resolveVoice(voices, selectedId)?.id : selectedId;
  const where = voiceHome();
  const hint =
    voices && where !== 'other' && wantsPremiumHint(voices, where) ? premiumHint(where) : null;

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHead title="Voice" onClose={onClose} />
      <p className="sheet-sub">
        English voices, picked for how natural they sound. Each one speaks on this device.
      </p>
      {hint ? <p className="voice-hint">{hint}</p> : null}
      <div className="voice-list">
        {voices === null ? (
          <p className="hint">Loading voices...</p>
        ) : voices.length === 0 ? (
          <p className="hint">No English voices are installed on this device.</p>
        ) : (
          voices.map((voice) => {
            const active = voice.id === current;
            return (
              <button
                key={voice.id}
                type="button"
                className={`voice-row press-fb${active ? ' active' : ''}`}
                aria-pressed={active}
                onClick={() => preview(voice)}
              >
                <span className="voice-row-text">
                  <span className="voice-row-name">
                    {voice.display}
                    {voice.quality === 'premium' ? (
                      <span className="voice-row-tier">Premium</span>
                    ) : null}
                  </span>
                  <span className="voice-row-persona">{voice.persona}</span>
                </span>
                <span className="voice-row-lang">{voice.accent}</span>
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
