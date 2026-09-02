// Desktop + phone. On the desktop: turn on the connection, show the address,
// token, and a QR. On the phone: paste or scan those in, test, save. The
// daemon owns the run, so a dropped connection reattaches with nothing lost.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useApp } from '../state/store.js';
import { bridge, type DaemonInfo } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { daemonHealth } from '../drivers/remoteDriver.js';
import { BackBar } from '../components/BackBar.js';
import { QrScanner } from '../components/QrScanner.js';
import { parsePairingQr } from '../lib/qrDecode.js';

// Clean white glyphs for the Tailscale download rows, drawn on a solid teal
// tile (iOS-app-icon feel). One per platform.
const GLYPHS: Record<string, JSX.Element> = {
  apple: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#fff"
        d="M15.77 12.9c-.02-2.13 1.74-3.15 1.82-3.2-.99-1.45-2.54-1.65-3.09-1.67-1.31-.13-2.56.77-3.23.77-.66 0-1.69-.75-2.78-.73-1.43.02-2.75.83-3.48 2.11-1.48 2.57-.38 6.38 1.06 8.47.7 1.02 1.54 2.17 2.63 2.13 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.74.66 1.13-.02 1.85-1.04 2.55-2.07.8-1.19 1.13-2.34 1.15-2.4-.03-.01-2.2-.85-2.22-3.36zM13.7 6.3c.58-.7.97-1.68.86-2.65-.83.03-1.84.55-2.44 1.25-.53.62-1 1.61-.88 2.56.93.07 1.88-.47 2.46-1.16z"
      />
    </svg>
  ),
  windows: (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="#fff">
      <rect x="3.5" y="4" width="7.4" height="7.4" rx="0.8" />
      <rect x="13.1" y="4" width="7.4" height="7.4" rx="0.8" />
      <rect x="3.5" y="12.6" width="7.4" height="7.4" rx="0.8" />
      <rect x="13.1" y="12.6" width="7.4" height="7.4" rx="0.8" />
    </svg>
  ),
  linux: (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fff" strokeWidth="1.6">
      <rect x="3" y="5" width="18" height="14" rx="2.2" />
      <path d="M7 10l2.6 2-2.6 2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.4 14.2h4.2" strokeLinecap="round" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fff" strokeWidth="1.6">
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
      <path d="M10.5 5h3" strokeLinecap="round" />
    </svg>
  ),
  android: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#fff" d="M8 8.5a4 4 0 0 1 8 0zM8 9h8v6.4a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z" />
      <rect x="4.6" y="9.6" width="1.8" height="5.4" rx="0.9" fill="#fff" />
      <rect x="17.6" y="9.6" width="1.8" height="5.4" rx="0.9" fill="#fff" />
      <rect x="9.4" y="16" width="1.8" height="3.2" rx="0.9" fill="#fff" />
      <rect x="12.8" y="16" width="1.8" height="3.2" rx="0.9" fill="#fff" />
      <path
        d="M9.2 5.6l1.3 1.9M14.8 5.6l-1.3 1.9"
        stroke="#fff"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="10.3" cy="6.9" r="0.65" fill="var(--local)" />
      <circle cx="13.7" cy="6.9" r="0.65" fill="var(--local)" />
    </svg>
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
  const [info, setInfo] = useState<DaemonInfo | undefined>();
  const [qr, setQr] = useState<string | undefined>();
  const [showToken, setShowToken] = useState(false);

  const refresh = async () => {
    const b = bridge();
    if (!b) return;
    const next = await b.daemonInfo();
    setInfo(next);
    // Only publish a QR the phone can actually reach: a loopback-only fallback
    // (Tailscale down) would hand out an address that points at the phone itself.
    if (next.running && next.host && next.mode !== 'loopback') {
      const payload = JSON.stringify({ u: `http://${next.host}:${next.port}`, t: next.token });
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
    // Poll so starting Tailscale after opening this screen updates the state
    // (the daemon can move from loopback-only to the tailnet without a reload).
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="screen">
      <BackBar title="Desktop + phone" />
      <div className="screen-inner">
        <h1>Put this on your phone</h1>
        <p className="lead">
          Over your own private Tailscale network. The desktop owns the run; the phone can drop into
          a tunnel and reattach with nothing lost.
        </p>

        <div className="card">
          <div className="card-row">
            <div className="grow">
              <h3>Phone connection</h3>
              <div className="sub">
                {info?.running
                  ? info.mode === 'loopback'
                    ? 'On, but only for this machine. Tailscale is not up, so the phone cannot reach it yet. Start it (sudo tailscale up).'
                    : `Serving on ${info.host}:${info.port} over the tailnet.`
                  : info?.tailscaleUp
                    ? 'Off. Turn it on and the phone app can connect.'
                    : 'Tailscale is not up on this machine. Start it (sudo tailscale up), then turn this on.'}
              </div>
            </div>
            <button
              className={`btn ${info?.running ? 'ghost' : 'primary'}`}
              style={{ padding: '8px 14px' }}
              onClick={async () => {
                const b = bridge();
                if (!b) return;
                if (info?.running) {
                  await b.daemonStop();
                } else {
                  const result = await b.daemonStart();
                  if ('error' in result) showToast(result.error);
                }
                await refresh();
              }}
            >
              {info?.running ? 'Turn off' : 'Turn on'}
            </button>
          </div>
        </div>

        {info?.running && qr ? (
          <div className="card" style={{ textAlign: 'center' }}>
            <h3>Scan from the phone app</h3>
            <div className="sub" style={{ marginBottom: 12 }}>
              OpenShore on iPhone: Menu, Desktop + phone, then paste or scan.
            </div>
            <img src={qr} alt="Pairing QR code" style={{ borderRadius: 12 }} />
            <div className="sub" style={{ marginTop: 12, wordBreak: 'break-all' }}>
              Address: http://{info.host}:{info.port}
            </div>
            <button
              className="hint"
              onClick={() => setShowToken((s) => !s)}
              style={{ marginTop: 6 }}
            >
              {showToken ? `Token: ${info.token}` : 'Show the pairing token'}
            </button>
          </div>
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
                    Paired {new Date(d.createdAt).toLocaleDateString()}
                    {d.expiresAt ? ` · expires ${new Date(d.expiresAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <button
                  className="btn ghost"
                  style={{ padding: '8px 14px' }}
                  onClick={async () => {
                    const b = bridge();
                    if (!b) return;
                    await b.revokeDeviceCredential(d.id);
                    showToast('Device revoked. It can no longer connect.');
                    await refresh();
                  }}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <p className="hint">
          Both devices sign into the same tailnet (the Tailscale app, free for personal use). The
          connection needs its own token on top of the tailnet, and phone sessions are stricter than
          desk sessions: shell commands and cloud spend always ask.
        </p>
      </div>
    </div>
  );
}

function PhonePair() {
  const { settings, saveSettings, showToast } = useApp();
  const [address, setAddress] = useState(settings.daemon?.baseUrl ?? '');
  const [token, setToken] = useState(settings.daemon?.token ?? '');
  const [testing, setTesting] = useState(false);
  const [state, setState] = useState<string | undefined>();
  const [scanning, setScanning] = useState(false);

  const tryPasteJson = (text: string) => {
    const pair = parsePairingQr(text);
    if (!pair) return false;
    setAddress(pair.address);
    setToken(pair.token);
    return true;
  };

  // Connect with the fields as they stand, or with values handed in directly
  // (a fresh QR scan, before React has re-rendered the inputs).
  const connect = async (override?: { address: string; token: string }) => {
    const rawAddress = override?.address ?? address;
    const rawToken = override?.token ?? token;
    const baseUrl = rawAddress.trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(baseUrl) || !rawToken.trim()) {
      setState('Enter the address and token shown on the desktop pairing screen.');
      return;
    }
    setTesting(true);
    const health = await daemonHealth({ baseUrl, token: rawToken.trim() });
    setTesting(false);
    setState(health.detail);
    if (health.ok) {
      await saveSettings({ daemon: { baseUrl, token: rawToken.trim() } });
      showToast('Connected. Pick your computer in the model menu to chat or code.');
    }
  };

  // A scanned QR fills both fields and connects in one motion; a QR that is
  // not a pairing code is reported, never half-applied.
  const onScanned = (text: string) => {
    const pair = parsePairingQr(text);
    if (!pair) {
      setState('That QR is not an OpenShore pairing code. Try the one on the desktop screen.');
      return;
    }
    setAddress(pair.address);
    setToken(pair.token);
    void connect(pair);
  };

  return (
    <div className="screen">
      <BackBar title="Desktop connection" />
      <div className="screen-inner">
        <h1>Connect your computer</h1>
        <p className="lead">
          One time, two minutes. Then your own model runs on your machine and you reach it from
          here, over your private network. Your computer does the work, so a long task keeps going
          even when you close the app.
        </p>

        <div className="card">
          <h3>Before this screen</h3>
          <div className="sub">
            1. Install Tailscale on both devices and sign into the same tailnet.
            <br />
            2. In OpenShore on the desktop: Menu, Desktop + phone, Turn on.
          </div>
          <div className="sub" style={{ marginTop: 12 }}>
            Get Tailscale (free for personal use):
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

        <div className="card">
          <button
            className="btn primary press-fb"
            style={{ width: '100%', marginBottom: 12 }}
            disabled={testing}
            onClick={() => setScanning(true)}
          >
            Scan the QR on your computer
          </button>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            Or type the address and token it shows.
          </p>
          <div className="field">
            <label>Desktop address</label>
            <input
              placeholder="http://100.x.y.z:4816"
              value={address}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => {
                if (!tryPasteJson(e.target.value)) setAddress(e.target.value);
              }}
            />
          </div>
          <div className="field">
            <label>Pairing token</label>
            <input
              placeholder="osc_..."
              value={token}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => {
                if (!tryPasteJson(e.target.value)) setToken(e.target.value);
              }}
            />
          </div>
          <button
            className="btn primary"
            style={{ width: '100%' }}
            disabled={testing}
            onClick={() => void connect()}
          >
            {testing ? 'Checking...' : 'Connect'}
          </button>
          {scanning ? <QrScanner onDecode={onScanned} onClose={() => setScanning(false)} /> : null}
          {state ? (
            <p className="hint" style={{ marginTop: 10 }}>
              {state}
            </p>
          ) : null}
          <p className="hint" style={{ marginTop: 10 }}>
            Tip: pasting the whole QR text into either field fills both.
          </p>
        </div>

        {settings.daemon ? (
          <button
            className="btn quiet"
            style={{ width: '100%' }}
            onClick={async () => {
              await saveSettings({ daemon: undefined });
              setState(undefined);
              showToast('Desktop disconnected on this phone.');
            }}
          >
            Forget this desktop
          </button>
        ) : null}
      </div>
    </div>
  );
}
