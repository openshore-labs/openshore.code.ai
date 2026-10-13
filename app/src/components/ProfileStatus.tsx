// The connectivity status: a colored bubble and the active profile, tappable
// to see all three and to step down manually. Green Docked (your computer
// reachable), ink Offshore (cloud and this device), a hollow ring for Offline
// (this device only). It shows once it can mean something (D1, maintainer
// 2026-10-07): with no computer connected to this device, only a lone Offline
// shows (lib/profiles.ts reachPillShown), and the pill arrives and leaves on
// its own fade rather than popping. The sheet portals to the body so its
// fixed scrim covers the viewport rather than being trapped by the top bar's
// backdrop-filter containing block; it is the house sheet, so it slides in,
// drags to dismiss, and always animates out.
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { agenticView, harnessView, useApp } from '../state/store.js';
import {
  PROFILES,
  PROFILE_ORDER,
  autoProfile,
  effectiveProfile,
  profileBlurb,
  profileUnavailable,
  reachPillShown,
  selectable,
} from '../lib/profiles.js';
import { isDesktop } from '../lib/platform.js';
import { activeContribution } from '../lib/currents.js';
import { activeHarnessContribution } from '../lib/harnessCurrents.js';
import { useExitPresence } from '../hooks/useExitPresence.js';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { CheckGlyph } from './SheetGlyphs.js';

/** The current choice's mark, the drawn check every chooser uses (Select
 *  model, the crew editor's Activity level). */
function RowCheck() {
  return (
    <span className="profile-row-check" aria-hidden="true">
      <CheckGlyph size={18} />
    </span>
  );
}

export function ProfileStatus() {
  const { connectivity, settings } = useApp();
  const active = effectiveProfile(autoProfile(connectivity), settings.profileOverride);
  // Whether the pill is in the bar: once a computer is connected to this
  // device, and a lone Offline before that. Mounted through its exit; it
  // plays its arrival only when it comes in after the bar is up, so a room
  // change never replays it.
  const shown = reachPillShown(active, Boolean(settings.daemon));
  const pill = useExitPresence(shown);
  // Once it has been away while this bar is up, every return settles in, the
  // second as much as the first.
  const awayInBar = useRef(!shown);
  if (!shown) awayInBar.current = true;
  const arriving = shown && awayInBar.current;
  // A leaving pill keeps the word it showed, so a lone Offline never flashes
  // Offshore on its way out when the connection comes back.
  const lastShown = useRef(active);
  if (shown) lastShown.current = active;
  const pillProfile = shown ? active : lastShown.current;

  const [open, setOpen] = useState(false);

  // The Agentic Current that is on, named beside the reach pill on every
  // screen, so the modality reads as whole without one room changing shape.
  // Rendered only through the contribution: with none on, nothing is here.
  // The currents named beside the reach pill are the ACTIVE project's, since a
  // current is now a per-project choice.
  const current = activeContribution(agenticView(settings));
  // The Harness Current that is on (Jev) sits beside it as its own pill. It is
  // cloud spend, so it reads amber (harness-pill), never teal. Independent of
  // the agentic pill, so both can show at once.
  const harness = activeHarnessContribution(harnessView(settings));

  return (
    <>
      {current ? (
        <span className="pill current-pill" aria-label={`${current.header.label} is on`}>
          {current.header.label}
        </span>
      ) : null}
      {harness ? (
        <span
          className="pill current-pill harness-pill"
          aria-label={`${harness.header.label} is on`}
        >
          {harness.header.label}
        </span>
      ) : null}
      {pill.mounted ? (
        <button
          className={`profile-chip${pill.closing ? ' closing' : arriving ? ' arriving' : ''}`}
          onClick={() => setOpen(true)}
          aria-label={`Status: ${PROFILES[pillProfile].label}`}
          tabIndex={pill.closing ? -1 : undefined}
        >
          <span className={`profile-dot ${pillProfile}`} />
          {/* The word; a phone's chat bar folds it away (theme.css,
              CS-04), and the aria-label above keeps it for assistive tech. */}
          <span className="profile-chip-label">{PROFILES[pillProfile].label}</span>
        </button>
      ) : null}
      <StatusSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** The Status sheet: Automatic, then the three statuses, each a step down
 *  from what the connection supports. Exported so a room can offer the same
 *  step down while the pill waits for a computer (D1). */
export function StatusSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connectivity, settings, setProfileOverride } = useApp();
  const auto = autoProfile(connectivity);
  const active = effectiveProfile(auto, settings.profileOverride);
  // On the desktop the device is the computer, so its lines count it as
  // connected; with no other computer named, its lines speak of this one
  // (Desktop Offline: Automatic follows the connection, Offline is a choice
  // that reaches this computer's engine, Docked does not apply here).
  const paired = isDesktop() || Boolean(settings.daemon);
  const home = isDesktop() && !settings.daemon;

  // The top bar sets backdrop-filter, which makes it the containing block for
  // position:fixed descendants. Rendering the scrim there would trap it inside
  // the thin bar instead of the viewport, so the sheet portals to the body to
  // cover the whole screen.
  return createPortal(
    <Sheet open={open} onClose={onClose} className="info-sheet">
      <SheetHead title="Status" onClose={onClose} />
      <p className="sheet-sub">
        Which models can answer depends on what this {home ? 'computer' : 'device'} can reach.
      </p>
      <div className="sheet-actions">
        <button
          className={`profile-row${!settings.profileOverride ? ' active' : ''}`}
          aria-current={!settings.profileOverride ? 'true' : undefined}
          onClick={() => {
            void setProfileOverride(undefined);
            onClose();
          }}
        >
          <span className={`profile-dot ${auto}`} />
          <span className="grow">
            <span className="profile-row-title">Automatic</span>
            <span className="sub">Follow the connection. Right now: {PROFILES[auto].label}.</span>
          </span>
          {!settings.profileOverride ? <RowCheck /> : null}
        </button>

        {PROFILE_ORDER.map((id) => {
          const p = PROFILES[id];
          const canPick = selectable(id, auto);
          const isActive = Boolean(settings.profileOverride) && active === id;
          return (
            <button
              key={id}
              className={`profile-row${isActive ? ' active' : ''}`}
              aria-current={isActive ? 'true' : undefined}
              disabled={!canPick}
              onClick={() => {
                void setProfileOverride(id);
                onClose();
              }}
            >
              <span className={`profile-dot ${id}`} />
              <span className="grow">
                <span className="profile-row-title">{p.label}</span>
                <span className="sub">
                  {profileBlurb(id, paired, home)}
                  {profileUnavailable(id, canPick, paired, home)}
                </span>
              </span>
              {isActive ? <RowCheck /> : null}
            </button>
          );
        })}
      </div>
    </Sheet>,
    document.body,
  );
}
