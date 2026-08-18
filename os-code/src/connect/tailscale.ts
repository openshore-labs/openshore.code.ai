// Tailscale detection. OS Code orchestrates Tailscale, it does not embed it:
// detect the CLI, read tailnet status, and find the address the daemon should
// bind. Nothing here installs or configures the tailnet itself.
import { spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  /** This machine's tailnet IPv4, when up. */
  ip?: string;
  /** MagicDNS name, e.g. desktop.tailnet-name.ts.net. */
  dnsName?: string;
  /** Human hint for whatever is wrong. */
  hint?: string;
}

export function detectTailscale(): TailscaleStatus {
  const version = spawnSync('tailscale', ['version'], { encoding: 'utf8', timeout: 4000 });
  if (version.status !== 0) {
    return {
      installed: false,
      running: false,
      hint: 'Tailscale is not installed. Install it with: curl -fsSL https://tailscale.com/install.sh | sh',
    };
  }
  const status = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 4000 });
  if (status.status !== 0) {
    return {
      installed: true,
      running: false,
      hint: 'Tailscale is installed but not responding. Start it with: sudo tailscale up',
    };
  }
  try {
    const body = JSON.parse(status.stdout) as {
      BackendState?: string;
      Self?: { TailscaleIPs?: string[]; DNSName?: string };
    };
    if (body.BackendState !== 'Running') {
      return {
        installed: true,
        running: false,
        hint: `Tailscale is ${body.BackendState ?? 'stopped'}. Bring it up with: sudo tailscale up`,
      };
    }
    const ip = body.Self?.TailscaleIPs?.find((a) => a.startsWith('100.'));
    const dnsName = body.Self?.DNSName?.replace(/\.$/, '');
    return { installed: true, running: true, ip, dnsName };
  } catch {
    return { installed: true, running: false, hint: 'Could not read tailscale status output.' };
  }
}

/** The tailnet interface address, from the CLI or the interface table. */
export function tailscaleIp(): string | undefined {
  const viaCli = spawnSync('tailscale', ['ip', '-4'], { encoding: 'utf8', timeout: 4000 });
  if (viaCli.status === 0) {
    const ip = viaCli.stdout.trim().split('\n')[0];
    if (ip?.startsWith('100.')) return ip;
  }
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(addr.address)) {
        return addr.address;
      }
    }
  }
  return undefined;
}
