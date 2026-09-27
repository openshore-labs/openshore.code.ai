// What counts as this computer's own network (Vault M5, CTO J2): every rule
// of `hostIsLocal`, by address and never by label, the J2 cases (only this
// person's own tailnet is local; another tailnet's Funnel host, 0.0.0.0,
// link-local IPv4, fc00::/7 outside fd, and IPv4-mapped IPv6 read remote),
// the tailnet suffix reader, and the hand-rolled literal parsers checked
// against `node:net`'s `isIP`, which the pure core cannot import.
import { isIP } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  hostIsLocal,
  isIPv4Literal,
  isIPv6Literal,
  tailnetSuffixOf,
} from '../src/harness/locality.js';
import { isLocalHost } from '../src/core/security/egress.js';
import { setOwnTailnetSuffixForTests } from '../src/connect/tailscale.js';

const OWN = { ownTailnetSuffix: 'tail1234.ts.net' };

describe('hostIsLocal: names', () => {
  it('calls localhost and its subdomains local, in any case, with a trailing dot', () => {
    for (const h of ['localhost', 'LOCALHOST', 'localhost.', 'app.localhost', 'a.b.localhost']) {
      expect(hostIsLocal(h), h).toBe(true);
    }
  });

  it('calls mDNS .local names local', () => {
    for (const h of ['mac.local', 'Studio.LOCAL', 'printer.office.local.']) {
      expect(hostIsLocal(h), h).toBe(true);
    }
  });

  it('never trusts a name that only starts like a local one', () => {
    for (const h of [
      'localhost.evil.com',
      'local',
      'mylocalhost',
      'evil.localhost.com',
      'mac.local.example.com',
      '10.0.0.1.evil.com',
      '127.0.0.1.nip.io',
      'example.com',
      '',
    ]) {
      expect(hostIsLocal(h), h).toBe(false);
    }
  });
});

describe('hostIsLocal: tailnet names (J2)', () => {
  it('calls a MagicDNS name on this person own tailnet local', () => {
    expect(hostIsLocal('mac.tail1234.ts.net', OWN)).toBe(true);
    expect(hostIsLocal('MAC.Tail1234.TS.NET.', OWN)).toBe(true);
    expect(hostIsLocal('a.b.tail1234.ts.net', OWN)).toBe(true);
  });

  it('calls another tailnet Funnel host remote, since Funnel is the public internet', () => {
    expect(hostIsLocal('box.tail9999.ts.net', OWN)).toBe(false);
    expect(hostIsLocal('evil-tail1234.ts.net', OWN)).toBe(false);
    expect(hostIsLocal('x.eviltail1234.ts.net', OWN)).toBe(false);
  });

  it('calls the bare suffix itself remote: it is not a machine', () => {
    expect(hostIsLocal('tail1234.ts.net', OWN)).toBe(false);
    expect(hostIsLocal('ts.net', OWN)).toBe(false);
  });

  it('calls every ts.net name remote when no tailnet is known', () => {
    for (const opts of [{}, { ownTailnetSuffix: null }, { ownTailnetSuffix: '' }]) {
      expect(hostIsLocal('mac.tail1234.ts.net', opts)).toBe(false);
    }
    expect(hostIsLocal('mac.tail1234.ts.net')).toBe(false);
  });

  it('accepts the suffix with a leading dot, a trailing dot, or in capitals', () => {
    for (const ownTailnetSuffix of ['.tail1234.ts.net', 'tail1234.ts.net.', 'TAIL1234.TS.NET']) {
      expect(hostIsLocal('mac.tail1234.ts.net', { ownTailnetSuffix })).toBe(true);
    }
  });

  it('never lets a bare or foreign suffix open every ts.net host', () => {
    for (const ownTailnetSuffix of ['ts.net', '.ts.net', 'net', 'example.com']) {
      expect(hostIsLocal('box.tail9999.ts.net', { ownTailnetSuffix }), ownTailnetSuffix).toBe(
        false,
      );
    }
  });

  it('ignores the tailnet suffix for any host that is not a ts.net name', () => {
    expect(hostIsLocal('example.com', { ownTailnetSuffix: 'example.com' })).toBe(false);
    expect(hostIsLocal('api.example.com', { ownTailnetSuffix: 'example.com' })).toBe(false);
  });
});

describe('hostIsLocal: IPv4', () => {
  it('calls loopback and the private ranges local, at both ends of each', () => {
    for (const h of [
      '127.0.0.1',
      '127.255.255.255',
      '10.0.0.0',
      '10.255.255.255',
      '192.168.0.1',
      '192.168.255.255',
      '172.16.0.1',
      '172.31.255.255',
    ]) {
      expect(hostIsLocal(h), h).toBe(true);
    }
  });

  it('calls the tailnet CGNAT range 100.64.0.0/10 local, and nothing either side', () => {
    expect(hostIsLocal('100.64.0.1')).toBe(true);
    expect(hostIsLocal('100.100.100.100')).toBe(true);
    expect(hostIsLocal('100.127.255.255')).toBe(true);
    expect(hostIsLocal('100.63.255.255')).toBe(false);
    expect(hostIsLocal('100.128.0.1')).toBe(false);
  });

  it('calls the edges just outside each private range remote', () => {
    for (const h of ['172.15.255.255', '172.32.0.1', '192.169.0.1', '11.0.0.1', '126.0.0.1']) {
      expect(hostIsLocal(h), h).toBe(false);
    }
  });

  it('calls public addresses remote', () => {
    for (const h of ['8.8.8.8', '1.1.1.1', '203.0.113.9']) expect(hostIsLocal(h), h).toBe(false);
  });

  it('calls 0.0.0.0 and link-local 169.254/16 remote (J2)', () => {
    expect(hostIsLocal('0.0.0.0')).toBe(false);
    expect(hostIsLocal('169.254.169.254')).toBe(false);
    expect(hostIsLocal('169.254.0.1')).toBe(false);
  });

  it('never reads a spelling that is not a dotted-decimal literal as an address', () => {
    for (const h of [
      '127.1',
      '0x7f.0.0.1',
      '010.0.0.1',
      '127.000.000.001',
      '10.0.0.256',
      '10.0.0',
    ]) {
      expect(hostIsLocal(h), h).toBe(false);
    }
  });
});

describe('hostIsLocal: IPv6', () => {
  it('calls loopback, unique-local fd, and link-local fe80 local', () => {
    for (const h of ['::1', 'fd00::1', 'fd12:3456:789a::1', 'fe80::1', 'FE80::ABCD']) {
      expect(hostIsLocal(h), h).toBe(true);
    }
  });

  it('strips URL brackets and a zone id before judging (an empty zone too)', () => {
    for (const h of ['[::1]', '[fd00::1]', '[fe80::1%eth0]', 'fe80::1%en0', 'fe80::1%']) {
      expect(hostIsLocal(h), h).toBe(true);
    }
  });

  it('calls fc00::/8 remote: only fd is unique-local in use (J2)', () => {
    expect(hostIsLocal('fc00::1')).toBe(false);
    expect(hostIsLocal('[fc12::1]')).toBe(false);
  });

  it('calls IPv4-mapped and IPv4-compatible spellings remote (J2)', () => {
    for (const h of [
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '[::ffff:192.168.1.1]',
      '::127.0.0.1',
    ]) {
      expect(hostIsLocal(h), h).toBe(false);
    }
  });

  it('calls public and unspecified IPv6 remote', () => {
    for (const h of ['::', '2001:db8::1', '2606:4700:4700::1111', '[2001:db8::1]']) {
      expect(hostIsLocal(h), h).toBe(false);
    }
  });

  it('never reads a malformed literal as an address', () => {
    for (const h of ['fd00:::1', 'fd00::1::2', '[::1', '::1]', 'fdxx::1', ':::1']) {
      expect(hostIsLocal(h), h).toBe(false);
    }
  });
});

describe('isLocalHost delegates to the pure judge', () => {
  it('matches hostIsLocal for every non-tailnet host above', () => {
    for (const h of [
      'localhost',
      'mac.local',
      '10.0.0.1',
      '100.64.0.1',
      '0.0.0.0',
      '169.254.1.1',
      '[::1]',
      'fc00::1',
      '::ffff:127.0.0.1',
      'example.com',
    ]) {
      expect(isLocalHost(h), h).toBe(hostIsLocal(h));
    }
  });

  it('takes the own tailnet from this machine for a ts.net host', () => {
    setOwnTailnetSuffixForTests('tail1234.ts.net');
    try {
      expect(isLocalHost('mac.tail1234.ts.net')).toBe(true);
      expect(isLocalHost('box.tail9999.ts.net')).toBe(false);
    } finally {
      setOwnTailnetSuffixForTests(undefined);
    }
    setOwnTailnetSuffixForTests(null);
    try {
      expect(isLocalHost('mac.tail1234.ts.net')).toBe(false);
    } finally {
      setOwnTailnetSuffixForTests(undefined);
    }
  });
});

describe('tailnetSuffixOf', () => {
  it('reads the tailnet from a MagicDNS host', () => {
    expect(tailnetSuffixOf('mac.tail1234.ts.net')).toBe('tail1234.ts.net');
    expect(tailnetSuffixOf('MAC.Tail1234.TS.NET.')).toBe('tail1234.ts.net');
    expect(tailnetSuffixOf('a.b.tail1234.ts.net')).toBe('b.tail1234.ts.net');
  });

  it('gives null for a host with no tailnet in it', () => {
    for (const h of ['ts.net', 'tail1234.ts.net', 'example.com', '100.64.0.1', 'localhost', '']) {
      expect(tailnetSuffixOf(h), h).toBeNull();
    }
  });

  it('feeds hostIsLocal so the paired hub own tailnet reads local and another does not', () => {
    const ownTailnetSuffix = tailnetSuffixOf('hub.tail1234.ts.net');
    expect(hostIsLocal('ollama.tail1234.ts.net', { ownTailnetSuffix })).toBe(true);
    expect(hostIsLocal('ollama.tail9999.ts.net', { ownTailnetSuffix })).toBe(false);
  });
});

describe('the literal parsers agree with node:net isIP', () => {
  const samples = [
    '0.0.0.0',
    '255.255.255.255',
    '1.2.3.4',
    '01.2.3.4',
    '1.2.3',
    '1.2.3.4.5',
    '256.1.1.1',
    '1.2.3.-1',
    ' 1.2.3.4',
    '1.2.3.4 ',
    '::',
    '::1',
    '1::',
    '1:2:3:4:5:6:7:8',
    '1:2:3:4:5:6:7:8:9',
    '1:2:3:4:5:6:7::',
    '::2:3:4:5:6:7:8',
    '1::2::3',
    '::ffff:1.2.3.4',
    '1:2:3:4:5:6:1.2.3.4',
    '1:2:3:4:5:6:7:1.2.3.4',
    '::1.2.3.4',
    '1.2.3.4::',
    'fe80::1%eth0',
    'fe80::1%',
    'fe80::1%a%b',
    '12345::1',
    'g::1',
    ':1',
    '1:',
    ':::',
    '',
  ];

  it('classifies each sample the same way', () => {
    for (const s of samples) {
      expect(isIPv4Literal(s), s).toBe(isIP(s) === 4);
      expect(isIPv6Literal(s), s).toBe(isIP(s) === 6);
    }
  });

  it('agrees on seeded random spellings', () => {
    let seed = 20260927;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const alphabet = '0123456789abcdef:.%fx';
    for (let i = 0; i < 20000; i++) {
      let s = '';
      const len = 1 + rand(24);
      for (let j = 0; j < len; j++) s += alphabet[rand(alphabet.length)];
      expect(isIPv4Literal(s), s).toBe(isIP(s) === 4);
      expect(isIPv6Literal(s), s).toBe(isIP(s) === 6);
    }
  });
});
