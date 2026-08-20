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

// Tailscale download links, shown on the phone pairing screen so a new user can
// install it on their desktop without hunting. Desktop platforms use Tailscale's
// own per-OS download pages; mobile points at the app stores.
const TAILSCALE_LINKS: { label: string; href: string }[] = [
  { label: 'macOS', href: 'https://tailscale.com/download/macos' },
  { label: 'Windows', href: 'https://tailscale.com/download/windows' },
  { label: 'Linux', href: 'https://tailscale.com/download/linux' },
  { label: 'iPhone / iPad', href: 'https://apps.apple.com/app/tailscale/id1470499037' },
  { label: 'Android', href: 'https://play.google.com/store/apps/details?id=com.tailscale.ipn' },
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
    if (next.running && next.host) {
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
                  ? `Serving on ${info.host}:${info.port} over the tailnet.`
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
              OS Code on iPhone: Menu, Desktop + phone, then paste or scan.
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

  const tryPasteJson = (text: string) => {
    try {
      const parsed = JSON.parse(text) as { u?: string; t?: string };
      if (parsed.u && parsed.t) {
        setAddress(parsed.u);
        setToken(parsed.t);
        return true;
      }
    } catch {}
    return false;
  };

  const connect = async () => {
    const baseUrl = address.trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(baseUrl) || !token.trim()) {
      setState('Enter the address and token shown on the desktop pairing screen.');
      return;
    }
    setTesting(true);
    const health = await daemonHealth({ baseUrl, token: token.trim() });
    setTesting(false);
    setState(health.detail);
    if (health.ok) {
      await saveSettings({ daemon: { baseUrl, token: token.trim() } });
      showToast('Connected. Your desktop stack is now in the model picker.');
    }
  };

  return (
    <div className="screen">
      <BackBar title="Desktop connection" />
      <div className="screen-inner">
        <h1>Connect your desktop</h1>
        <p className="lead">
          One time, two minutes. Then every model and repo on your desktop works from here, over
          your own private network.
        </p>

        <div className="card">
          <h3>Before this screen</h3>
          <div className="sub">
            1. Install Tailscale on both devices and sign into the same tailnet.
            <br />
            2. In OS Code on the desktop: Menu, Desktop + phone, Turn on.
          </div>
          <div className="sub" style={{ marginTop: 12 }}>
            Get Tailscale (free for personal use):
          </div>
          <div className="dl-row">
            {TAILSCALE_LINKS.map((l) => (
              <a
                key={l.label}
                className="dl-chip"
                href={l.href}
                target="_blank"
                rel="noreferrer noopener"
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>

        <div className="card">
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
