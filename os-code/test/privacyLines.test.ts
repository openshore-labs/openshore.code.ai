// The words said once a chat holds a private note's text (UX and copy review,
// 2026-10-08), pinned word for word, and reachable through os-code/protocol
// so the app says exactly what the engine says.
import { describe, expect, it } from 'vitest';
import * as protocol from '../src/protocol.js';
import * as loop from '../src/core/agent/loop.js';

describe('the private-note lines', () => {
  it('say the ruled words', () => {
    expect(protocol.handoffRefusalLine('read')).toBe(
      'This chat has read a private note, so this step is not handed to a cloud model.',
    );
    expect(protocol.handoffRefusalLine('pin')).toBe(
      'A private note is pinned to this project, so this step is not handed to a cloud model.',
    );
    expect(protocol.memoryWhyLine('read')).toBe(
      'This chat has read a private note, and a cloud model may later read what this change writes.',
    );
    expect(protocol.memoryWhyLine('pin')).toBe(
      'A private note is pinned to this project, and a cloud model may later read what this change writes.',
    );
    expect(protocol.MEMORY_DECLINED).toBe(
      'Not run: the person kept this project note as it was. Carry on without updating it.',
    );
    expect(protocol.MEMORY_ROUTINE_REFUSED).toBe(
      "Not run: this run drew on a private note, so a change to the project's memory notes needs the person's approval, and a routine cannot ask for it. Carry on without it.",
    );
    expect(protocol.WEB_DECLINED).toBe(
      'Not run: the person kept this off the web. Answer from what you have.',
    );
    expect(protocol.privateSearchCard('SearXNG', 'march tides', 'read')).toEqual({
      summary: 'Search SearXNG for "march tides"',
      detail:
        'This chat has read a private note. These words go to SearXNG as written, so check that they carry nothing from it. Nothing is sent without this approval.',
    });
    expect(protocol.privatePageCard('example.org', 'https://example.org/a', 'pin')).toEqual({
      summary: 'Open example.org',
      detail:
        'A private note is pinned to this project. Nothing is sent without this approval. This address goes to example.org as written, so check that it carries nothing from the note: https://example.org/a',
    });
    expect(protocol.searchServiceName('tavily')).toBe('Tavily');
    expect(protocol.searchServiceName('duckduckgo')).toBe('DuckDuckGo');
    expect(protocol.handoffCardSummary('gpt-5', 'fast answers')).toBe(
      'This step goes to gpt-5, the cloud model you placed for fast answers.',
    );
    expect(protocol.handoffDeclined('gpt-5')).toBe('You declined sending this step to gpt-5.');
  });

  it('the engine says the same words it exports', () => {
    expect(loop.HANDOFF_LOCAL_ONLY_DENIED).toBe(protocol.HANDOFF_LOCAL_ONLY_DENIED);
    expect(loop.HANDOFF_PIN_DENIED).toBe(protocol.HANDOFF_PIN_DENIED);
    expect(loop.placeholderLine('m')).toBe(protocol.placeholderLine('m'));
    expect(protocol.hostIsLoopback('127.0.0.1')).toBe(true);
  });
});
