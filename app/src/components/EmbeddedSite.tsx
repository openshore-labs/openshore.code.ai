// A third-party site hosted inside the desktop shell (Codemagic in Launch),
// contained: the main process fences it to that site's hosts and keeps its
// sign-in in a partition of its own. This component owns the rectangle the
// native view sits in (measured live, so layout and resize keep it in place),
// a small toolbar above it, and hides the view while the drawer is up so
// nothing draws underneath the main navigation. Desktop only; the phone has
// no native view and never renders this.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.js';
import { bridge, type EmbeddedState } from '../lib/electronBridge.js';
import { hapticTick } from '../lib/haptics.js';
import { openExternal } from '../lib/platform.js';

export function embeddedSitesAvailable(): boolean {
  return typeof bridge()?.embeddedOpen === 'function';
}

export function EmbeddedSite({
  site,
  label,
  onClose,
}: {
  site: 'codemagic';
  label: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const drawerOpen = useApp((s) => s.drawerOpen);
  const showToast = useApp((s) => s.showToast);
  const [state, setState] = useState<EmbeddedState | undefined>();

  // Open on mount, keep the bounds matched to the host rectangle, close on
  // unmount. Bounds are CSS pixels of the window, which is what the native
  // view expects.
  useEffect(() => {
    const api = bridge();
    const el = hostRef.current;
    if (!api || !el) return;
    const rect = () => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    void api.embeddedOpen(site, rect()).then((ok) => {
      if (!ok) showToast('Could not open that site here.');
    });
    const push = () => void api.embeddedBounds(rect());
    const ro = new ResizeObserver(push);
    ro.observe(el);
    window.addEventListener('resize', push);
    window.addEventListener('scroll', push, true);
    const off = api.onEmbeddedState((s) => {
      if (s.site === site) setState(s);
    });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', push);
      window.removeEventListener('scroll', push, true);
      off();
      void api.embeddedClose();
    };
  }, [site, showToast]);

  useEffect(() => {
    void bridge()?.embeddedVisible(!drawerOpen);
  }, [drawerOpen]);

  const api = bridge();
  const path = (() => {
    if (!state?.url) return '';
    try {
      const u = new URL(state.url);
      return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
    } catch {
      return '';
    }
  })();

  return (
    <div className="embed">
      <div className="embed-toolbar">
        <button
          type="button"
          className="icon-btn press-fb"
          aria-label="Back"
          disabled={!state?.canGoBack}
          onClick={() => {
            hapticTick();
            void api?.embeddedBack();
          }}
        >
          {'‹'}
        </button>
        <button
          type="button"
          className="icon-btn press-fb"
          aria-label="Reload"
          onClick={() => {
            hapticTick();
            void api?.embeddedReload();
          }}
        >
          {'↻'}
        </button>
        <button
          type="button"
          className="embed-crumb press-fb"
          title={state?.url}
          onClick={() => void api?.embeddedHome()}
        >
          <span className="embed-site">{label}</span>
          {path ? <span className="embed-path">{path}</span> : null}
          {state?.loading ? <span className="embed-loading" aria-label="loading" /> : null}
        </button>
        <div className="composer-row-spacer" />
        <button
          type="button"
          className="btn quiet press-fb"
          onClick={() => {
            if (state?.url) void openExternal(state.url);
          }}
        >
          Open in browser
        </button>
        <button
          type="button"
          className="btn quiet press-fb"
          onClick={async () => {
            hapticTick();
            await api?.embeddedSignOut();
            showToast(`Signed out of ${label} here.`);
          }}
        >
          Sign out
        </button>
        <button type="button" className="btn ghost press-fb" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="embed-host" ref={hostRef} aria-label={`${label}, contained`}>
        {!state ? <div className="embed-placeholder">Opening {label}</div> : null}
      </div>
      <p className="hint embed-note">
        {label} runs here as itself, signed in as you, and cannot browse anywhere else. Links that
        leave it open in your browser.
      </p>
    </div>
  );
}
