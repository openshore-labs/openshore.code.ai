// Connect-anywhere (founder, 2026-10-07; docs/connect-anywhere-proposal.md):
// docking a device to a computer at home or a server you rent, every way in
// listed in Computer, a server set up from Cloud Connections too, and two
// providers whose models load live from their own list on the person's key.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DOCK_PATHS,
  SERVER_INSTALL_COMMAND,
  SERVER_PAIR_COMMAND,
  SERVER_RENTED_LINE,
  SERVER_STEPS,
  dockKindOf,
  dockedNoun,
  dockedNounLower,
  unreachableLine,
} from '../src/lib/docking.js';
import {
  PROVIDERS,
  applyLiveModels,
  parseLiveModels,
  pickLiveModels,
  providerInfo,
} from '../src/lib/providers.js';
import { daemonHealth } from '../src/drivers/remoteDriver.js';
import { PAY_GATE } from '../src/lib/payGate.js';
import { ROOM_LABELS } from '../src/lib/navRooms.js';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('docking, the words', () => {
  it('names a server as a server and anything else as a computer', () => {
    expect(dockKindOf({ kind: 'server' })).toBe('server');
    expect(dockKindOf({ kind: 'desktop' })).toBe('desktop');
    expect(dockKindOf({ kind: 'mainframe' })).toBeUndefined();
    expect(dockKindOf(null)).toBeUndefined();
    expect(dockedNoun({ kind: 'server' })).toBe('Your server');
    expect(dockedNoun({ kind: 'desktop' })).toBe('Your computer');
    expect(dockedNoun(undefined)).toBe('Your computer');
    expect(dockedNounLower({ kind: 'server' })).toBe('your server');
  });

  it('tells a server to check the server, and a computer to open OpenShore', () => {
    expect(unreachableLine({ kind: 'server' })).toMatch(/server is running and on Tailscale/);
    expect(unreachableLine({ kind: 'server' })).not.toMatch(/OpenShore open/);
    expect(unreachableLine({ kind: 'desktop' })).toMatch(/OpenShore open/);
  });

  it('the room is Computer, and docking is free', () => {
    expect(ROOM_LABELS.pair).toBe('Computer');
    expect(PAY_GATE.pairing).toBe('free');
  });

  it('lists every way in, in order, and two of them dock right here', () => {
    expect(DOCK_PATHS.map((p) => p.id)).toEqual(['computer', 'server', 'cloud', 'device']);
    const screen = read('src', 'screens', 'PairScreen.tsx');
    // The two docking paths are one choice above Scan (Scan stays in the
    // first screen); the other ways in sit below and open their rooms.
    const phone = screen.slice(screen.indexOf('function PhonePair'));
    expect(phone.indexOf('dock-choice')).toBeLessThan(phone.indexOf('<DockForm'));
    expect(phone.indexOf('<OtherWaysIn')).toBeGreaterThan(phone.indexOf('<DockForm'));
    expect(screen).toContain("setView(id === 'cloud' ? 'connections' : 'stack')");
  });
});

describe('setting up a server', () => {
  it('installs from the public releases the installer itself reads', () => {
    const installer = read('..', 'os-code', 'scripts', 'install-server.sh');
    const releases = /RELEASES="([^"]+)"/.exec(installer)?.[1];
    expect(releases).toBe('https://github.com/openshore-labs/openshore-releases/releases');
    expect(SERVER_INSTALL_COMMAND).toBe(
      `curl -fsSL ${releases}/latest/download/install-server.sh | sh`,
    );
    expect(SERVER_PAIR_COMMAND).toContain('osc pair --server');
  });

  it('names no provider, never says always on, and says what renting means', () => {
    const all = [
      ...SERVER_STEPS.flatMap((s) => [s.title, s.detail]),
      SERVER_RENTED_LINE,
      ...DOCK_PATHS.flatMap((p) => [p.title, p.detail]),
    ].join(' ');
    expect(all).not.toMatch(/always on|always-on/i);
    expect(all).not.toMatch(/hetzner|digitalocean|vultr|linode|aws|azure/i);
    expect(all).toMatch(/billed by the hour/);
    expect(SERVER_RENTED_LINE).toMatch(/can reach its disk/);
    expect(all).toMatch(/never listens on the open internet/);
  });

  it('is offered in Cloud Connections, above the providers', () => {
    const screen = read('src', 'screens', 'ConnectionsScreen.tsx');
    const server = screen.indexOf('<SettingsGroup title="Your server"');
    expect(server).toBeGreaterThan(0);
    expect(server).toBeLessThan(screen.indexOf('<SettingsGroup title="Cloud providers"'));
    expect(screen).toContain('<DockForm expect="server"');
    expect(screen).toContain('<ServerSetup />');
  });
});

describe('the health check says what it docked to', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('carries the kind a daemon reports, and none from an older one', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, role: 'admin', kind: 'server' }),
    })) as unknown as typeof fetch;
    const server = await daemonHealth({ baseUrl: 'http://100.64.0.9:4816', token: 't' });
    expect(server).toMatchObject({ ok: true, role: 'admin', kind: 'server' });
    expect(server.detail).toBe('Docked to your server.');

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })) as unknown as typeof fetch;
    const older = await daemonHealth({ baseUrl: 'http://100.64.0.9:4816', token: 't' });
    expect(older.kind).toBeUndefined();
  });

  it('the store keeps the kind across a later save that carries none', () => {
    const store = read('src', 'state', 'store.ts');
    expect(store).toContain('kind: target.kind ?? prior?.kind,');
  });
});

describe('providers whose models load live', () => {
  it('Venice and OpenRouter are OpenAI-compatible, with nothing typed', () => {
    for (const id of ['venice', 'openrouter']) {
      const p = providerInfo(id);
      expect(p?.liveModels, id).toBe(true);
      expect(p?.openaiBaseUrl, id).toMatch(/^https:\/\//);
      expect(p?.apiKeyUrl, id).toMatch(/^https:\/\//);
    }
    const source = read('src', 'lib', 'providers.ts');
    expect(source.match(/models: \[\],\n {4}liveModels: true,/g)).toHaveLength(2);
    expect(PROVIDERS.filter((p) => p.liveModels).map((p) => p.id)).toEqual([
      'venice',
      'openrouter',
    ]);
  });

  it("reads Venice's list: text only, not offline, its own words on privacy", () => {
    const models = parseLiveModels('venice', {
      data: [
        {
          id: 'qwen-coder',
          type: 'text',
          created: 1_760_000_000,
          model_spec: {
            name: 'Qwen Coder',
            availableContextTokens: 262_144,
            capabilities: { supportsFunctionCalling: true, supportsVision: false },
            privacy: 'private',
          },
        },
        {
          id: 'big-proxy',
          type: 'text',
          model_spec: { name: 'Big', capabilities: {}, privacy: 'anonymized' },
        },
        { id: 'flux', type: 'image', model_spec: { name: 'Flux' } },
        { id: 'gone', type: 'text', model_spec: { offline: true } },
        { id: 'qwen-coder', type: 'text' },
        { nope: true },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(['qwen-coder', 'big-proxy']);
    const [coder, big] = models;
    expect(coder).toMatchObject({
      label: 'Qwen Coder',
      contextTokens: 262_144,
      tools: true,
      released: '2025-10-09',
    });
    expect(coder!.categories).toContain('coding');
    expect(coder!.tagline).toBe('On Venice, on your key.');
    expect(big!.tagline).toBe('On Venice, on your key.');
    expect(big!.tools).toBe(false);
    for (const m of models) expect(m.tagline).not.toMatch(/private|never|secure/i);
  });

  it("reads OpenRouter's list, and a first connection picks the newest per maker", () => {
    const row = (id: string, created: number, tools = true, outputs = ['text']) => ({
      id,
      name: id,
      created,
      context_length: 128_000,
      architecture: { input_modalities: ['text', 'image'], output_modalities: outputs },
      supported_parameters: tools ? ['tools', 'temperature'] : ['temperature'],
    });
    const all = parseLiveModels('openrouter', {
      data: [
        row('anthropic/old', 100),
        row('anthropic/new', 200),
        row('openai/a', 150),
        row('openai/b:free', 300),
        row('qwen/chat-only', 400, false),
        row('qwen/coder', 50),
        row('someone/else', 999),
        row('google/imagegen', 500, true, ['image']),
      ],
    });
    expect(all.find((m) => m.id === 'anthropic/new')?.categories).toContain('vision');
    expect(all.some((m) => m.id === 'google/imagegen')).toBe(false);
    expect(pickLiveModels('openrouter', all).map((m) => m.id)).toEqual([
      'anthropic/new',
      'openai/a',
      'qwen/coder',
    ]);
  });

  it('puts the picks where every reader looks, and takes them away again', () => {
    const venice = providerInfo('venice')!;
    applyLiveModels('venice', [{ id: 'm1', label: 'M1', tagline: 't', categories: ['coding'] }]);
    expect(venice.models.map((m) => m.id)).toEqual(['m1']);
    applyLiveModels('venice', []);
    expect(venice.models).toEqual([]);
    applyLiveModels('openai', []);
    expect(providerInfo('openai')!.models.length).toBeGreaterThan(0);
  });

  it('the store puts the saved picks back at launch and drops them with the key', () => {
    const store = read('src', 'state', 'store.ts');
    expect(store).toContain('applyLiveModels(id, models);');
    expect(store).toContain(
      'if (providerInfo(id)?.liveModels) await get().setProviderModels(id, []);',
    );
  });
});
