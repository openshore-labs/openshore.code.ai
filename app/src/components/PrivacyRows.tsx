// Three Settings rows from the 2026-09-24 advisory rulings, kept together and
// self-contained so the Settings ledger only places them:
//  - "Ask before searching the web" (default on, phone and desktop). On, a web
//    search or page fetch shows the exact query or URL and the service first;
//    on the engine the first yes covers the rest of the session. Off allows
//    web access without asking, for this person's own sessions only.
//  - Where the key lives, per platform (lib/keySeal.ts), never a blanket
//    "encrypted at rest".
//  - "Send voice to the speech service" (default off, desktop and web only).
import { useApp } from '../state/store.js';
import { platform } from '../lib/platform.js';
import { sealKind, sealProtects, SEAL_LINES } from '../lib/keySeal.js';
import {
  VOICE_CONSENT_SETTING_LABEL,
  VOICE_CONSENT_SETTING_SUB,
  voiceNeedsConsent,
} from '../lib/voiceConsent.js';
import { SettingsRow } from './SettingsRow.js';
import { Switch } from './Switch.js';

export const ASK_BEFORE_WEB_LABEL = 'Ask before searching the web';
export const ASK_BEFORE_WEB_SUB =
  'Shows the exact search or page, and the service it goes to, before it leaves. On by default.';

export function WebAskRow() {
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const showToast = useApp((s) => s.showToast);
  const on = settings.askBeforeWeb !== false;
  return (
    <SettingsRow
      label={ASK_BEFORE_WEB_LABEL}
      sub={ASK_BEFORE_WEB_SUB}
      subWrap
      trailing={
        <Switch
          checked={on}
          label={ASK_BEFORE_WEB_LABEL}
          onChange={(next) => {
            void saveSettings({ askBeforeWeb: next });
            showToast(
              next
                ? 'Web searches will ask first, with the exact query shown.'
                : 'Web searches go ahead without asking in new chats.',
            );
          }}
        />
      }
    />
  );
}

export function KeySealRow() {
  const keyStore = useApp((s) => s.desktopStatus?.keyStore);
  const kind = sealKind(platform(), keyStore);
  return (
    <SettingsRow
      label="Where your data key lives"
      sub={SEAL_LINES[kind]}
      subWrap
      value={kind === 'checking' ? undefined : sealProtects(kind) ? 'Sealed' : 'Not protected'}
    />
  );
}

export function VoiceConsentRow() {
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const showToast = useApp((s) => s.showToast);
  // The iPhone recognizes speech on the device; the row would be a no-op there.
  if (platform() === 'ios') return null;
  const on = !voiceNeedsConsent(platform(), settings);
  return (
    <SettingsRow
      label={VOICE_CONSENT_SETTING_LABEL}
      sub={VOICE_CONSENT_SETTING_SUB}
      subWrap
      trailing={
        <Switch
          checked={on}
          label={VOICE_CONSENT_SETTING_LABEL}
          onChange={(next) => {
            void saveSettings({ voiceCloudConsent: next });
            showToast(
              next
                ? 'Voice input on. Audio goes to your system speech service.'
                : 'Voice input will ask before it listens.',
            );
          }}
        />
      }
    />
  );
}
