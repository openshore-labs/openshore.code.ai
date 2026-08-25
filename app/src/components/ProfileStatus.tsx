// The always-visible connectivity status: a colored bubble and the active
// profile, tappable to see all three and to step down manually. Green Docked
// (home reachable), amber Offshore (cloud + on-device), gray Offline
// (on-device only).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../state/store.js';
import {
  PROFILES,
  PROFILE_ORDER,
  autoProfile,
  effectiveProfile,
  selectable,
} from '../lib/profiles.js';

export function ProfileStatus() {
  const { connectivity, settings, setProfileOverride } = useApp();
  const auto = autoProfile(connectivity);
  const active = effectiveProfile(auto, settings.profileOverride);
  const info = PROFILES[active];
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="profile-chip"
        onClick={() => setOpen(true)}
        aria-label={`Connection: ${info.label}`}
      >
        <span className="profile-dot" style={{ background: info.dot }} />
        <span>{info.label}</span>
      </button>

      {open
        ? createPortal(
            // The topbar sets backdrop-filter, which makes it the containing
            // block for position:fixed descendants. Rendering the scrim here
            // would trap it inside the thin bar instead of the viewport, so we
            // portal it to the body to cover the whole screen.
            <div className="sheet-scrim" onClick={() => setOpen(false)}>
              <div className="sheet" onClick={(e) => e.stopPropagation()}>
                <h2>Connection</h2>
                <p className="sheet-sub">
                  Your stack, chats, and connections are the same everywhere. What changes is reach.
                </p>
                <div className="sheet-actions">
                  <button
                    className={`profile-row${!settings.profileOverride ? ' active' : ''}`}
                    onClick={() => {
                      void setProfileOverride(undefined);
                      setOpen(false);
                    }}
                  >
                    <span
                      className="profile-dot"
                      style={{ background: PROFILES[auto].dot, marginTop: 5 }}
                    />
                    <span className="grow">
                      <span className="profile-row-title">Automatic</span>
                      <span className="sub">
                        Follow the connection. Right now: {PROFILES[auto].label}.
                      </span>
                    </span>
                  </button>

                  {PROFILE_ORDER.map((id) => {
                    const p = PROFILES[id];
                    const canPick = selectable(id, auto);
                    const isActive = Boolean(settings.profileOverride) && active === id;
                    return (
                      <button
                        key={id}
                        className={`profile-row${isActive ? ' active' : ''}`}
                        disabled={!canPick}
                        onClick={() => {
                          void setProfileOverride(id);
                          setOpen(false);
                        }}
                      >
                        <span className="profile-dot" style={{ background: p.dot, marginTop: 5 }} />
                        <span className="grow">
                          <span className="profile-row-title">{p.label}</span>
                          <span className="sub">
                            {p.blurb}
                            {!canPick ? ' Not reachable right now.' : ''}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
