// The codemagic tool: it must self-degrade when no token was delivered, refuse
// a trigger with no saved target, and pass build logs through the shared
// redact-then-extract safety before returning them. A stubbed global fetch
// stands in for the Codemagic REST API, so this needs no network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codemagicTool } from '../src/core/tools/codemagic.js';
import type { ToolContext } from '../src/core/tools/index.js';

type Cm = NonNullable<ToolContext['codemagic']>;
function ctxWith(codemagic?: Cm): ToolContext {
  return { codemagic } as unknown as ToolContext;
}

const target = { appId: 'app1', workflowId: 'wf1', branch: 'main' };

function stubFetch(routes: Array<{ match: RegExp; body: unknown; text?: string; ok?: boolean }>) {
  const fn = vi.fn(async (url: string | URL, _init?: unknown) => {
    const u = String(url);
    const route = routes.find((r) => r.match.test(u));
    if (!route) throw new Error(`unexpected fetch ${u}`);
    return {
      ok: route.ok ?? true,
      status: route.ok === false ? 500 : 200,
      json: async () => route.body,
      text: async () => route.text ?? '',
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('codemagicTool', () => {
  it('is a cloud-spend tool so the Access switch is the sole gate', () => {
    expect(codemagicTool.risk).toBe('cloud-spend');
  });

  it('self-degrades when no token was delivered', async () => {
    const out = await codemagicTool.execute(
      { action: 'status', buildId: 'b1' },
      ctxWith(undefined),
    );
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/not connected/i);
  });

  it('refuses a trigger with no saved target', async () => {
    const out = await codemagicTool.execute({ action: 'trigger' }, ctxWith({ token: 't' }));
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/no launch target/i);
  });

  it('triggers a build and returns the buildId', async () => {
    stubFetch([{ match: /\/builds$/, body: { buildId: 'build-42' } }]);
    const out = await codemagicTool.execute({ action: 'trigger' }, ctxWith({ token: 't', target }));
    expect(out.ok).toBe(true);
    expect(out.content).toContain('build-42');
  });

  it('triggers on an overridden branch', async () => {
    const fn = stubFetch([{ match: /\/builds$/, body: { buildId: 'b2' } }]);
    await codemagicTool.execute(
      { action: 'trigger', branch: 'release/1.2' },
      ctxWith({ token: 't', target }),
    );
    const body = JSON.parse((fn.mock.calls[0]![1] as { body: string }).body);
    expect(body.branch).toBe('release/1.2');
  });

  it('reads status and flags a failure', async () => {
    stubFetch([{ match: /\/builds\/b1$/, body: { build: { status: 'failed', artefacts: [] } } }]);
    const out = await codemagicTool.execute(
      { action: 'status', buildId: 'b1' },
      ctxWith({ token: 't' }),
    );
    expect(out.ok).toBe(true);
    expect(out.content).toMatch(/failed/);
    expect(out.content).toMatch(/logs/);
  });

  it('needs a buildId for status', async () => {
    const out = await codemagicTool.execute({ action: 'status' }, ctxWith({ token: 't' }));
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/buildId/);
  });

  it('returns a redacted, extracted log excerpt', async () => {
    const rawLog = [
      'line before',
      'APP_STORE_TOKEN=supersecretvalue123',
      'error: Code Sign failed for target App',
      'line after',
    ].join('\n');
    stubFetch([
      {
        match: /\/builds\/b9$/,
        body: {
          build: {
            status: 'failed',
            artefacts: [{ name: 'xcodebuild.log', url: 'https://logs/x' }],
          },
        },
      },
      { match: /logs\/x$/, body: {}, text: rawLog },
    ]);
    const out = await codemagicTool.execute(
      { action: 'logs', buildId: 'b9' },
      ctxWith({ token: 't' }),
    );
    expect(out.ok).toBe(true);
    expect(out.content).toContain('Code Sign failed');
    expect(out.content).not.toContain('supersecretvalue123');
  });
});
