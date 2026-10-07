// The always-visible connectivity status: a colored bubble and the active
// profile, tappable to see all three and to step down manually. Green Docked
// (your computer reachable), ink Offshore (cloud and this device), a hollow
// ring for Offline (this device only). The sheet portals to the body so its
// fixed scrim covers the viewport rather than being trapped by the top bar's
// backdrop-filter containing block; it is the house sheet, so it slides in,
// drags to dismiss, and always animates out.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { agenticView, harnessView, useApp } from '../state/store.js';
import {
  PROFILES,
  PROFILE_ORDER,
  autoProfile,
  effectiveProfile,
  profileBlurb,
  selectable,
} from '../lib/profiles.js';
import { isDesktop } from '../lib/platform.js';
import { activeContribution } from '../lib/currents.js';
import { activeHarnessContribution } from '../lib/harnessCurrents.js';
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
  const { connectivity, settings, setProfileOverride } = useApp();
  const auto = autoProfile(connectivity);
  const active = effectiveProfile(auto, settings.profileOverride);
  const info = PROFILES[active];
  // On the desktop the device is the computer, so it counts as connected.
  const paired = isDesktop() || Boolean(settings.daemon);

  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

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
      <button
        className="profile-chip"
        onClick={() => setOpen(true)}
        aria-label={`Status: ${info.label}`}
      >
        <span className={`profile-dot ${active}`} />
        <span>{info.label}</span>
      </button>

      {/* The top bar sets backdrop-filter, which makes it the containing
          block for position:fixed descendants. Rendering the scrim here would
          trap it inside the thin bar instead of the viewport, so the sheet
          portals to the body to cover the whole screen. */}
      {createPortal(
        <Sheet open={open} onClose={close} className="info-sheet">
          <SheetHead title="Status" onClose={close} />
          <p className="sheet-sub">
            Which models can answer depends on what this device can reach.
          </p>
          <div className="sheet-actions">
            <button
              className={`profile-row${!settings.profileOverride ? ' active' : ''}`}
              aria-current={!settings.profileOverride ? 'true' : undefined}
              onClick={() => {
                void setProfileOverride(undefined);
                close();
              }}
            >
              <span className={`profile-dot ${auto}`} />
              <span className="grow">
                <span className="profile-row-title">Automatic</span>
                <span className="sub">
                  Follow the connection. Right now: {PROFILES[auto].label}.
                </span>
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
                    close();
                  }}
                >
                  <span className={`profile-dot ${id}`} />
                  <span className="grow">
                    <span className="profile-row-title">{p.label}</span>
                    <span className="sub">
                      {profileBlurb(id, paired)}
                      {!canPick && paired ? ' Not reachable right now.' : ''}
                    </span>
                  </span>
                  {isActive ? <RowCheck /> : null}
                </button>
              );
            })}
          </div>
        </Sheet>,
        document.body,
      )}
    </>
  );
}
