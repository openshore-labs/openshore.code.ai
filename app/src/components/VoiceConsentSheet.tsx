// The ask-first card for voice on a computer or in a browser. The Web Speech
// API may send audio to its provider (Google in Chrome-based apps), so the
// first mic tap while "Send voice to the speech service" is off lands here
// instead of listening. Allow flips the setting on and starts listening in the
// same tap; Not now leaves it off, and the next tap asks again. The iPhone
// never sees it (speech is recognized on the device there). A presence-aware
// confirm card, so it animates out like every other sheet.
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../state/store.js';
import { platform } from '../lib/platform.js';
import {
  VOICE_CONSENT_PROMPT,
  VOICE_CONSENT_TITLE,
  voiceNeedsConsent,
} from '../lib/voiceConsent.js';
import { Sheet } from './Sheet.js';

export function VoiceConsentSheet({
  open,
  onAllow,
  onClose,
}: {
  open: boolean;
  onAllow: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} variant="confirm" label={VOICE_CONSENT_TITLE}>
      <h3>{VOICE_CONSENT_TITLE}</h3>
      <p>{VOICE_CONSENT_PROMPT}</p>
      <div className="confirm-row">
        <button type="button" className="btn ghost press-fb" onClick={onClose}>
          Not now
        </button>
        <button type="button" className="btn primary press-fb" onClick={onAllow}>
          Allow
        </button>
      </div>
    </Sheet>
  );
}

/** Gate a mic start behind the card. `gate(start)` runs `start` at once when
 *  no consent is needed (the iPhone, or the setting already on), otherwise it
 *  holds it until Allow. Render `sheet` once in the caller. */
export function useVoiceConsent(): { gate: (start: () => void) => void; sheet: ReactNode } {
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const [pending, setPending] = useState<(() => void) | null>(null);

  const gate = (start: () => void) => {
    if (voiceNeedsConsent(platform(), settings)) setPending(() => start);
    else start();
  };

  const card = (
    <VoiceConsentSheet
      open={pending !== null}
      onAllow={() => {
        const start = pending;
        setPending(null);
        void saveSettings({ voiceCloudConsent: true });
        // Start in the same tap, so Allow is the moment listening begins.
        start?.();
      }}
      onClose={() => setPending(null)}
    />
  );
  // Portaled to the body, so a caller inside a transformed surface (the
  // composer) still gets a card centered on the screen.
  const sheet = typeof document === 'undefined' ? card : createPortal(card, document.body);

  return { gate, sheet };
}
