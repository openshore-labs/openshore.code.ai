// Docking this device to a machine (connect-anywhere, 2026-10-07): scan the
// code a computer or a server shows, or type it in, and this device trades
// the one-time code for its own credential, saved at once (a spent code is
// never thrown away), then checks it. The machine says yes first: the desktop
// in a dialog, a server in the SSH terminal that printed the code. Used by
// Computer and by Cloud Connections, on the phone and on the desktop (which
// types the code and then runs its sessions on the machine it docked to).
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { isDesktop } from '../lib/platform.js';
import { PAIRING_REJECTED, daemonHealth, redeemPairClaim } from '../drivers/remoteDriver.js';
import { parsePairingQr } from '../lib/qrDecode.js';
import { hapticApproval } from '../lib/haptics.js';
import { dockedNoun, dockedNounLower, type DockKind } from '../lib/docking.js';
import { QrScanner } from './QrScanner.js';
import { Sheet } from './Sheet.js';

/** A short pause before the one retry of a health check that followed a
 *  good docking (a first Tailscale link through a relay can be slow). */
const HEALTH_RETRY_MS = 2000;

/** What this device calls itself on the machine's list of docked devices. */
export function phoneDeviceName(): string {
  if (isDesktop()) return 'a computer';
  if (typeof navigator === 'undefined') return 'iPhone';
  // An iPad on iPadOS 13 or later reports itself as a Mac with touch.
  const ua = navigator.userAgent;
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  return iPad ? 'iPad' : 'iPhone';
}

/** The host of a machine's address, for a name a person can read. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

export function DockForm({
  expect,
  offers = false,
  onDocked,
}: {
  /** What the person is docking to, for the copy before the machine answers. */
  expect: DockKind;
  /** Whether this form answers a docking link opened from outside (Computer). */
  offers?: boolean;
  onDocked?: (kind: DockKind | undefined) => void;
}) {
  const { settings, saveHub, setPreferRemoteHub, showToast } = useApp();
  const pairOffer = useApp((s) => s.pairOffer);
  const clearPairOffer = useApp((s) => s.clearPairOffer);
  const desktop = isDesktop();
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [testing, setTesting] = useState(false);
  const [state, setState] = useState<string | undefined>();
  const [scanning, setScanning] = useState(false);
  const [typing, setTyping] = useState(desktop);
  // The docked moment itself, a settled pill pop, cleared the instant the
  // fields change again so it never lingers as a stale claim of success.
  const [docked, setDocked] = useState<DockKind | 'yes' | undefined>();
  const noun = expect === 'server' ? 'your server' : 'your computer';
  const where = expect === 'server' ? 'the server' : 'your computer';

  const fill = (text: string): boolean => {
    const pair = parsePairingQr(text);
    if (!pair) return false;
    setAddress(pair.address);
    setCode(pair.claim);
    return true;
  };

  const connect = async (override?: { address: string; claim: string }) => {
    const baseUrl = (override?.address ?? address).trim().replace(/\/$/, '');
    const claim = (override?.claim ?? code).trim();
    if (!/^https?:\/\//.test(baseUrl) || !claim) {
      setState(`Enter the address and the code ${where} shows.`);
      return;
    }
    setTesting(true);
    setDocked(undefined);
    setState(undefined);
    const claimed = await redeemPairClaim(baseUrl, claim, phoneDeviceName(), {
      onPending: (pairCode) =>
        setState(
          expect === 'server'
            ? pairCode
              ? `On the server, type y to allow this device. It shows the code ${pairCode}.`
              : 'On the server, type y to allow this device.'
            : pairCode
              ? `On your computer, allow this device. It shows the code ${pairCode}.`
              : 'On your computer, allow this device.',
        ),
    });
    if (!claimed.ok) {
      setTesting(false);
      setState(claimed.detail);
      return;
    }
    const token = claimed.token;
    // Saved before any check: the code is spent and the machine holds this
    // device's credential now, so a slow first check must not lose it.
    await saveHub({ baseUrl, token }, { role: claimed.role });
    let health = await daemonHealth({ baseUrl, token });
    if (!health.ok && health.detail !== PAIRING_REJECTED) {
      await new Promise((r) => setTimeout(r, HEALTH_RETRY_MS));
      health = await daemonHealth({ baseUrl, token });
    }
    setTesting(false);
    if (health.ok) {
      if (health.kind) await saveHub({ baseUrl, token, kind: health.kind }, { role: claimed.role });
      // A desktop that docks runs its sessions on that machine from now on;
      // Computer's "Run on another computer" turns it back.
      if (desktop) await setPreferRemoteHub(true);
      setState(undefined);
      setDocked(health.kind ?? 'yes');
      setTyping(desktop);
      hapticApproval();
      showToast(
        desktop
          ? `Docked. This computer now runs its sessions on ${dockedNounLower({ kind: health.kind })}.`
          : `Docked. ${dockedNoun({ kind: health.kind })} is in the model menu.`,
      );
      onDocked?.(health.kind);
    } else {
      setState(
        health.detail === PAIRING_REJECTED
          ? health.detail
          : `Docked. ${expect === 'server' ? 'The server' : 'Your computer'} did not answer the first check, so it may still be starting. It connects on its own once it answers.`,
      );
    }
  };

  const onScanned = (text: string): boolean => {
    const pair = parsePairingQr(text);
    if (!pair) return false;
    setDocked(undefined);
    setAddress(pair.address);
    setCode(pair.claim);
    void connect(pair);
    return true;
  };

  const busyLabel = `Docking to ${noun}...`;
  return (
    <div className="card">
      {!desktop ? (
        <>
          <button
            className="btn primary block press-fb"
            disabled={testing}
            aria-busy={testing}
            onClick={() => setScanning(true)}
          >
            {testing
              ? busyLabel
              : expect === 'server'
                ? 'Scan the code on your server'
                : settings.daemon
                  ? 'Scan to dock another computer'
                  : 'Scan the QR on your computer'}
          </button>
          <QrScanner open={scanning} onDecode={onScanned} onClose={() => setScanning(false)} />
        </>
      ) : (
        <h3 style={{ marginTop: 0 }}>
          {expect === 'server' ? 'Dock this computer to your server' : 'Dock to another computer'}
        </h3>
      )}
      {docked ? (
        <p className="hint" role="status" style={{ marginTop: 10, marginBottom: 0 }}>
          <span className="pill ok pill-pop">Docked</span>{' '}
          {desktop
            ? 'Sessions on this computer now run there.'
            : 'Pick it in the model menu to chat or code.'}
        </p>
      ) : state ? (
        <p className="hint" role="status" style={{ marginTop: 10 }}>
          {state}
        </p>
      ) : null}

      {!desktop ? (
        <button
          type="button"
          className="linklike press-fb"
          style={{ marginTop: 12 }}
          aria-expanded={typing}
          onClick={() => setTyping((t) => !t)}
        >
          {typing ? 'Hide the typed entry' : "Can't scan? Type it in"}
        </button>
      ) : null}
      {typing ? (
        <div style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor={`dock-address-${expect}`}>Address</label>
            <input
              id={`dock-address-${expect}`}
              placeholder={
                expect === 'server' ? 'Printed under the code on the server' : 'Shown under the QR'
              }
              value={address}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => {
                setDocked(undefined);
                if (!fill(e.target.value)) setAddress(e.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`dock-code-${expect}`}>Code</label>
            <input
              id={`dock-code-${expect}`}
              placeholder="pc_..."
              value={code}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => {
                setDocked(undefined);
                if (!fill(e.target.value)) setCode(e.target.value);
              }}
            />
          </div>
          <button
            className="btn primary block press-fb"
            disabled={testing}
            onClick={() => void connect()}
          >
            {testing ? busyLabel : 'Dock'}
          </button>
        </div>
      ) : null}

      {/* A docking link opened from outside (the iPhone Camera read the
          code): ask first, never dock on a link alone. */}
      {offers ? (
        <Sheet open={Boolean(pairOffer)} onClose={clearPairOffer} variant="confirm">
          <h3>Dock to this machine?</h3>
          <p>{pairOffer ? hostOf(pairOffer.address) : ''}</p>
          <div className="confirm-row">
            <button type="button" className="btn ghost press-fb" onClick={clearPairOffer}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary press-fb"
              onClick={() => {
                const offer = pairOffer;
                clearPairOffer();
                if (!offer) return;
                setAddress(offer.address);
                setCode(offer.claim);
                void connect(offer);
              }}
            >
              Dock
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
