// Pairing (named by CX, 2026-10-01; once "Desktop + phone"). On the desktop:
// phone access on or off, and a QR that is a link the iPhone Camera opens. On
// the phone: scan it (the hero path), or type it in, and the phone trades the
// one-time code for its own credential. The daemon owns the run, so a dropped
// connection reattaches with nothing lost. docs/pairing-review.md.
// Part of Plus (lib/payGate.ts): the pairing code, Scan, and Connect open the
// paywall while it is shut; Revoke, Forget, and Turn off never do.
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { hubList, useApp, type HubRole } from '../state/store.js';
import { bridge, type DaemonInfo } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { PAIRING_REJECTED, daemonHealth, redeemPairClaim } from '../drivers/remoteDriver.js';
import { BackBar } from '../components/BackBar.js';
import { QrScanner } from '../components/QrScanner.js';
import { Switch } from '../components/Switch.js';
import { pairingLink, parsePairingQr } from '../lib/qrDecode.js';
import { ROOM_LABELS } from '../lib/navRooms.js';
import { hapticApproval } from '../lib/haptics.js';
import { Icon } from '../components/Icon.js';
import { Sheet } from '../components/Sheet.js';
import { SheetHead } from '../components/SheetHead.js';
import { ReplaceSharedKey } from '../components/ReplaceSharedKey.js';
import { hubStatusLine, onLinux } from '../lib/hubStatus.js';
import { PlusNote } from '../components/PlusNote.js';

// Clean glyphs for the Tailscale download rows, drawn in the tile's ink on a
// solid accent tile (iOS-app-icon feel). One per platform.
const GLYPHS: Record<string, JSX.Element> = {
  apple: (
    <Icon variant="fill">
      <path
        fill="currentColor"
        d="M15.77 12.9c-.02-2.13 1.74-3.15 1.82-3.2-.99-1.45-2.54-1.65-3.09-1.67-1.31-.13-2.56.77-3.23.77-.66 0-1.69-.75-2.78-.73-1.43.02-2.75.83-3.48 2.11-1.48 2.57-.38 6.38 1.06 8.47.7 1.02 1.54 2.17 2.63 2.13 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.74.66 1.13-.02 1.85-1.04 2.55-2.07.8-1.19 1.13-2.34 1.15-2.4-.03-.01-2.2-.85-2.22-3.36zM13.7 6.3c.58-.7.97-1.68.86-2.65-.83.03-1.84.55-2.44 1.25-.53.62-1 1.61-.88 2.56.93.07 1.88-.47 2.46-1.16z"
      />
    </Icon>
  ),
  windows: (
    <Icon variant="fill">
      <rect x="3.5" y="4" width="7.4" height="7.4" rx="0.8" />
      <rect x="13.1" y="4" width="7.4" height="7.4" rx="0.8" />
      <rect x="3.5" y="12.6" width="7.4" height="7.4" rx="0.8" />
      <rect x="13.1" y="12.6" width="7.4" height="7.4" rx="0.8" />
    </Icon>
  ),
  linux: (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2.2" />
      <path d="M7 10l2.6 2-2.6 2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.4 14.2h4.2" strokeLinecap="round" />
    </Icon>
  ),
  phone: (
    <Icon>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
      <path d="M10.5 5h3" strokeLinecap="round" />
    </Icon>
  ),
  android: (
    <Icon weight="hairline" variant="fill">
      <path
        fill="currentColor"
        d="M8 8.5a4 4 0 0 1 8 0zM8 9h8v6.4a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z"
      />
      <rect x="4.6" y="9.6" width="1.8" height="5.4" rx="0.9" fill="currentColor" />
      <rect x="17.6" y="9.6" width="1.8" height="5.4" rx="0.9" fill="currentColor" />
      <rect x="9.4" y="16" width="1.8" height="3.2" rx="0.9" fill="currentColor" />
      <rect x="12.8" y="16" width="1.8" height="3.2" rx="0.9" fill="currentColor" />
      <path d="M9.2 5.6l1.3 1.9M14.8 5.6l-1.3 1.9" stroke="currentColor" strokeLinecap="round" />
      <circle cx="10.3" cy="6.9" r="0.65" fill="var(--accent)" />
      <circle cx="13.7" cy="6.9" r="0.65" fill="var(--accent)" />
    </Icon>
  ),
};

// Tailscale download links, shown on the phone pairing screen so a new user can
// install it on their desktop without hunting. Desktop platforms use Tailscale's
// own per-OS download pages; mobile points at the app stores.
const TAILSCALE_LINKS: { label: string; glyph: keyof typeof GLYPHS; href: string }[] = [
  { label: 'macOS', glyph: 'apple', href: 'https://tailscale.com/download/macos' },
  { label: 'Windows', glyph: 'windows', href: 'https://tailscale.com/download/windows' },
  { label: 'Linux', glyph: 'linux', href: 'https://tailscale.com/download/linux' },
  {
    label: 'iPhone / iPad',
    glyph: 'phone',
    href: 'https://apps.apple.com/app/tailscale/id1470499037',
  },
  {
    label: 'Android',
    glyph: 'android',
    href: 'https://play.google.com/store/apps/details?id=com.tailscale.ipn',
  },
];

export function PairScreen() {
  return isDesktop() ? <DesktopPair /> : <PhonePair />;
}

function DesktopPair() {
  const { showToast } = useApp();
  // The pairing code is the paid moment on this side: it shows only while
  // Plus is open. Revoking a phone stays free.
  const pairOpen = useApp((s) => s.personalDoor('pairing') === 'open');
  const [info, setInfo] = useState<DaemonInfo | undefined>();
  const [qr, setQr] = useState<string | undefined>();
  const [showToken, setShowToken] = useState(false);
  // The "it worked" moment (CX 2026-10-01): a phone that pairs while this
  // room is open is named at the top, and the QR folds into a quiet "Pair
  // another phone" until it is asked for again.
  const knownDevices = useRef<Set<string> | undefined>(undefined);
  const [justPaired, setJustPaired] = useState<string | undefined>();
  const [qrFolded, setQrFolded] = useState(false);
  const [revoking, setRevoking] = useState<{ id: string; label: string } | undefined>();
  const [more, setMore] = useState(false);
  const [login, setLogin] = useState<{ on: boolean; supported: boolean } | undefined>();

  const refresh = async () => {
    const b = bridge();
    if (!b) return;
    const next = await b.daemonInfo();
    setInfo(next);
    const ids = new Set((next.devices ?? []).map((d) => d.id));
    if (knownDevices.current) {
      const fresh = (next.devices ?? []).find((d) => !knownDevices.current!.has(d.id));
      if (fresh) {
        setJustPaired(fresh.label);
        setQrFolded(true);
        hapticApproval();
      }
    }
    knownDevices.current = ids;
    // Only publish a QR the phone can actually reach: a loopback-only fallback
    // (Tailscale down) would hand out an address that points at the phone itself.
    if (next.running && next.host && next.mode !== 'loopback' && next.claim) {
      // A link, so the iPhone's own Camera app opens OpenShore with it.
      const payload = pairingLink(`http://${next.host}:${next.port}`, next.claim);
      setQr(
        await QRCode.toDataURL(payload, {
          margin: 1,
          width: 240,
          color: { dark: '#1c2a33', light: '#f6f4ef' },
        }),
      );
    } else {
      setQr(undefined);
    }
  };

  useEffect(() => {
    void refresh();
    void bridge()
      ?.launchAtLogin?.()
      .then(setLogin)
      .catch(() => {});
    // Poll so starting Tailscale after opening this screen updates the state
    // (the daemon can move from loopback-only to the tailnet without a reload),
    // and so a phone that pairs is seen here within a few seconds.
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tailscaleHere = TAILSCALE_LINKS.find((l) => l.label === thisDesktopOs());

  return (
    <div className="screen">
      <BackBar title={ROOM_LABELS.pair} />
      <div className="screen-inner">
        <h1>Put this on your phone</h1>
        <p className="lead">
          Your phone reaches your computer over Tailscale, a free app that privately links your own
          devices. Work stays on your computer, so losing signal loses nothing.
        </p>

        {justPaired ? (
          <p className="pair-done" role="status">
            <span className="pill ok pill-pop">{justPaired} paired</span> It can reach this computer
            now.
          </p>
        ) : null}

        <div className="card">
          <div className="card-row">
            <div className="grow">
              <h3>Phone access</h3>
              <div className="sub">{hubStatusLine(info, { linux: onLinux() })}</div>
            </div>
            <button
              className={`btn ${info?.running ? 'ghost' : 'primary'} press-fb`}
              style={{ padding: '8px 14px' }}
              onClick={async () => {
                const b = bridge();
                if (!b) return;
                if (info?.running) {
                  await b.daemonStop();
                } else {
                  const result = await b.daemonStart();
                  // The status line says it could not turn on (hubStatusLine);
                  // the raw reason is for the log, not the screen.
                  if ('error' in result) console.warn('[pair] hub did not start:', result.error);
                }
                await refresh();
              }}
            >
              {info?.running ? 'Turn off' : 'Turn on'}
            </button>
          </div>
          {info && !info.tailscaleUp && tailscaleHere ? (
            <a
              className="dl-item"
              href={tailscaleHere.href}
              target="_blank"
              rel="noreferrer noopener"
              style={{ marginTop: 12 }}
            >
              <span className="dl-tile">{GLYPHS[tailscaleHere.glyph]}</span>
              <span className="dl-name">Tailscale for {tailscaleHere.label}</span>
              <span className="dl-get">GET</span>
            </a>
          ) : null}
          {login?.supported ? (
            <div className="card-row" style={{ marginTop: 12 }}>
              <div className="grow">
                <div>{LAUNCH_AT_LOGIN_LABEL}</div>
                <div className="sub">
                  Your phone reaches this computer only while OpenShore is open on it.
                </div>
              </div>
              <Switch
                checked={login.on}
                label={LAUNCH_AT_LOGIN_LABEL}
                onChange={async (next) => {
                  const b = bridge();
                  if (!b?.setLaunchAtLogin) return;
                  const result = await b.setLaunchAtLogin(next);
                  setLogin((l) => (l ? { ...l, on: result.on } : l));
                  if (result.detail && result.on !== next) showToast(result.detail);
                }}
              />
            </div>
          ) : null}
        </div>

        <PlusNote
          feature="pairing"
          line="Reaching this computer from your phone is part of OpenShore Plus. Chat on each device, with its own models or your keys, stays free."
        />

        {pairOpen && info?.running && qr ? (
          qrFolded ? (
            <button
              type="button"
              className="btn ghost press-fb"
              style={{ width: '100%', marginBottom: 12 }}
              onClick={() => {
                setQrFolded(false);
                setJustPaired(undefined);
              }}
            >
              Pair another phone
            </button>
          ) : (
            <div className="card" style={{ textAlign: 'center' }}>
              <h3>Scan this with your phone</h3>
              <div className="sub" style={{ marginBottom: 12 }}>
                {SCAN_HOW}
              </div>
              <img src={qr} alt="Pairing QR code" className="pair-qr-img" />
              <div className="sub" style={{ marginTop: 12, wordBreak: 'break-all' }}>
                Address: http://{info.host}:{info.port}
              </div>
              <button
                className="hint press-fb"
                onClick={() => setShowToken((s) => !s)}
                style={{ marginTop: 6 }}
              >
                {showToken ? `Pairing code: ${info.claim}` : 'Show the pairing code'}
              </button>
              {showToken ? (
                <div className="sub" style={{ marginTop: 6 }}>
                  A one-time code, good for five minutes and only on your Tailscale network. The
                  phone trades it for its own credential, so it is never a lasting key.
                </div>
              ) : null}
            </div>
          )
        ) : null}

        {info?.devices && info.devices.length > 0 ? (
          <div className="card">
            <h3>Paired devices</h3>
            <div className="sub" style={{ marginBottom: 12 }}>
              Each paired phone gets its own credential. Lost a phone? Revoke just that one. The
              rest stay connected.
            </div>
            {info.devices.map((d) => (
              <div key={d.id} className="card-row" style={{ alignItems: 'center' }}>
                <div className="grow">
                  <div>{d.label}</div>
                  <div className="sub">
                    Paired {pairedWhen(d.createdAt)}
                    {d.expiresAt ? ` · expires ${new Date(d.expiresAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <button
                  className="btn ghost press-fb"
                  style={{ padding: '8px 14px' }}
                  onClick={() => setRevoking({ id: d.id, label: d.label })}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <Sheet open={Boolean(revoking)} onClose={() => setRevoking(undefined)} variant="confirm">
          <h3>Revoke {revoking?.label ?? 'this device'}?</h3>
          <p>It can no longer reach this computer, and anything it has open is cut off.</p>
          <div className="confirm-row">
            <button
              type="button"
              className="btn ghost press-fb"
              onClick={() => setRevoking(undefined)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn danger press-fb"
              onClick={async () => {
                const b = bridge();
                const target = revoking;
                setRevoking(undefined);
                if (!b || !target) return;
                await b.revokeDeviceCredential(target.id);
                showToast(`${target.label} revoked. It can no longer connect.`);
                await refresh();
              }}
            >
              Revoke
            </button>
          </div>
        </Sheet>

        <p className="hint">
          Both devices sign in to the same Tailscale account, free for personal use. Work started
          from the phone always asks before commands and cloud spend.
        </p>

        {/* The expert tools, folded away from a first pairing (CX 2026-10-01). */}
        <button
          type="button"
          className="linklike press-fb"
          aria-expanded={more}
          onClick={() => setMore((m) => !m)}
        >
          {more ? 'Fewer options' : 'More options'}
        </button>
        {more ? (
          <>
            {bridge()?.rotateSharedToken ? (
              <ReplaceSharedKey rotate={() => bridge()!.rotateSharedToken!()} onToast={showToast} />
            ) : null}
            <RemoteHubPanel />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The switch that keeps phone access honest: "while your computer is on"
 *  means while OpenShore is open on it. */
export const LAUNCH_AT_LOGIN_LABEL = 'Open OpenShore when this computer starts';

/** How to scan, on the desktop's QR card. */
export const SCAN_HOW =
  'On your iPhone, point the Camera at this code, or open OpenShore, then Menu, Pairing, Scan.';

/** When a device paired, to the minute, so two phones are told apart. */
function pairedWhen(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** This desktop's Tailscale download row, by the page's own platform. */
function thisDesktopOs(): 'macOS' | 'Windows' | 'Linux' | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return 'macOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return undefined;
}

// On a desktop that is not your central computer (a laptop away from the hub):
// point it at a remote hub and it runs sessions there over the tailnet, the way
// the phone does, instead of on this machine. Off by default, so a desktop stays
// its own engine unless you say otherwise.
function RemoteHubPanel() {
  const { settings, saveHub, setPreferRemoteHub, showToast, requirePersonal } = useApp();
  const [address, setAddress] = useState(settings.daemon?.baseUrl ?? '');
  const [token, setToken] = useState(settings.daemon?.token ?? '');
  const [testing, setTesting] = useState(false);
  const [state, setState] = useState<string | undefined>();
  const prefer = settings.preferRemoteHub === true;

  const connect = async () => {
    const baseUrl = address.trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(baseUrl) || !token.trim()) {
      setState("Enter the other computer's address and its access key.");
      return;
    }
    // Connecting to another computer is Pairing's paid moment too.
    if (!requirePersonal('pairing')) return;
    setTesting(true);
    const health = await daemonHealth({ baseUrl, token: token.trim() });
    setTesting(false);
    setState(health.detail);
    if (health.ok) {
      // The hub's /health names this credential's role (admin or member); an
      // older hub says nothing and the daemon decides per request.
      await saveHub(
        { baseUrl, token: token.trim() },
        { role: (health as { role?: HubRole }).role },
      );
      showToast('Connected. This computer now runs sessions on the other one.');
    }
  };

  return (
    <div className="card">
      <div className="card-row">
        <div className="grow">
          <h3 style={{ margin: 0 }}>Run on another computer</h3>
          <div className="sub">
            {prefer
              ? 'On. This computer runs sessions on the computer below, not on itself.'
              : 'Off. This computer is its own engine. Turn on to run on another computer.'}
          </div>
        </div>
        <Switch
          checked={prefer}
          label="Run on another computer"
          onChange={(next) => void setPreferRemoteHub(next)}
        />
      </div>

      {prefer ? (
        <>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="pair-hub-address">Address</label>
            <input
              id="pair-hub-address"
              placeholder="http://100.x.y.z:4816"
              value={address}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="pair-hub-key">Access key</label>
            <input
              id="pair-hub-key"
              placeholder="osc_..."
              value={token}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <button
            className="btn primary press-fb"
            style={{ width: '100%' }}
            disabled={testing}
            onClick={() => void connect()}
          >
            {testing ? 'Checking...' : 'Connect to the other computer'}
          </button>
          {state ? (
            <p className="hint" style={{ marginTop: 10 }}>
              {state}
            </p>
          ) : null}
          <HubList />
        </>
      ) : null}
    </div>
  );
}

/** What this device calls itself on the computer's Paired devices list. */
export function phoneDeviceName(): string {
  if (isDesktop()) return 'a computer';
  if (typeof navigator === 'undefined') return 'iPhone';
  // An iPad on iPadOS 13 or later reports itself as a Mac with touch.
  const ua = navigator.userAgent;
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  return iPad ? 'iPad' : 'iPhone';
}

/** A short pause before the one retry of a health check that followed a
 *  good pairing (a first Tailscale link through a relay can be slow). */
const HEALTH_RETRY_MS = 2000;

function PhonePair() {
  const { settings, saveHub, removeHub, showToast, startGuideChat, setView, requirePersonal } =
    useApp();
  const pairOffer = useApp((s) => s.pairOffer);
  const clearPairOffer = useApp((s) => s.clearPairOffer);
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [testing, setTesting] = useState(false);
  const [state, setState] = useState<string | undefined>();
  const [scanning, setScanning] = useState(false);
  const [typing, setTyping] = useState(false);
  // The connected moment itself, separate from `state`'s text: a settled pill
  // pop, not another line of hint copy. Cleared the instant the fields change
  // again, so it never lingers as a stale claim of success once someone is
  // clearly pairing a different desktop.
  const [connected, setConnected] = useState(false);
  const paired = settings.daemon;

  const tryPasteJson = (text: string) => {
    const pair = parsePairingQr(text);
    if (!pair) return false;
    setAddress(pair.address);
    setCode(pair.claim);
    return true;
  };

  // Connect with the fields as they stand, or with values handed in directly
  // (a fresh QR scan, before React has re-rendered the inputs). The code is a
  // one-time pairing claim: we trade it for this device's own credential and
  // save it at once (a spent claim is never thrown away), then check it.
  const connect = async (override?: { address: string; claim: string }) => {
    const rawAddress = override?.address ?? address;
    const rawClaim = override?.claim ?? code;
    const baseUrl = rawAddress.trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(baseUrl) || !rawClaim.trim()) {
      setState("Enter the address and the pairing code shown on your computer's Pairing screen.");
      return;
    }
    // The paid moment, before the one-time code is spent: a claim traded and
    // then refused would leave a device on the computer this phone never saved.
    if (!requirePersonal('pairing')) return;
    setTesting(true);
    setConnected(false);
    setState(undefined);
    const claimed = await redeemPairClaim(baseUrl, rawClaim.trim(), phoneDeviceName());
    if (!claimed.ok) {
      setTesting(false);
      setState(claimed.detail);
      return;
    }
    const token = claimed.token;
    // Saved before any check (pairing review, CX 2026-10-01): the claim is
    // spent and the computer holds this phone's credential now, so a slow
    // first check must not throw the token away and leave a row on the
    // computer nothing uses.
    await saveHub({ baseUrl, token }, { role: claimed.role });
    let health = await daemonHealth({ baseUrl, token });
    if (!health.ok && health.detail !== PAIRING_REJECTED) {
      await new Promise((r) => setTimeout(r, HEALTH_RETRY_MS));
      health = await daemonHealth({ baseUrl, token });
    }
    setTesting(false);
    if (health.ok) {
      setState(undefined);
      setConnected(true);
      setTyping(false);
      hapticApproval();
      showToast('Connected. Your computer is in the model menu, and its terminal is one tap away.');
    } else {
      setState(
        health.detail === PAIRING_REJECTED
          ? health.detail
          : 'Paired. Your computer did not answer the first check, so it may still be waking up. It connects on its own once it answers.',
      );
    }
  };

  // A scanned QR fills both fields and connects in one motion. A QR that is
  // not a pairing code keeps the camera open and says so in the sheet.
  const onScanned = (text: string): boolean => {
    const pair = parsePairingQr(text);
    if (!pair) return false;
    setConnected(false);
    setAddress(pair.address);
    setCode(pair.claim);
    void connect(pair);
    return true;
  };

  // Any further edit to either field walks away from the settled "Connected"
  // pill: it answered for the pairing that was on screen a moment ago, not
  // whatever gets typed next.
  const editAddress = (value: string) => {
    setConnected(false);
    if (!tryPasteJson(value)) setAddress(value);
  };
  const editCode = (value: string) => {
    setConnected(false);
    if (!tryPasteJson(value)) setCode(value);
  };

  return (
    <div className="screen">
      <BackBar title={ROOM_LABELS.pair} />
      <div className="screen-inner">
        <h1>Connect your computer</h1>
        <p className="lead">
          One time, two minutes. Then your own model runs on your computer and you reach it from
          here, over your private network. Your computer does the work, so a long task keeps going
          even when you close the app.
        </p>

        {paired ? <ConnectedCard onTerminal={() => setView('terminalroom')} /> : null}

        {!paired ? (
          <button
            className="btn ghost press-fb"
            style={{ width: '100%', marginBottom: 12 }}
            onClick={() => void startGuideChat('pair-computer')}
          >
            Walk me through it
          </button>
        ) : null}

        <PlusNote
          feature="pairing"
          line="Reaching your computer from this phone is part of OpenShore Plus: chats with its models, coding, and its shell. Chat on this phone stays free."
        />

        {!paired ? (
          <div className="card">
            <h3>Before you scan</h3>
            <div className="sub">
              1. Install Tailscale on both devices and sign in to the same account.
              <br />
              2. On your computer, open OpenShore, then Pairing. The QR is there (if it says Off,
              tap Turn on).
            </div>
            <div className="sub" style={{ marginTop: 12 }}>
              Get Tailscale (free for personal use):{' '}
              <button
                className="linklike press-fb"
                onClick={() => void startGuideChat('install-tailscale')}
              >
                walk me through Tailscale
              </button>
            </div>
            <div className="dl-list">
              {TAILSCALE_LINKS.map((l) => (
                <a
                  key={l.label}
                  className="dl-item"
                  href={l.href}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <span className="dl-tile">{GLYPHS[l.glyph]}</span>
                  <span className="dl-name">{l.label}</span>
                  <span className="dl-get">GET</span>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        <div className="card">
          <button
            className="btn primary press-fb"
            style={{ width: '100%' }}
            disabled={testing}
            aria-busy={testing}
            onClick={() => {
              // The paywall before the camera, never after a scan.
              if (requirePersonal('pairing')) setScanning(true);
            }}
          >
            {testing
              ? 'Connecting to your computer...'
              : paired
                ? 'Scan to pair another computer'
                : 'Scan the QR on your computer'}
          </button>
          <QrScanner open={scanning} onDecode={onScanned} onClose={() => setScanning(false)} />
          {connected ? (
            <div className="pair-next">
              <p className="hint" style={{ margin: 0 }}>
                <span className="pill ok pill-pop">Paired</span> Pick your computer in the model
                menu to chat or code, or go straight to its shell.
              </p>
              <button
                className="btn press-fb"
                style={{ width: '100%', marginTop: 10 }}
                onClick={() => setView('terminalroom')}
              >
                Open a terminal on your computer
              </button>
            </div>
          ) : state ? (
            <p className="hint" role="status" style={{ marginTop: 10 }}>
              {state}
            </p>
          ) : null}

          <button
            type="button"
            className="linklike press-fb"
            style={{ marginTop: 12 }}
            aria-expanded={typing}
            onClick={() => setTyping((t) => !t)}
          >
            {typing ? 'Hide the typed entry' : "Can't scan? Type it in"}
          </button>
          {typing ? (
            <div style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor="pair-phone-address">Address</label>
                <input
                  id="pair-phone-address"
                  placeholder="Shown under the QR on your computer"
                  value={address}
                  autoCapitalize="none"
                  autoCorrect="off"
                  onChange={(e) => editAddress(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="pair-phone-code">Pairing code</label>
                <input
                  id="pair-phone-code"
                  placeholder="Tap Show the pairing code on your computer"
                  value={code}
                  autoCapitalize="none"
                  autoCorrect="off"
                  onChange={(e) => editCode(e.target.value)}
                />
              </div>
              <button
                className="btn primary press-fb"
                style={{ width: '100%' }}
                disabled={testing}
                onClick={() => void connect()}
              >
                {testing ? 'Connecting to your computer...' : 'Connect'}
              </button>
            </div>
          ) : null}
        </div>

        <HubList />

        {paired ? (
          <button
            className="btn quiet press-fb"
            style={{ width: '100%' }}
            onClick={async () => {
              await removeHub(paired.baseUrl);
              setState(undefined);
              setConnected(false);
              showToast('Computer forgotten on this phone. It no longer lists this phone either.');
            }}
          >
            Forget this computer
          </button>
        ) : null}

        {/* A pairing link opened from outside (the iPhone Camera read the
            computer's QR): ask first, never pair on a link alone. */}
        <Sheet open={Boolean(pairOffer)} onClose={clearPairOffer} variant="confirm">
          <h3>Pair with this computer?</h3>
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
              Pair
            </button>
          </div>
        </Sheet>
      </div>
    </div>
  );
}

/** The host of a computer's address, for a name a person can read. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

/** The paired computer, live (CX 2026-10-01): who it is and whether it
 *  answers right now, so the screen after pairing never looks like the
 *  screen before it. */
function ConnectedCard({ onTerminal }: { onTerminal: () => void }) {
  const daemon = useApp((s) => s.settings.daemon);
  const [reach, setReach] = useState<'checking' | 'yes' | 'no' | 'refused'>('checking');
  useEffect(() => {
    if (!daemon) return;
    let alive = true;
    const check = async () => {
      const h = await daemonHealth(daemon);
      if (!alive) return;
      setReach(h.ok ? 'yes' : h.detail === PAIRING_REJECTED ? 'refused' : 'no');
    };
    void check();
    const t = setInterval(() => void check(), 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [daemon]);
  if (!daemon) return null;
  const name = daemon.name?.trim() || hostOf(daemon.baseUrl);
  return (
    <div className="card">
      <div className="card-row" style={{ alignItems: 'center' }}>
        <div className="grow">
          <h3 style={{ margin: 0 }}>Connected to {name}</h3>
          <div className="sub">
            {reach === 'refused'
              ? PAIRING_REJECTED
              : reach === 'no'
                ? 'Not reachable right now. Check that it is awake with OpenShore open.'
                : 'Your computer runs the work; this phone reaches it.'}
          </div>
        </div>
        <span className={`pill ${reach === 'yes' ? 'ok' : 'muted'}`}>
          {reach === 'yes'
            ? 'Reachable'
            : reach === 'checking'
              ? 'Checking'
              : reach === 'refused'
                ? 'Pair again'
                : 'Not reachable'}
        </span>
      </div>
      {reach === 'yes' ? (
        <button
          className="btn press-fb"
          style={{ width: '100%', marginTop: 12 }}
          onClick={onTerminal}
        >
          Open a terminal on your computer
        </button>
      ) : null}
    </div>
  );
}

// The saved hubs, for switching between more than one central computer. Shown
// only once a second hub exists, so a single-computer setup never sees it. The
// active one is marked; tapping another switches sessions to it, and each can
// be named or forgotten.
function HubList() {
  const { settings, selectHub, removeHub, showToast } = useApp();
  // The computer being named, while its sheet is open.
  const [naming, setNaming] = useState<{ baseUrl: string; name?: string; host: string }>();
  const hubs = hubList(settings);
  if (hubs.length < 2) return null;
  const activeUrl = settings.daemon?.baseUrl;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Your computers</h3>
      <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        Switch which computer your sessions and terminal run on.
      </p>
      {hubs.map((h) => {
        const active = h.baseUrl === activeUrl;
        let host = h.baseUrl;
        try {
          host = new URL(h.baseUrl).hostname;
        } catch {}
        return (
          <div className="card-row" key={h.baseUrl} style={{ alignItems: 'center' }}>
            <button
              className="linklike grow press-fb"
              style={{ textAlign: 'left' }}
              disabled={active}
              onClick={() => void selectHub(h.baseUrl)}
            >
              <span style={{ fontWeight: 600 }}>{h.name?.trim() || host}</span>
              {h.name?.trim() ? <span className="sub"> {host}</span> : null}
            </button>
            {active ? <span className="pill ok">active</span> : null}
            <button
              className="linklike press-fb"
              onClick={() => setNaming({ baseUrl: h.baseUrl, name: h.name, host })}
            >
              rename
            </button>
            <button
              className="linklike press-fb"
              onClick={() => {
                void removeHub(h.baseUrl);
                showToast('Computer forgotten on this device.');
              }}
            >
              forget
            </button>
          </div>
        );
      })}
      <Sheet open={Boolean(naming)} onClose={() => setNaming(undefined)}>
        {naming ? (
          <HubNameForm key={naming.baseUrl} hub={naming} onDone={() => setNaming(undefined)} />
        ) : null}
      </Sheet>
    </div>
  );
}

// Naming a computer: one field, Save and Cancel, the Vault rename sheet's
// shape. (window.prompt did this before; Electron never implements it, so the
// desktop's rename did nothing.) An empty name goes back to the address.
function HubNameForm({
  hub,
  onDone,
}: {
  hub: { baseUrl: string; name?: string; host: string };
  onDone: () => void;
}) {
  const { renameHub } = useApp();
  const [name, setName] = useState(hub.name ?? '');
  const save = () => {
    void renameHub(hub.baseUrl, name);
    onDone();
  };
  return (
    <>
      <SheetHead title="Name this computer" onClose={onDone} />
      <div className="field">
        <label htmlFor="pair-hub-name">Name</label>
        <input
          id="pair-hub-name"
          autoFocus
          value={name}
          placeholder={hub.host}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
        />
      </div>
      <div className="sheet-actions">
        <button type="button" className="btn primary press-fb" onClick={save}>
          Save
        </button>
        <button type="button" className="btn quiet press-fb" onClick={onDone}>
          Cancel
        </button>
      </div>
    </>
  );
}
