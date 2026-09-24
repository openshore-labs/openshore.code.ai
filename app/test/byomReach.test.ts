import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byomReach } from '../src/lib/byom.js';

// Teal is local only: a BYOM pointed at a hosted API is someone's cloud and
// wears amber (brand sweep 2026-09-24, wave 1 #11).
describe('byomReach', () => {
  it.each([
    'http://localhost:11434/v1',
    'http://ollama.localhost/v1',
    'http://127.0.0.1:8000/v1',
    'http://127.4.5.6/v1',
    'http://[::1]:8080/v1',
    'http://0.0.0.0:8000',
    'http://10.0.0.12:8000/v1',
    'http://172.16.0.1/v1',
    'http://172.31.255.254/v1',
    'http://192.168.1.20:11434/v1',
    'http://169.254.10.10/v1',
    'http://studio.local:1234/v1',
    'https://gpu-box.tail1234.ts.net/v1',
    'http://100.64.0.1/v1',
    'http://100.101.102.103:11434/v1',
    'http://100.127.255.255/v1',
    'http://[fd12:3456::1]/v1',
    'http://[fe80::1]/v1',
    'http://[::ffff:192.168.0.5]/v1',
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

  it('the Stack chip reads the reach, never a blanket "your server"', () => {
    const src = readFileSync(
      new URL('../src/components/StackManager.tsx', import.meta.url),
      'utf8',
    );
    expect(src).toMatch(/byomReach\(/);
    expect(src).not.toMatch(/kind === 'byom'\) return \{ cls: 'local'/);
  });
});
