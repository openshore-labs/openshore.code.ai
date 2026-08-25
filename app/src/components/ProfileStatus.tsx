// The always-visible connectivity status: a colored bubble and the active
// profile, tappable to see all three and to step down manually. Green Docked
// (home reachable), amber Offshore (cloud + on-device), gray Offline
// (on-device only). The sheet portals to the body so its fixed scrim covers
// the viewport rather than being trapped by the top bar's backdrop-filter
// containing block; it slides in, drags to dismiss, and always animates out.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../state/store.js';
import {
  PROFILES,
  PROFILE_ORDER,
  autoProfile,
  effectiveProfile,
  selectable,
} from '../lib/profiles.js';
import { hapticTick } from '../lib/haptics.js';

// Drag further than this and the release dismisses; short of it, the sheet
// springs back. EXIT_MS matches the scrim/sheet exit transition in theme.css.
const DISMISS_THRESHOLD = 90;
const EXIT_MS = 340;

export function ProfileStatus() {
  const { connectivity, settings, setProfileOverride } = useApp();
  const auto = autoProfile(connectivity);
  const active = effectiveProfile(auto, settings.profileOverride);
  const info = PROFILES[active];

  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const dragYRef = useRef(0);
  const pointerId = useRef<number | null>(null);
  const exitTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    },
    [],
  );

  const finish = () => {
    setOpen(false);
    setClosing(false);
    setDragging(false);
    setDragY(0);
    dragYRef.current = 0;
    pointerId.current = null;
    exitTimer.current = null;
  };

  // Play the exit (scrim fade + sheet slide down), then unmount. A fixed timer
  // drives the unmount so it also lands under prefers-reduced-motion, where the
  // transition is suppressed and no transitionend would ever fire.
  const dismiss = () => {
    if (closing) return;
    setDragging(false);
    setClosing(true);
    if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(finish, EXIT_MS);
  };

  const openSheet = () => {
    if (exitTimer.current !== null) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    setClosing(false);
    setDragging(false);
    setDragY(0);
    dragYRef.current = 0;
    setOpen(true);
  };

  const onGrabStart = (e: React.PointerEvent) => {
    if (closing) return;
    startY.current = e.clientY;
    dragYRef.current = 0;
    pointerId.current = e.pointerId;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    hapticTick(); // the lift
  };
  const onGrabMove = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    const y = Math.max(0, e.clientY - startY.current);
    dragYRef.current = y;
    setDragY(y);
  };
  const onGrabEnd = () => {
    if (pointerId.current === null) return;
    pointerId.current = null;
    if (dragYRef.current > DISMISS_THRESHOLD) {
      hapticTick(); // the drop
      dismiss();
    } else {
      setDragging(false);
      setDragY(0);
      dragYRef.current = 0;
    }
  };

  return (
    <>
      <button className="profile-chip" onClick={openSheet} aria-label={`Connection: ${info.label}`}>
        <span className="profile-dot" style={{ background: info.dot }} />
        <span>{info.label}</span>
      </button>

      {open
        ? createPortal(
            // The top bar sets backdrop-filter, which makes it the containing
            // block for position:fixed descendants. Rendering the scrim here
            // would trap it inside the thin bar instead of the viewport, so we
            // portal it to the body to cover the whole screen.
            <div className={`sheet-scrim${closing ? ' closing' : ''}`} onClick={dismiss}>
              <div
                className={`sheet info-sheet${dragging ? ' dragging' : ''}${closing ? ' closing' : ''}`}
                style={!closing && dragY ? { transform: `translateY(${dragY}px)` } : undefined}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="sheet-grabber"
                  onPointerDown={onGrabStart}
                  onPointerMove={onGrabMove}
                  onPointerUp={onGrabEnd}
                  onPointerCancel={onGrabEnd}
                >
                  <span className="sheet-grabber-bar" aria-hidden="true" />
                </div>
                <h2>Connection</h2>
                <p className="sheet-sub">
                  Your stack, chats, and connections are the same everywhere. What changes is reach.
                </p>
                <div className="sheet-actions">
                  <button
                    className={`profile-row${!settings.profileOverride ? ' active' : ''}`}
                    onClick={() => {
                      void setProfileOverride(undefined);
                      dismiss();
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
                          dismiss();
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
