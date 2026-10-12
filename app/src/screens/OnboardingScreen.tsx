// The setup page: the ways to go further than the built-in guide, none
// required. A new person never lands here first; they open into Harbor Lite's
// chat, and its greeting carries the button that brings them here (maintainer,
// 2026-09-23). No Personal-or-Business question either: with no account,
// OpenShore runs as personal, and the choice is asked when an account is made.
// The headline is the App Store's "Your models. Your keys." with a lead that
// names where it runs from the device in hand (D23), and the paths are the
// shared StartingPaths cards, one tap each (D9).
import { useRef } from 'react';
import { useApp } from '../state/store.js';
import { logEvent } from '../lib/insights.js';
import { BackBar, ROOM_NAMES } from '../components/BackBar.js';
import { BrandMark } from '../components/BrandMark.js';
import { StartingPaths } from '../components/StartingPaths.js';
import { isDesktop } from '../lib/platform.js';
import { thisDeviceNoun } from '../lib/deviceNoun.js';

/** Where OpenShore runs, said from the device in hand (D23, maintainer
 *  2026-10-07): this phone or iPad and your own computer, or this computer
 *  and your phone. One sentence, true on each: the phone runs Harbor and
 *  reaches your computer once it is connected, and on the computer the same
 *  pairing lets your phone reach it. The paths follow the same split
 *  (StartingPaths). */
export function setupLead(desktop: boolean): string {
  return desktop
    ? 'Chat and build on this computer, and from your phone.'
    : `Chat and build on ${thisDeviceNoun()} and on your own computer.`;
}

/** The lead's second sentence. A no-break space holds its last two words
 *  together, so a narrow window (Slide Over, 320pt) never leaves "optional."
 *  alone on the last line, in a web view too old for text-wrap: pretty. */
export const SETUP_LEAD_TAIL = 'Everything below is\u00a0optional.';

export function OnboardingScreen() {
  const { setView, saveSettings } = useApp();
  const titleRef = useRef<HTMLHeadingElement>(null);

  const back = async () => {
    await saveSettings({ onboarded: true });
    logEvent('setup_page_back', { next: 'chat' });
    setView('chat');
  };

  return (
    <div className="shell-main">
      <div className="screen">
        <BackBar
          title={ROOM_NAMES.onboarding}
          titleHiddenUntil={titleRef}
          back={{ to: ROOM_NAMES.chat, onBack: () => void back() }}
        />
        <div className="screen-inner" style={{ paddingTop: 24 }}>
          <div style={{ textAlign: 'center', marginBottom: 26 }}>
            <span className="brand-lockup">
              <BrandMark size={30} />
              <span className="wordmark wordmark-lg">
                Open<span className="accent">Shore</span>
              </span>
            </span>
            {/* The App Store's first line (D23, 2026-10-07). Each
                phrase holds together, so a narrow screen breaks between them
                and never inside one. */}
            <h1
              ref={titleRef}
              style={{ marginTop: 14, fontFamily: 'var(--font-display)', fontWeight: 500 }}
            >
              <span style={{ whiteSpace: 'nowrap' }}>Your models.</span>{' '}
              <span style={{ whiteSpace: 'nowrap' }}>Your keys.</span>
            </h1>
            <p className="lead" style={{ marginTop: 8 }}>
              {setupLead(isDesktop())} {SETUP_LEAD_TAIL}
            </p>
          </div>

          <StartingPaths context="onboarding" />

          <button className="btn quiet block" style={{ marginTop: 6 }} onClick={() => void back()}>
            Back to chat
          </button>
        </div>
      </div>
    </div>
  );
}
