// The First Seat: the empty chat's center when nothing on this device can
// answer yet. One hardware-fit pick, one tap to set it up, and the Marketplace
// one tap behind it. It is not a room and carries no codename: it is just how a
// fresh OpenShore greets you. Creative Studio direction "The Seat Fills": the
// room resolves into readiness, the mark settles, the fit line writes itself,
// the card seats with a soft teal bloom and a single tick. The whole surface is
// presence-aware (it animates out, never snaps) and honors reduced motion.
//
// When a brain IS ready this renders its fallback (the greeting, and Harbor
// Light's First Moves on the phone), so the seat only ever owns an empty room.
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop, platform } from '../lib/platform.js';
import { useExitPresence } from '../hooks/useExitPresence.js';
import { doorExitMs } from '../lib/motion.js';
import { hapticTick } from '../lib/haptics.js';
import { BrandMark } from './BrandMark.js';
import {
  classLineFor,
  firstSeatNeeded,
  fitLine,
  hardwareFromSummary,
  type HardwareRead,
} from '../lib/firstSeat.js';
import { resolveStarter } from '../lib/starterModel.js';
import { HARBOR_MINI_MODEL_ID } from '../lib/harborMini.js';

export function FirstSeat({ fallback }: { fallback: ReactNode }) {
  const { settings, cloudKeyPresent, sourceReady, setView } = useApp();
  const [desktopStatus, setDesktopStatus] = useState<
    | {
        hardwareSummary?: string;
        hardware?: HardwareRead;
        stack?: { orchestrator?: { model?: string } };
      }
    | 'error'
    | undefined
  >(isDesktop() ? undefined : 'error');

  // On the desktop, read the engine once: whether a model is configured, and
  // this computer's hardware so the pick is sized to it. On the phone there is
  // no engine to read, so this stays out of the way.
  useEffect(() => {
    if (!isDesktop() || !bridge()) return;
    let live = true;
    bridge()!
      .status()
      .then((s) => live && setDesktopStatus(s))
      .catch(() => live && setDesktopStatus('error'));
    return () => {
      live = false;
    };
  }, []);

  const engineModel =
    desktopStatus && desktopStatus !== 'error'
      ? desktopStatus.stack?.orchestrator?.model
      : undefined;
  const hardware: HardwareRead | undefined =
    desktopStatus && desktopStatus !== 'error'
      ? (desktopStatus.hardware ?? hardwareFromSummary(desktopStatus.hardwareSummary))
      : undefined;

  const needed = firstSeatNeeded({
    platform: platform(),
    desktopStatusKnown: desktopStatus !== undefined,
    desktopConfigured: Boolean(engineModel),
    stackReady: sourceReady({ kind: 'stack' }),
    cloudReady: cloudKeyPresent,
    hubPaired: Boolean(settings.daemon),
  });

  const { mounted, closing } = useExitPresence(needed, doorExitMs());
  if (!mounted) return <>{fallback}</>;

  const starter = resolveStarter(hardware);
  const pick = starter.pick;

  return (
    <div className={`first-seat${closing ? ' closing' : ''}`}>
      <span className="first-seat-mark" style={{ '--i': 0 } as React.CSSProperties}>
        <BrandMark size={40} />
      </span>
      <p className="first-seat-line" style={{ '--i': 1 } as React.CSSProperties}>
        A private coding partner that runs on your own machine. Free, and yours.
      </p>
      <div
        className="first-seat-card"
        style={{ '--i': 2 } as React.CSSProperties}
        onAnimationEnd={(e) => {
          // One tick, when the card seats. Never on a tap (the app root ticks
          // every button already), so the finger never feels two.
          if (e.animationName === 'seat-card-in') hapticTick();
        }}
      >
        <h2 className="first-seat-name">{pick.name}</h2>
        <p className="first-seat-class">{classLineFor(pick.ollamaRef)}</p>
        <p className="first-seat-fit">
          {pick.sizeGB} GB download. {fitLine(starter.fit, hardware)}
        </p>
        <button
          className="btn primary press-fb"
          onClick={() => setView(isDesktop() ? 'stack' : 'marketplace')}
        >
          Set up {pick.name}
        </button>
      </div>
      <div className="first-seat-more" style={{ '--i': 3 } as React.CSSProperties}>
        <div className="first-seat-more-label">More ways to start</div>
        <button className="first-seat-more-row press-fb" onClick={() => setView('pair')}>
          Connect your computer
        </button>
        <button className="first-seat-more-row press-fb" onClick={() => setView('connections')}>
          Connect a key
        </button>
        <button className="first-seat-more-row press-fb" onClick={() => setView('marketplace')}>
          Browse the Marketplace
        </button>
      </div>
    </div>
  );
}

// Re-exported so a caller can offer the bundled guide's chat without reaching
// past this module for the id.
export { HARBOR_MINI_MODEL_ID };
