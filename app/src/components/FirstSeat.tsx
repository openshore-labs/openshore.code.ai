// The First Seat: the empty chat's center when nothing on this device can
// answer yet. One hardware-fit pick, one tap to set it up, and the Marketplace
// one tap behind it. It is not a room and carries no codename: it is just how a
// fresh OpenShore greets you. Creative Studio direction "The Seat Fills": the
// room resolves into readiness, the mark settles, the fit line writes itself,
// the card seats with a soft teal bloom and a single tick. The whole surface is
// presence-aware (it animates out, never snaps) and honors reduced motion.
//
// On the desktop the seat is Harbor Master, the third and most capable member
// of the Harbor family, sized to this computer, and the one tap installs it
// right here (the pull rides the store's ensureHarborMaster, progress on the
// button). On the phone the seat routes to the Marketplace, where the pocket
// picks live.
//
// When a brain IS ready this renders its fallback (the greeting, and Harbor
// Light's First Moves on the phone), so the seat only ever owns an empty room.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
import { HARBOR_MASTER_MODEL_NAME, harborMasterSizeLine } from '../lib/harborMaster.js';
import { HARBOR_MINI_MODEL_ID } from '../lib/harborMini.js';

export function FirstSeat({ fallback }: { fallback: ReactNode }) {
  const {
    settings,
    cloudKeyPresent,
    sourceReady,
    setView,
    ensureHarborMaster,
    harborMasterDownload,
  } = useApp();
  const [desktopStatus, setDesktopStatus] = useState<
    | {
        hardwareSummary?: string;
        hardware?: HardwareRead;
        stack?: { orchestrator?: { model?: string } };
      }
    | 'error'
    | undefined
  >(isDesktop() ? undefined : 'error');

  // On the desktop, read the engine: whether a model is configured, and this
  // computer's hardware so the pick is sized to it. Read again after an install
  // so the seat can leave once the engine is configured. On the phone there is
  // no engine to read, so this stays out of the way.
  const readEngine = useCallback(() => {
    if (!isDesktop() || !bridge()) return () => {};
    let live = true;
    bridge()!
      .status()
      .then((s) => live && setDesktopStatus(s))
      .catch(() => live && setDesktopStatus('error'));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => readEngine(), [readEngine]);

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
  const desktop = isDesktop();
  // The card's name: Harbor Master on the desktop (what is really behind it is
  // named on the size line), the weights' own name on the phone.
  const seatName = desktop ? HARBOR_MASTER_MODEL_NAME : pick.name;
  const sizeLine = desktop
    ? harborMasterSizeLine({
        catalogId: pick.catalogId,
        ollamaRef: pick.ollamaRef,
        weightsName: pick.name,
        sizeGB: pick.sizeGB,
      })
    : `${pick.sizeGB} GB download.`;
  const pulling = Boolean(harborMasterDownload && !harborMasterDownload.failed);
  const failed = Boolean(harborMasterDownload?.failed);

  const setUp = () => {
    if (!desktop) {
      setView('marketplace');
      return;
    }
    void ensureHarborMaster().then((ok) => {
      if (ok) readEngine();
    });
  };

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
        <h2 className="first-seat-name">{seatName}</h2>
        <p className="first-seat-class">{classLineFor(pick.ollamaRef)}</p>
        <p className="first-seat-fit">
          {sizeLine} {fitLine(starter.fit, hardware)}
        </p>
        {failed ? (
          <p className="first-seat-fit" role="status">
            {harborMasterDownload!.label}
          </p>
        ) : null}
        <button className="btn primary press-fb" disabled={pulling} onClick={setUp}>
          {pulling
            ? `${harborMasterDownload!.label} of ${seatName}`
            : failed
              ? `Retry ${seatName}`
              : `Set up ${seatName}`}
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
