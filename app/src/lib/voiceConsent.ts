// Desktop and web voice asks first (advisory org ruling, 2026-09-24). Voice
// input on a computer or in a browser uses the Web Speech API, which in
// Chromium (Chrome, Edge, and the Electron app) sends the audio to Google for
// recognition. So "Send voice to the speech service" is off by default, and the
// first mic tap while it is off shows a card that says where the audio goes;
// only Allow turns it on. The iPhone recognizes speech on the device (the
// OscodeSpeech plugin forces on-device recognition), so it never asks.
import type { Platform } from './platform.js';

export const VOICE_CONSENT_TITLE = 'Send voice to the speech service?';

export const VOICE_CONSENT_PROMPT =
  "Voice on this computer uses your system's speech service, which may send your audio to its provider (in Chrome-based apps, Google). Allow?";

export const VOICE_CONSENT_SETTING_LABEL = 'Send voice to the speech service';

export const VOICE_CONSENT_SETTING_SUB =
  'Voice input here uses your system speech service, which may send audio to its provider (Google in Chrome-based apps). Off by default.';

/** Does a mic tap on this platform need the card first? Only off the iPhone,
 *  and only while the setting is off. */
export function voiceNeedsConsent(
  platform: Platform,
  settings: { voiceCloudConsent?: boolean },
): boolean {
  return platform !== 'ios' && settings.voiceCloudConsent !== true;
}
