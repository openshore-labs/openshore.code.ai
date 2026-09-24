// Web search and fetch ask first by default (advisory org ruling, 2026-09-24).
// The engine's network default is ask, the grant lasts the session (the first
// yes covers every later call, never per call), the approval card shows the
// exact query or URL and names the search service, the app's "Ask before
// searching the web" switch can only relax the ask for its own session, and a
// routine declares web use up front so an unattended run never blocks.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigSchema } from '../src/config/schema.js';
import {
  DEFAULT_PERMISSIONS,
  PermissionEngine,
  sessionNetworkDefault,
} from '../src/core/permissions/index.js';
import { PROFILES } from '../src/core/security/profiles.js';
import { webSearchTool } from '../src/core/tools/webSearch.js';
import { webFetchTool } from '../src/core/tools/webFetch.js';
import { searchServiceName } from '../src/core/tools/search/index.js';
import { askAgentTool } from '../src/core/tools/askAgent.js';
import { askHermesTool } from '../src/core/tools/askHermes.js';
import type { ToolContext } from '../src/core/tools/index.js';
import { validateRoutineInput, PRESET_ROUTINE } from '../src/routines/model.js';
import {
  _resetRoutineScheduler,
  defaultOpenSession,
  routineInstructions,
} from '../src/routines/scheduler.js';
import * as store from '../src/routines/store.js';
import type { RoutineSchedule } from '../src/routines/model.js';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';

describe('the network default asks first', () => {
  it('parses to ask from an empty config, and the built-in default agrees', () => {
    const config = ConfigSchema.parse({});
    expect(config.permissions.defaults.network).toBe('ask');
    expect(DEFAULT_PERMISSIONS.defaults.network).toBe('ask');
  });

  it('askAgent and askHermes are network tools, so they share the default', () => {
    expect(askAgentTool.risk).toBe('network');
    expect(askHermesTool.risk).toBe('network');
    expect(webSearchTool.risk).toBe('network');
    expect(webFetchTool.risk).toBe('network');
  });
});

describe('one grant per session, never per call', () => {
  it('turns every later network ask into allow once granted', () => {
    const engine = new PermissionEngine(DEFAULT_PERMISSIONS, PROFILES['local-interactive']);
    expect(engine.decide({ toolName: 'webSearch', risk: 'network' }).decision).toBe('ask');
    expect(engine.allowRiskForSession('network')).toBe(true);
    expect(engine.decide({ toolName: 'webSearch', risk: 'network' }).decision).toBe('allow');
    // The grant is for the risk class: a fetch after a search does not ask.
    expect(engine.decide({ toolName: 'webFetch', risk: 'network' }).decision).toBe('allow');
    // Nothing else rides on it.
    expect(engine.decide({ toolName: 'runShell', risk: 'shell', command: 'ls' }).decision).toBe(
      'ask',
    );
  });

  it('grants network only, and a configured deny still wins', () => {
    const engine = new PermissionEngine(
      { ...DEFAULT_PERMISSIONS, defaults: { ...DEFAULT_PERMISSIONS.defaults, network: 'deny' } },
      PROFILES['local-interactive'],
    );
    expect(engine.allowRiskForSession('shell')).toBe(false);
    engine.allowRiskForSession('network');
    expect(engine.decide({ toolName: 'webSearch', risk: 'network' }).decision).toBe('deny');
  });

  it('holds on the phone-attached profile too (session grants are the ruling everywhere)', () => {
    const engine = new PermissionEngine(DEFAULT_PERMISSIONS, PROFILES['remote-attached']);
    engine.allowRiskForSession('network');
    expect(engine.decide({ toolName: 'webFetch', risk: 'network' }).decision).toBe('allow');
  });

  it('asks once in a real loop, with the session grant on the card, then flows', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('netProbe', { url: 'https://example.com/a' }, 'c1'),
      toolTurn('netProbe', { url: 'https://example.com/b' }, 'c2'),
      toolTurn('netProbe', { url: 'https://example.com/c' }, 'c3'),
      textTurn('Done.'),
    ]);
    const session = makeTestSession(provider);
    let runs = 0;
    session.tools.register({
      name: 'netProbe',
      description: 'A stand-in network tool.',
      schema: z.object({ url: z.string() }),
      risk: 'network',
      async preview(args: { url: string }) {
        return { summary: `Read the web page: ${args.url}` };
      },
      async execute() {
        runs += 1;
        return { ok: true, content: 'page' };
      },
    });
    await session.agent.run('read three pages');
    expect(runs).toBe(3);
    expect(session.approvals).toHaveLength(1);
    expect(session.approvals[0]).toMatchObject({
      risk: 'network',
      grant: 'session',
      summary: 'Read the web page: https://example.com/a',
    });
    expect(
      session.events.some(
        (e) => e.type === 'note' && /allowed for the rest of this session/.test(e.message),
      ),
    ).toBe(true);
  });

  it('a declined network ask stays an ask, and the next call asks again', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('netProbe', { url: 'https://example.com/a' }, 'c1'),
      toolTurn('netProbe', { url: 'https://example.com/b' }, 'c2'),
      textTurn('Done.'),
    ]);
    const session = makeTestSession(provider, { approve: () => ({ approve: false }) });
    session.tools.register({
      name: 'netProbe',
      description: 'A stand-in network tool.',
      schema: z.object({ url: z.string() }),
      risk: 'network',
      async execute() {
        return { ok: true, content: 'page' };
      },
    });
    await session.agent.run('read two pages');
    expect(session.approvals).toHaveLength(2);
  });
});

describe('the card shows the exact query or URL and names the service', () => {
  const ctx = (backend: string) =>
    ({ config: ConfigSchema.parse({ search: { backend } }) }) as unknown as ToolContext;

  it('names DuckDuckGo by default, and the configured backend otherwise', async () => {
    const p = await webSearchTool.preview!({ query: 'vite 7 release notes' }, ctx('duckduckgo'));
    expect(p.summary).toBe('Search the web for: vite 7 release notes');
    expect(p.detail).toContain('The query goes to DuckDuckGo.');
    const brave = await webSearchTool.preview!({ query: 'x' }, ctx('brave'));
    expect(brave.detail).toContain('Brave Search');
    expect(searchServiceName({ backend: 'searxng' })).toBe('your SearXNG server');
  });

  it('shows the exact URL for a fetch', async () => {
    const p = await webFetchTool.preview!({ url: 'https://example.com/docs' }, ctx('duckduckgo'));
    expect(p.summary).toBe('Read the web page: https://example.com/docs');
  });
});

describe('precedence: the app switch only relaxes, a routine resolves', () => {
  it('the app switch off relaxes ask to allow; on or unset leaves config in charge', () => {
    expect(sessionNetworkDefault('ask', {})).toBe('ask');
    expect(sessionNetworkDefault('ask', { askBeforeWeb: true })).toBe('ask');
    expect(sessionNetworkDefault('ask', { askBeforeWeb: false })).toBe('allow');
  });

  it('never overrides a configured deny, and never tightens a configured allow', () => {
    expect(sessionNetworkDefault('deny', { askBeforeWeb: false })).toBe('deny');
    expect(sessionNetworkDefault('allow', { askBeforeWeb: true })).toBe('allow');
  });

  it('an unattended run never asks: yes allows, no denies, deny holds', () => {
    expect(sessionNetworkDefault('ask', { unattendedWeb: true })).toBe('allow');
    expect(sessionNetworkDefault('ask', { unattendedWeb: false })).toBe('deny');
    expect(sessionNetworkDefault('allow', { unattendedWeb: false })).toBe('deny');
    expect(sessionNetworkDefault('deny', { unattendedWeb: true })).toBe('deny');
  });

  it('reaches the engine from the daemon and the electron bridge', () => {
    const serve = readFileSync(join(process.cwd(), 'src', 'daemon', 'serve.ts'), 'utf8');
    expect(serve).toMatch(/body\.askBeforeWeb/);
    expect(serve).toMatch(/askBeforeWeb,\s*\n\s*currents,/);
    const boot = readFileSync(join(process.cwd(), 'src', 'core', 'agent', 'bootstrap.ts'), 'utf8');
    expect(boot).toMatch(/sessionNetworkDefault\(config\.permissions\.defaults\.network/);
  });
});

describe('routines declare web use at setup', () => {
  let workspace: string;
  beforeEach(() => {
    process.env.OSC_HOME = mkdtempSync(join(tmpdir(), 'oschome-'));
    workspace = mkdtempSync(join(tmpdir(), 'osc-ws-'));
    _resetRoutineScheduler();
  });

  const base = () => ({
    name: 'Morning review',
    agentName: 'Reviewer',
    persona: 'A calm reviewer.',
    task: 'Review what changed.',
    cwd: workspace,
    schedule: { hour: 6, minute: 0, days: [] } as RoutineSchedule,
  });

  it('defaults off, validates a boolean, and the preset stays off', () => {
    const parsed = validateRoutineInput(base());
    expect(parsed.ok && parsed.value.webSearch).toBe(false);
    const on = validateRoutineInput({ ...base(), webSearch: true });
    expect(on.ok && on.value.webSearch).toBe(true);
    expect(validateRoutineInput({ ...base(), webSearch: 'yes' }).ok).toBe(false);
    expect(PRESET_ROUTINE.webSearch).toBe(false);
    expect(store.createRoutine(base()).webSearch).toBe(false);
  });

  it('pre-approves or denies network for the run, so it never blocks', () => {
    const seen: unknown[] = [];
    const boot = (options: { unattendedWeb?: boolean }) => {
      seen.push(options.unattendedWeb);
      return {
        driver: { id: 'd', dispose: () => {} },
        warnings: [],
        orchestratorKind: 'local' as const,
      };
    };
    const off = store.createRoutine(base());
    const on = store.createRoutine({ ...base(), name: 'Research', webSearch: true });
    defaultOpenSession(off, 'plan', boot as unknown as Parameters<typeof defaultOpenSession>[2]);
    defaultOpenSession(on, 'plan', boot as unknown as Parameters<typeof defaultOpenSession>[2]);
    expect(seen).toEqual([false, true]);
  });

  it('tells the crew member whether it has the web', () => {
    const off = store.createRoutine(base());
    const on = store.createRoutine({ ...base(), name: 'Research', webSearch: true });
    expect(routineInstructions(off)).toContain('does not use the web');
    expect(routineInstructions(on)).toContain('may search and read the web');
  });
});
