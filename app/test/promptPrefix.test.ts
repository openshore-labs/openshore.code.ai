// A stable prefix in the app's Claude requests (Vault M5, CTO J16): the head
// of the system prompt stays byte-identical from send to send, and what moves
// (the effort line, the walk, the pack) rides the tail. With caching on, the
// head carries the one marker and the request asks for automatic caching on
// the history; off, neither is sent. Caching stays off until the eval says so.
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class FakeAnthropic {
    static APIUserAbortError = class extends APIError {};
    static AuthenticationError = class extends APIError {};
    static BadRequestError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static APIConnectionError = class extends APIError {};
    messages = {
      stream: (params: Record<string, unknown>) => {
        h.calls.push(params);
        return {
          on() {},
          abort() {},
          async finalMessage() {
            return {
              content: [{ type: 'text', text: 'ok' }],
              usage: { input_tokens: 1, output_tokens: 1 },
              stop_reason: 'end_turn',
            };
          },
        };
      },
    };
  }
  return { default: FakeAnthropic };
});

import type { DriverEvent } from 'os-code/protocol';
import {
  claudeHistoryCache,
  claudeSystem,
  promptCacheOn,
  setPromptCache,
} from '../src/lib/claudeCache.js';
import { CloudClaudeDriver, claudeRequestSystem } from '../src/drivers/cloudClaudeDriver.js';
import { DEFAULT_EFFORT, setActiveEffort } from '../src/lib/effort.js';
import type { AppVaultPack } from '../src/drivers/types.js';

afterEach(() => {
  setPromptCache(false);
  setActiveEffort(DEFAULT_EFFORT);
  h.calls.length = 0;
});

describe('claudeSystem (J16)', () => {
  it('unchanged inputs give a byte-identical prefix', () => {
    const a = claudeSystem('BASE\nPROJECT', ['effort', 'pack'], true);
    const b = claudeSystem('BASE\nPROJECT', ['effort', 'pack'], true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a changed walk line or pack moves only the tail', () => {
    const a = claudeSystem('BASE', ['walk: step 1', 'pack one'], true);
    const b = claudeSystem('BASE', ['walk: step 2', 'pack two'], true);
    expect(JSON.stringify(a[0])).toBe(JSON.stringify(b[0]));
    expect(a[1]!.text).not.toBe(b[1]!.text);
  });

  it('marks only the head, and only with caching on', () => {
    const on = claudeSystem('BASE', ['tail'], true);
    expect(on[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(on[1]!.cache_control).toBeUndefined();
    const off = claudeSystem('BASE', ['tail'], false);
    expect(off.every((b) => b.cache_control === undefined)).toBe(true);
  });

  it('drops empty parts, and no tail means one block', () => {
    expect(claudeSystem('BASE', [undefined, ' ', ''], true)).toHaveLength(1);
    expect(claudeSystem('BASE', ['a', undefined, 'b'], false)[1]!.text).toBe('a\nb');
  });

  it('asks for history caching only while on', () => {
    expect(claudeHistoryCache(true)).toEqual({ cache_control: { type: 'ephemeral' } });
    expect(claudeHistoryCache(false)).toEqual({});
  });

  it('is off by default (no claim without the eval)', () => {
    expect(promptCacheOn()).toBe(false);
  });
});

describe('the Claude driver runs stable to volatile (J16)', () => {
  it('orders the head before the effort line and the pack last', () => {
    const blocks = claudeRequestSystem('BASE\nProject: Demo', {
      effort: 'Reasoning effort: high.',
      pack: 'VAULT PACK',
      cache: true,
    });
    expect(blocks[0]!.text).toContain('Project: Demo');
    expect(blocks[0]!.text).not.toContain('Reasoning effort');
    expect(blocks[1]!.text.endsWith('VAULT PACK')).toBe(true);
  });

  function packWith(texts: string[]): AppVaultPack {
    let i = 0;
    return { prepare: async () => {}, render: () => ({ text: texts[i++] }) };
  }

  async function send(driver: CloudClaudeDriver, text: string): Promise<void> {
    const events: DriverEvent[] = [];
    const off = driver.subscribe((e) => events.push(e));
    driver.send(text);
    await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));
    off();
  }

  it('two sends keep the head byte-identical while the effort and pack move', async () => {
    setPromptCache(true);
    const driver = new CloudClaudeDriver('k', 'claude-opus-5', undefined, undefined, 'Demo', {
      vaultPack: packWith(['pack one', 'pack two']),
    });
    setActiveEffort('low');
    await send(driver, 'one');
    setActiveEffort('high');
    await send(driver, 'two');
    const [a, b] = h.calls.map((c) => c.system as Array<{ text: string }>);
    expect(JSON.stringify(a![0])).toBe(JSON.stringify(b![0]));
    expect(a![1]!.text).not.toBe(b![1]!.text);
    expect(h.calls[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('with caching off sends no marker anywhere', async () => {
    const driver = new CloudClaudeDriver('k', 'claude-opus-5');
    await send(driver, 'hi');
    expect(JSON.stringify(h.calls[0])).not.toContain('cache_control');
  });
});
