// Web search and page fetch after a private note, in a chat (CX and CMO,
// 2026-10-08, H). Once a chat on a seat that stays holds a private note's
// text (a read, a marked turn, or a private pin), every model-written search
// on a result-only backend and every page fetch asks first, every time, on a
// card with the exact words or address; no session allow, no Always, no
// Bypass skips it. Perplexity stays refused before any ask. A clean chat and
// a seat off this network keep today's behaviour.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession, type TestSessionOptions } from './helpers/session.js';
import { deniedReasons, journalRead, pinnedSource } from './helpers/privateNotes.js';
import { HANDOFF_LOCAL_ONLY_DENIED, WEB_DECLINED } from '../src/core/agent/loop.js';
import type { ApprovalRequest } from '../src/core/agent/types.js';

/** Stand-ins for the web tools, so nothing here reaches the network. The
 *  loop judges them by name and risk, as it does the real ones. */
const ran: string[] = [];
const fakeSearch = {
  name: 'webSearch',
  description: 'Search the web.',
  schema: z.object({ query: z.string() }),
  risk: 'network' as const,
  async execute(args: { query: string }) {
    ran.push(`search:${args.query}`);
    return { ok: true, content: `Results for "${args.query}"` };
  },
};
const fakeFetch = {
  name: 'webFetch',
  description: 'Fetch a page.',
  schema: z.object({ url: z.string() }),
  risk: 'network' as const,
  async execute(args: { url: string }) {
    ran.push(`fetch:${args.url}`);
    return { ok: true, content: '# Page' };
  },
};

const QUERY = 'tide tables for march';
const URL_ = 'https://tides.example.org/march?port=1';

function session(
  turns: ReturnType<typeof textTurn>[],
  opts: {
    mode?: 'default' | 'acceptEdits' | 'bypassPermissions';
    pinned?: boolean;
    cloud?: boolean;
    backend?: string;
    approve?: TestSessionOptions['approve'];
  } = {},
) {
  const provider = opts.cloud
    ? new MockProvider('anthropic', turns, { kind: 'cloud' })
    : new MockProvider('mock', turns);
  const s = makeTestSession(provider, {
    ...(opts.mode ? { permissionMode: opts.mode } : {}),
    ...(opts.approve ? { approve: opts.approve } : {}),
    ...(opts.pinned
      ? { vaultRoot: mkdtempSync(join(tmpdir(), 'osc-vault-')), vaultContext: pinnedSource() }
      : {}),
    configOverrides: {
      ...(opts.cloud
        ? { stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } } }
        : {}),
      ...(opts.backend ? { search: { backend: opts.backend } } : {}),
    },
  });
  s.tools.register(journalRead);
  s.tools.register(fakeSearch);
  s.tools.register(fakeFetch);
  return { provider, s };
}

const READ = toolTurn('vaultRead', { path: 'Journal/today.md' }, 'r1');
const SEARCH = toolTurn('webSearch', { query: QUERY }, 's1');
const FETCH = toolTurn('webFetch', { url: URL_ }, 'f1');

const webCards = (approvals: ApprovalRequest[]) =>
  approvals.filter((a) => a.toolName === 'webSearch' || a.toolName === 'webFetch');

describe('a model-written search or page after a private note asks every time (H)', () => {
  it('after a read: the search and the page ask in every mode, with the exact words', async () => {
    for (const mode of ['default', 'acceptEdits', 'bypassPermissions'] as const) {
      const { s } = session([READ, SEARCH, FETCH, textTurn('Done.')], { mode });
      await s.agent.run('check the tides against my journal');
      const cards = webCards(s.approvals);
      expect(
        cards.map((c) => c.toolName),
        mode,
      ).toEqual(['webSearch', 'webFetch']);
      expect(cards[0]!.summary).toBe(`Search DuckDuckGo for "${QUERY}"`);
      expect(cards[0]!.detail).toBe(
        'This chat has read a private note. These words go to DuckDuckGo as written, so check that they carry nothing from it. Nothing is sent without this approval.',
      );
      expect(cards[0]!.alwaysAsk).toBe(true);
      expect(cards[1]!.summary).toBe('Open tides.example.org');
      expect(cards[1]!.detail).toBe(
        `This chat has read a private note. Nothing is sent without this approval. This address goes to tides.example.org as written, so check that it carries nothing from the note: ${URL_}`,
      );
    }
  });

  it('after a private pin: the lead names the pin', async () => {
    const { s } = session([SEARCH, textTurn('Done.')], { pinned: true, backend: 'brave' });
    await s.agent.run('look it up');
    const [card] = webCards(s.approvals);
    expect(card!.summary).toBe(`Search Brave for "${QUERY}"`);
    expect(card!.detail).toBe(
      'A private note is pinned to this project. These words go to Brave as written, so check that they carry nothing from it. Nothing is sent without this approval.',
    );
  });

  it('no standing allow: a session allow and Opening web pages Always still ask each time', async () => {
    // The test session opens pages on Always (the permission engine's
    // default); a yes for the session is asked for on every card.
    // A second page, since the same call again would be answered from the record.
    const second = toolTurn('webFetch', { url: 'https://tides.example.org/april' }, 'f2');
    const { s } = session([READ, FETCH, second, textTurn('.')], {
      approve: () => ({ approve: true, alwaysThisSession: true }),
    });
    await s.agent.run('open it twice');
    expect(webCards(s.approvals)).toHaveLength(2);
  });

  it('a no keeps it off the web and tells the model so', async () => {
    ran.length = 0;
    const { provider, s } = session([READ, SEARCH, textTurn('From what I have.')], {
      approve: (r) => ({ approve: r.toolName !== 'webSearch' }),
    });
    await s.agent.run('look it up');
    expect(ran).toEqual([]);
    expect(JSON.stringify(provider.requests.at(-1)!.messages)).toContain(WEB_DECLINED);
  });

  it('a clean chat keeps its first-time behaviour: the search runs without a card', async () => {
    ran.length = 0;
    const { s } = session([SEARCH, textTurn('Done.')]);
    await s.agent.run('look it up');
    expect(webCards(s.approvals)).toEqual([]);
    expect(ran).toEqual([`search:${QUERY}`]);
  });

  it('a seat off this network was sent only the stub, so it does not ask', async () => {
    const { s } = session([READ, SEARCH, textTurn('Done.')], { cloud: true });
    await s.agent.run('look it up');
    expect(webCards(s.approvals)).toEqual([]);
  });

  it('Perplexity is refused before any ask, with the handoff line', async () => {
    ran.length = 0;
    const { s } = session([READ, SEARCH, textTurn('Answered from what I have.')], {
      backend: 'perplexity',
      mode: 'bypassPermissions',
    });
    await s.agent.run('look it up');
    expect(webCards(s.approvals)).toEqual([]);
    expect(ran).toEqual([]);
    expect(deniedReasons(s.events)).toEqual([HANDOFF_LOCAL_ONLY_DENIED]);
  });
});
