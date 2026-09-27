import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byomReach } from '../src/lib/byom.js';

// Teal is local only: a BYOM pointed at a hosted API is someone's cloud and
// wears amber (brand sweep 2026-09-24, wave 1 #11). Since Vault M5 (CTO J2)
// the pill is judged by the one shared judge, `hostIsLocal`, so it can never
// disagree with what the seat is allowed to read.
describe('byomReach', () => {
  it.each([
    'http://localhost:11434/v1',
    'http://ollama.localhost/v1',
    'http://127.0.0.1:8000/v1',
    'http://127.4.5.6/v1',
    'http://[::1]:8080/v1',
    'http://10.0.0.12:8000/v1',
    'http://172.16.0.1/v1',
    'http://172.31.255.254/v1',
    'http://192.168.1.20:11434/v1',
    'http://studio.local:1234/v1',
    'http://100.64.0.1/v1',
    'http://100.101.102.103:11434/v1',
    'http://100.127.255.255/v1',
    'http://[fd12:3456::1]/v1',
    'http://[fe80::1]/v1',
    'localhost:11434/v1',
    '192.168.1.5:8000',
  ])('%s is local', (url) => {
    expect(byomReach(url)).toBe('local');
  });

  it.each([
    'https://api.openai.com/v1',
    'https://api.together.xyz/v1',
    'https://my-gateway.example.com/v1',
    'http://8.8.8.8/v1',
    'http://172.15.0.1/v1',
    'http://172.32.0.1/v1',
    'http://192.169.0.1/v1',
    'http://100.63.255.255/v1',
    'http://100.128.0.1/v1',
    'http://[2001:db8::1]/v1',
    'https://local.example.com/v1',
    'https://ts.net.example.com/v1',
    '',
    'not a url at all',
  ])('%s is cloud', (url) => {
    expect(byomReach(url)).toBe('cloud');
  });

  // The behaviour change J2 made (wave 0 adjustment 6): these read local under
  // the old hand-rolled rules and read cloud now, exactly as the engine's
  // isLocalHost judges them.
  it.each([
    // Another tailnet's name (a Funnel host) is someone else's server; with
    // no paired hub there is no own tailnet at all.
    'https://gpu-box.tail1234.ts.net/v1',
    // The unspecified address and link-local IPv4 are not a server you run.
    'http://0.0.0.0:8000',
    'http://169.254.10.10/v1',
    // Unique-local fc00::/8 is unassigned; only fd00::/8 is in use.
    'http://[fc00::1]/v1',
    // An IPv4-mapped spelling is not trusted as its IPv4 self.
    'http://[::ffff:192.168.0.5]/v1',
    'http://[::ffff:a00:2]/v1',
  ])('%s now reads cloud (J2)', (url) => {
    expect(byomReach(url)).toBe('cloud');
  });

  it("a *.ts.net server is local only on this device's own tailnet", () => {
    const url = 'https://gpu-box.tail1234.ts.net/v1';
    expect(byomReach(url, 'tail1234.ts.net')).toBe('local');
    expect(byomReach(url, 'tail9999.ts.net')).toBe('cloud');
    expect(byomReach(url, null)).toBe('cloud');
    // A look-alike suffix never matches.
    expect(byomReach('https://box.eviltail1234.ts.net/v1', 'tail1234.ts.net')).toBe('cloud');
  });

  it('the pill and the vault seat use the same judge', () => {
    const src = readFileSync(new URL('../src/lib/byom.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/hostIsLocal\(host, \{ ownTailnetSuffix \}\)/);
    const seat = readFileSync(new URL('../src/lib/vaultSeat.ts', import.meta.url), 'utf8');
    expect(seat).toMatch(/hostIsLocal\(/);
  });

  it('the Stack chip reads the reach, never a blanket "your server"', () => {
    const src = readFileSync(
      new URL('../src/components/StackManager.tsx', import.meta.url),
      'utf8',
    );
    expect(src).toMatch(/byomReach\(ref\.baseUrl, ownTailnetSuffix\)/);
    expect(src).toMatch(/hubTailnetSuffix\(/);
    expect(src).not.toMatch(/kind === 'byom'\) return \{ cls: 'local'/);
  });
});
