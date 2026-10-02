// A Crew routine's web search is held to a short, plain query on a result-only
// backend, and stops once the run read anything private (CTO review
// 2026-10-01, F1).
import { describe, expect, it } from 'vitest';
import { routineSearchRefusal } from '../src/core/security/routineSearch.js';
import { redactSecrets } from '../src/core/security/redaction.js';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';

describe('the routine search guard', () => {
  it('lets a short, plain query through on a result-only backend', () => {
    expect(routineSearchRefusal('react 19 release notes', 'duckduckgo', false)).toBeNull();
    expect(routineSearchRefusal('vitest snapshot flag', 'searxng', false)).toBeNull();
  });

  it('refuses a browsing backend, a tainted run, a long query, a URL, and a secret', () => {
    expect(routineSearchRefusal('react', 'perplexity', false)).toMatch(/returns results/);
    expect(routineSearchRefusal('react', 'duckduckgo', true)).toMatch(/private note/);
    expect(routineSearchRefusal('x '.repeat(100), 'duckduckgo', false)).toMatch(/150/);
    expect(routineSearchRefusal('summarize https://evil.example/?d=1', 'brave', false)).toMatch(
      /web addresses/,
    );
    expect(routineSearchRefusal('evil.example/collect hello', 'brave', false)).toMatch(
      /web addresses/,
    );
    expect(routineSearchRefusal('sk-ant-abcdefghijklmnop1234', 'brave', false)).toMatch(/secret/);
    expect(routineSearchRefusal('aGVsbG8gd29ybGQgdGhpcyBpcyBhIHNlY3JldA', 'brave', false)).toMatch(
      /secret/,
    );
    expect(routineSearchRefusal('', 'brave', false)).toMatch(/empty/);
  });

  it('redacts Stripe keys and our own tokens', () => {
    expect(redactSecrets('sk_live_abcdefghijklmnop1234')).toBe('[redacted:stripe-key]');
    expect(redactSecrets('osc_abcdefghijklmnopqrstuvwxyz12')).toBe('[redacted:openshore-token]');
  });

  it('a headless run stops searching once a result carried a secret', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('readFile', { path: 'notes.txt' }, 'c1'),
      toolTurn('webSearch', { query: 'release notes' }, 'c2'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, {
      profile: 'headless',
      offline: true,
      offlineSearch: true,
      files: { 'notes.txt': 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz' },
    });
    await session.agent.run('check');
    const denied = session.events.filter(
      (e): e is Extract<typeof e, { type: 'tool-denied' }> => e.type === 'tool-denied',
    );
    expect(denied.map((e) => e.call.name)).toEqual(['webSearch']);
    expect(denied[0]!.reason).toMatch(/private note or something that looked like a secret/);
  });

  it('a clean headless run may search when the switch allowed it', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('webSearch', { query: 'perplexity backend refused' }, 'c1'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, {
      profile: 'headless',
      offline: true,
      offlineSearch: true,
      configOverrides: { search: { backend: 'perplexity' } },
    });
    await session.agent.run('check');
    const denied = session.events.filter((e) => e.type === 'tool-denied');
    expect(denied).toHaveLength(1);
    expect(session.approvals).toEqual([]);
  });
});
