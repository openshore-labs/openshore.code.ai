// DNS rebinding (CTO security review 2026-10-01, F4): a page the model chose
// connects through the same lookup that checks it, so a name that answers a
// public address to the check and this computer's own network to the
// connection is refused before a byte reaches the local service.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { EgressBlocked, EgressPolicy, DEFAULT_EGRESS } from '../src/core/security/egress.js';

let server: Server;
let port: number;
let hits: number;

beforeEach(async () => {
  hits = 0;
  server = createServer((req, res) => {
    hits++;
    if (req.url === '/gz') {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
      res.end(gzipSync('compressed hello'));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('the router admin page');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(() => {
  server.close();
});

describe('a page fetch cannot be rebound onto this computer', () => {
  it('refuses a name that answers public to the check and local to the connection', async () => {
    const rebinding = () => {
      let calls = 0;
      const policy = new EgressPolicy(DEFAULT_EGRESS, {
        // First answer (the check): a public address. Every later one (the
        // connection): this computer.
        lookup: async () => (calls++ === 0 ? ['93.184.216.34'] : ['127.0.0.1']),
      });
      policy.setLocalGate(async () => true);
      return policy;
    };
    await expect(
      rebinding().fetch(`http://rebind.example:${port}/`, 'web-fetch'),
    ).rejects.toBeInstanceOf(EgressBlocked);
    await expect(rebinding().fetch(`http://rebind.example:${port}/`, 'web-fetch')).rejects.toThrow(
      /own network when it was opened/,
    );
    expect(hits).toBe(0);
  });

  it('still opens a local page the person allowed, at the address it checked', async () => {
    const policy = new EgressPolicy(DEFAULT_EGRESS, { lookup: async () => ['127.0.0.1'] });
    const asked: string[] = [];
    policy.setLocalGate(async (_url, host) => {
      asked.push(host);
      return true;
    });
    const res = await policy.fetch(`http://nas.example:${port}/`, 'web-fetch');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('the router admin page');
    expect(asked).toEqual([`nas.example:${port}`]);
  });

  it('refuses the local page when the person said no, and reaches nothing', async () => {
    const policy = new EgressPolicy(DEFAULT_EGRESS, { lookup: async () => ['127.0.0.1'] });
    policy.setLocalGate(async () => false);
    await expect(policy.fetch(`http://nas.example:${port}/`, 'web-fetch')).rejects.toThrow(
      /did not allow/,
    );
    expect(hits).toBe(0);
  });

  it('decodes a compressed page the way fetch does', async () => {
    const policy = new EgressPolicy(DEFAULT_EGRESS, { lookup: async () => ['127.0.0.1'] });
    policy.setLocalGate(async () => true);
    const res = await policy.fetch(`http://nas.example:${port}/gz`, 'web-fetch');
    expect(await res.text()).toBe('compressed hello');
  });
});
