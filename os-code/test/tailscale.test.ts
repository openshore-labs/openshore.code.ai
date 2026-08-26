// Tailscale detection (TS-P2-8, TS-P2-12). A real tailnet is never present in
// CI, so spawnSync and networkInterfaces are mocked to stand in for the CLI and
// the interface table. The cases pin the macOS-shaped behavior (app-path binary,
// CLI-missing-but-interface-up) and the CGNAT range alignment.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type SpawnResult = { error?: Error; status: number | null; stdout: string; stderr: string };
type SpawnFn = (cmd: string, args: readonly string[]) => SpawnResult;
type NetFn = () => Record<string, Array<{ family: string; address: string; internal: boolean }>>;

const enoent: SpawnResult = { error: new Error('ENOENT'), status: null, stdout: '', stderr: '' };

const h = vi.hoisted(() => {
  return {
    spawnImpl: (() => enoent) as SpawnFn,
    netImpl: (() => ({})) as NetFn,
  };
});

vi.mock('node:child_process', () => ({
  spawnSync: (cmd: string, args: readonly string[]) => h.spawnImpl(cmd, args),
}));
vi.mock('node:os', () => ({
  networkInterfaces: () => h.netImpl(),
}));

import { detectTailscale, tailscaleIp } from '../src/connect/tailscale.js';

const MAC_BIN = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

function iface(address: string): NetFn {
  return () => ({ utun3: [{ family: 'IPv4', address, internal: false }] });
}

beforeEach(() => {
  h.spawnImpl = () => enoent;
  h.netImpl = () => ({});
});

describe('detectTailscale (TS-P2-8 macOS)', () => {
  it('finds the CLI at the macOS app path when it is not on PATH', () => {
    h.spawnImpl = (cmd, args) => {
      if (cmd === 'tailscale') return enoent; // not on PATH, as under a launched GUI app
      if (cmd === MAC_BIN) {
        if (args[0] === 'version') return { status: 0, stdout: '1.80.0\n', stderr: '' };
        if (args[0] === 'status') {
          return {
            status: 0,
            stdout: JSON.stringify({
              BackendState: 'Running',
              Self: {
                TailscaleIPs: ['100.101.102.103', 'fd7a::1'],
                DNSName: 'desktop.tail1234.ts.net.',
              },
            }),
            stderr: '',
          };
        }
      }
      return enoent;
    };
    const s = detectTailscale();
    expect(s.installed).toBe(true);
    expect(s.running).toBe(true);
    expect(s.ip).toBe('100.101.102.103');
    expect(s.dnsName).toBe('desktop.tail1234.ts.net');
  });

  it('reports running when the CLI is missing but a 100.64/10 address is on an interface', () => {
    // No CLI on any candidate path, utun still carries the tailnet address.
    h.spawnImpl = () => enoent;
    h.netImpl = iface('100.64.5.6');
    const s = detectTailscale();
    expect(s.installed).toBe(true);
    expect(s.running).toBe(true);
    expect(s.ip).toBe('100.64.5.6');
    expect(tailscaleIp()).toBe('100.64.5.6');
  });

  it('reports not installed when no CLI and no CGNAT address are present', () => {
    h.spawnImpl = () => enoent;
    h.netImpl = () => ({});
    const s = detectTailscale();
    expect(s.installed).toBe(false);
    expect(s.running).toBe(false);
    expect(tailscaleIp()).toBeUndefined();
  });
});

describe('CGNAT alignment (TS-P2-12)', () => {
  it('does not treat a non-tailnet 100.200.x address as the tailnet', () => {
    // Interface has a 100.x address outside 100.64/10.
    h.spawnImpl = () => enoent;
    h.netImpl = iface('100.200.1.1');
    expect(detectTailscale().running).toBe(false);
    expect(tailscaleIp()).toBeUndefined();
  });

  it('rejects a non-CGNAT 100.x address returned by the CLI', () => {
    h.spawnImpl = (_cmd, args) => {
      if (args[0] === 'ip') return { status: 0, stdout: '100.200.1.1\n', stderr: '' };
      return enoent;
    };
    h.netImpl = () => ({});
    expect(tailscaleIp()).toBeUndefined();
  });

  it('picks only the CGNAT IP when the CLI lists a non-tailnet 100.x alongside it', () => {
    h.spawnImpl = (_cmd, args) => {
      if (args[0] === 'version') return { status: 0, stdout: '1.0\n', stderr: '' };
      if (args[0] === 'status') {
        return {
          status: 0,
          stdout: JSON.stringify({
            BackendState: 'Running',
            Self: { TailscaleIPs: ['100.200.0.1', '100.96.0.7'] },
          }),
          stderr: '',
        };
      }
      return enoent;
    };
    expect(detectTailscale().ip).toBe('100.96.0.7');
  });

  it('honors the CGNAT boundary: 100.64.x and 100.127.x yes, 100.63.x and 100.128.x no', () => {
    const viaIface = (address: string): string | undefined => {
      h.spawnImpl = () => enoent;
      h.netImpl = iface(address);
      return tailscaleIp();
    };
    expect(viaIface('100.64.0.0')).toBe('100.64.0.0');
    expect(viaIface('100.127.255.255')).toBe('100.127.255.255');
    expect(viaIface('100.63.255.255')).toBeUndefined();
    expect(viaIface('100.128.0.0')).toBeUndefined();
  });
});
