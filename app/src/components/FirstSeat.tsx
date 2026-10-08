// The First Seat: the empty chat's center when nothing on this device can
// answer yet. One pick and one tap to set it up. It is not a room and carries
// no codename: it is just how a fresh OpenShore greets you. Creative Studio direction "The Seat Fills": the
// room resolves into readiness, the mark settles, the fit line writes itself,
// the card seats with a soft teal bloom and a single tick. The whole surface is
// presence-aware (it animates out, never snaps) and honors reduced motion.
//
// On the desktop the seat is DeepBlue, the third and most capable member
// of the Harbor family, sized to this computer, and the one tap installs it
// right here (the pull rides the store's ensureHarborMaster, progress on the
// button). On the phone the seat is Harbor, set up from Settings.
//
// When a brain IS ready this renders its fallback (the greeting, and Harbor
// Light's First Moves on the phone), so the seat only ever owns an empty room.
//
// A first message sent while the seat is up waits here (state/firstRunOps.ts)
// and the card says so in CX ruling 2's words; it goes out by itself, as a
// plain chat that needs no account, the moment DeepBlue is ready. Signing in
// never stands in the way of the download or the message: while the download
// runs, one quiet line offers it, and its link opens the plain Sign in sheet.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../state/store.js';
import { FIRST_SEAT_COPY } from '../state/firstRunOps.js';
import { logEvent } from '../lib/insights.js';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { SignInCard } from './SignInCard.js';
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
import { HARBOR_APPROX_LABEL, HARBOR_MODEL_NAME } from '../lib/harbor.js';
import { thisDeviceNoun } from '../lib/deviceNoun.js';

export function FirstSeat({
  fallback,
  onEditHeld,
}: {
  fallback: ReactNode;
  /** Take the saved message back into the composer (CX cleanup 8): the chat
   *  screen's restore path, with the cursor at the end and no toast. The
   *  download keeps going, and Send saves the message again. */
  onEditHeld?: () => void;
}) {
  const {
    settings,
    cloudKeyPresent,
    sourceReady,
    setView,
    ensureHarborMaster,
    harborMasterDownload,
    needsAccountNow,
  } = useApp();
  const signedIn = useApp((s) => Boolean(s.authSession));
  // The plain Sign in sheet the download line opens. It closes itself once
  // the person is signed in, and it outlives the seat, so a download that
  // finishes mid sign-in never snaps it away.
  const [signInOpen, setSignInOpen] = useState(false);
  useEffect(() => {
    if (signedIn) setSignInOpen(false);
  }, [signedIn]);
  const signInSheet = (
    <Sheet open={signInOpen} onClose={() => setSignInOpen(false)}>
      <SheetHead title="Sign in" onClose={() => setSignInOpen(false)} />
      <SignInCard />
    </Sheet>
  );
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
  // The saved line folds away (never snaps) once the message is taken back or
  // sent, so it keeps its last words while it goes.
  const heldMessage = Boolean(settings.heldFirstMessage?.untilReady);
  const heldFailed = Boolean(harborMasterDownload?.failed);
  const lastHeldLine = useRef<string | undefined>(undefined);
  if (heldMessage)
    lastHeldLine.current = heldFailed ? FIRST_SEAT_COPY.failed : FIRST_SEAT_COPY.held;
  if (!mounted) {
    return (
      <>
        {fallback}
        {signInSheet}
      </>
    );
  }

  const starter = resolveStarter(hardware);
  const pick = starter.pick;
  const desktop = isDesktop();
  // The card's name: DeepBlue on the desktop (what is really behind it is
  // named on the size line), Harbor on the phone, the model Set up opens.
  const seatName = desktop ? HARBOR_MASTER_MODEL_NAME : HARBOR_MODEL_NAME;
  const sizeLine = desktop
    ? harborMasterSizeLine({
        catalogId: pick.catalogId,
        ollamaRef: pick.ollamaRef,
        weightsName: pick.name,
        sizeGB: pick.sizeGB,
      })
    : `${HARBOR_APPROX_LABEL.charAt(0).toUpperCase()}${HARBOR_APPROX_LABEL.slice(1)} download.`;
  const pulling = Boolean(harborMasterDownload && !harborMasterDownload.failed);
  const failed = Boolean(harborMasterDownload?.failed);
  // A first message waiting on this seat (CX ruling 2).
  const held = heldMessage;
  const heldLine = lastHeldLine.current;
  // Only while the download runs, and only for someone signed out.
  const offerSignIn = desktop && pulling && needsAccountNow();

  const setUp = () => {
    if (!desktop) {
      // The phone's own model is Harbor, from Settings (the Marketplace is
      // Coming soon, so it is never a door here).
      setView('settings');
      return;
    }
    void ensureHarborMaster().then((ok) => {
      if (ok) readEngine();
    });
  };

  // The sheet sits beside the seat, never among its staggered children, so
  // the seat's own rise and exit never move it.
  return (
    <>
      <div className={`first-seat${closing ? ' closing' : ''}`}>
        <span className="first-seat-mark" style={{ '--i': 0 } as React.CSSProperties}>
          <BrandMark size={40} />
        </span>
        <p className="first-seat-line" style={{ '--i': 1 } as React.CSSProperties}>
          {desktop
            ? 'A private coding partner that runs on your own computer. Free, and yours.'
            : `A private coding partner that runs on ${thisDeviceNoun()}. Free, and yours.`}
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
          <p className="first-seat-class">
            {desktop ? classLineFor(pick.ollamaRef) : 'Writes and explains code in the chat.'}
          </p>
          <p className="first-seat-fit">
            {desktop ? `${sizeLine} ${fitLine(starter.fit, hardware)}` : sizeLine}
          </p>
          {failed ? (
            <p className="first-seat-fit" role="status">
              {harborMasterDownload!.label}
            </p>
          ) : pulling && harborMasterDownload!.note ? (
            <p className="first-seat-fit" role="status">
              {harborMasterDownload!.note}
            </p>
          ) : null}
          {heldLine ? (
            <div
              className={`reveal first-seat-held-fold${held ? ' open' : ''}`}
              aria-hidden={held ? undefined : true}
            >
              <div className="reveal-inner">
                <p className="first-seat-held" role="status">
                  {heldLine}
                  {onEditHeld ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="linklike"
                        aria-label={FIRST_SEAT_COPY.editLabel}
                        tabIndex={held ? undefined : -1}
                        onClick={() => {
                          if (held) onEditHeld();
                        }}
                      >
                        {FIRST_SEAT_COPY.edit}
                      </button>
                    </>
                  ) : null}
                </p>
              </div>
            </div>
          ) : null}
          <button className="btn primary press-fb" disabled={pulling} onClick={setUp}>
            {pulling
              ? /%$/.test(harborMasterDownload!.label)
                ? `${harborMasterDownload!.label} of ${seatName}`
                : harborMasterDownload!.label
              : failed
                ? `Try ${seatName} again`
                : `Set up ${seatName}`}
          </button>
          {offerSignIn ? (
            <p className="first-seat-aside">
              {FIRST_SEAT_COPY.signIn.before}
              <button
                type="button"
                className="linklike"
                onClick={() => {
                  // CX ruling 2 rests on an assumption (the wait costs nothing);
                  // counting the sign-ins that start here tests it.
                  logEvent('first_seat_sign_in_open');
                  setSignInOpen(true);
                }}
              >
                {FIRST_SEAT_COPY.signIn.link}
              </button>
              {FIRST_SEAT_COPY.signIn.after}
            </p>
          ) : null}
        </div>
        <div className="first-seat-more" style={{ '--i': 3 } as React.CSSProperties}>
          <div className="first-seat-more-label">More ways to start</div>
          <button className="first-seat-more-row press-fb" onClick={() => setView('pair')}>
            Connect your computer
          </button>
          <button className="first-seat-more-row press-fb" onClick={() => setView('connections')}>
            Add an API key
          </button>
          <button className="first-seat-more-row press-fb" onClick={() => setView('stack')}>
            Open Stack
          </button>
        </div>
      </div>
      {signInSheet}
    </>
  );
}

// Re-exported so a caller can offer the bundled guide's chat without reaching
// past this module for the id.
export { HARBOR_MINI_MODEL_ID };
