// Tailscale detection. OS Code orchestrates Tailscale, it does not embed it:
// detect the CLI, read tailnet status, and find the address the daemon should
// bind. Nothing here installs or configures the tailnet itself.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
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

// Candidate CLI locations, tried in order. Bare `tailscale` covers Linux and
// any shell that has it on PATH; the app path covers macOS, where the GUI app
// bundles the CLI and does not put it on the PATH a launched app inherits.
const TAILSCALE_BINARIES = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];

// Run a tailscale subcommand against the first candidate binary that actually
// exists. A missing binary sets `error` (ENOENT) and leaves `status` null, so
// we skip it and try the next. Returns undefined when no candidate ran.
function runTailscale(args: string[]): SpawnSyncReturns<string> | undefined {
  for (const bin of TAILSCALE_BINARIES) {
    const res = spawnSync(bin, args, { encoding: 'utf8', timeout: 4000 });
    if (!res.error) return res;
  }
  return undefined;
}

// True when the address sits in Tailscale's 100.64.0.0/10 CGNAT range
// (100.64.0.0 through 100.127.255.255). A non-tailnet 100.x address, e.g.
// 100.200.x, is not the tailnet and must not be mistaken for it.
function isCgnatAddress(ip: string): boolean {
  const match = /^100\.(\d{1,3})\./.exec(ip);
  if (!match) return false;
  const secondOctet = Number(match[1]);
  return secondOctet >= 64 && secondOctet <= 127;
}

// The first CGNAT IPv4 on any interface. On macOS the utun interface carries
// the tailnet address even when the CLI is not on PATH, so this doubles as a
// running-detector when the CLI cannot be found.
function interfaceCgnatIp(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && isCgnatAddress(addr.address)) {
        return addr.address;
      }
    }
  }
  return undefined;
}

function installHint(): string {
  return process.platform === 'darwin'
    ? 'Tailscale is not installed. Install it from the Mac App Store.'
    : 'Tailscale is not installed. Install it with: curl -fsSL https://tailscale.com/install.sh | sh';
}

export function detectTailscale(): TailscaleStatus {
  const version = runTailscale(['version']);
  if (!version || version.status !== 0) {
    // No CLI on any candidate path. On macOS the CLI can be missing from PATH
    // while the tailnet is up, so fall back to the interface table: a
    // 100.64/10 address on a utun means the tailnet is carrying us right now.
    const ip = interfaceCgnatIp();
    if (ip) {
      return { installed: true, running: true, ip };
    }
    return { installed: false, running: false, hint: installHint() };
  }
  const status = runTailscale(['status', '--json']);
  if (!status || status.status !== 0) {
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
    const ip = body.Self?.TailscaleIPs?.find((a) => isCgnatAddress(a));
    const dnsName = body.Self?.DNSName?.replace(/\.$/, '');
    return { installed: true, running: true, ip, dnsName };
  } catch {
    return { installed: true, running: false, hint: 'Could not read tailscale status output.' };
  }
}

/** The tailnet interface address, from the CLI or the interface table. */
export function tailscaleIp(): string | undefined {
  const viaCli = runTailscale(['ip', '-4']);
  if (viaCli && viaCli.status === 0) {
    const ip = viaCli.stdout.trim().split('\n')[0];
    if (ip && isCgnatAddress(ip)) return ip;
  }
  return interfaceCgnatIp();
}
