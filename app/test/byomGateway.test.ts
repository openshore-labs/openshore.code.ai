// "Passes requests to a cloud provider" (bring your own keys, Part 2,
// 2026-10-09): a stricter-only mark on a connection. A gateway on your own
// network or tailnet (LiteLLM in front of Bedrock or Azure) that carries it
// is cloud to every judge that decides where a note may go: the reach chip
// and Image reading slots (byomReach, refStaysLocal), the pack seat
// (packSeatFor), and through it the history stub and the vault tools. The
// mark never makes an address local, and it never loosens the plain-http
// refusal, which is about the hop to the address.
import { describe, expect, it } from 'vitest';
import { LOCAL_ONLY_STUB, compileVaultPrivacy } from 'os-code/protocol';
import {
  byomPlainHttpToCloud,
  byomReach,
  byomRef,
  byomWireOf,
  keepsListedWindow,
  type ByomConnection,
} from '../src/lib/byom.js';
import { refStaysLocal, visionSlots, type StackModelRef } from '../src/lib/stack.js';
import { packSeatFor } from '../src/lib/vaultSeat.js';
import { historyForSeat } from '../src/drivers/stackDriver.js';
import { runVaultTool } from '../src/lib/vaultTool.js';

const ON_YOUR_NETWORK = [
  'http://192.168.1.30:4000/v1',
  'http://10.0.0.5:4000',
  'http://localhost:4000/v1',
  'http://100.101.102.103:4000/v1',
  'https://gateway.tail1234.ts.net/v1',
];

const conn = (baseUrl: string, over: Partial<ByomConnection> = {}): ByomConnection => ({
  id: 'gw',
  label: 'Gateway',
  baseUrl,
  model: 'bedrock-claude',
  ...over,
});

describe('the mark makes a gateway on your network cloud', () => {
  it.each(ON_YOUR_NETWORK)('%s: local unmarked, cloud marked, to the reach judge', (url) => {
    expect(byomReach(url, 'tail1234.ts.net')).toBe('local');
    expect(byomReach(url, 'tail1234.ts.net', 'bedrock-claude', true)).toBe('cloud');
    const plain = byomRef(conn(url));
    const marked = byomRef(conn(url, { forwardsToCloud: true }));
    expect(refStaysLocal(plain, 'tail1234.ts.net')).toBe(true);
    expect(refStaysLocal(marked, 'tail1234.ts.net')).toBe(false);
  });

  it.each(ON_YOUR_NETWORK)(
    '%s: the pack seat leaves when marked, on the ref or the connection',
    (url) => {
      const ctx = { ownTailnetSuffix: 'tail1234.ts.net' };
      const plain = byomRef(conn(url));
      expect(packSeatFor(plain, ctx)?.leavesNetwork).toBe(false);
      expect(packSeatFor(byomRef(conn(url, { forwardsToCloud: true })), ctx)?.leavesNetwork).toBe(
        true,
      );
      // A ref placed before the mark was set still leaves: the store reads the
      // connection too (stricter only).
      expect(
        packSeatFor(plain, { ...ctx, byomForwardsToCloud: (id) => id === 'gw' })?.leavesNetwork,
      ).toBe(true);
    },
  );

  it('never makes a public address local, marked or not', () => {
    for (const url of ['https://api.example.com/v1', 'http://8.8.8.8:4000/v1']) {
      expect(byomReach(url, null, 'm', false)).toBe('cloud');
      expect(byomReach(url, null, 'm', undefined)).toBe('cloud');
      const ref = byomRef(conn(url, { forwardsToCloud: false }));
      expect(refStaysLocal(ref)).toBe(false);
      expect(packSeatFor(ref, { ownTailnetSuffix: null })?.leavesNetwork).toBe(true);
      expect(
        packSeatFor(ref, { ownTailnetSuffix: null, byomForwardsToCloud: () => false })
          ?.leavesNetwork,
      ).toBe(true);
    }
  });

  it('a marked gateway is the Cloud image reader, never the Local one', () => {
    const marked = byomRef(conn('http://192.168.1.30:4000/v1', { forwardsToCloud: true }));
    const slots = visionSlots({
      active: [{ ref: marked, placement: { category: 'vision' } }],
      saved: {},
    });
    expect(slots.local).toBeUndefined();
    expect(slots.cloud?.ref).toEqual(marked);
  });

  it('keeps the plain-http refusal about the hop, not the mark', () => {
    // Plain http to your own network is allowed, gateway or not; the gateway
    // sends on over its own connection to its provider.
    expect(byomPlainHttpToCloud('http://192.168.1.30:4000/v1')).toBe(false);
    expect(byomPlainHttpToCloud('http://gateway.example.com:4000/v1')).toBe(true);
  });

  it('keeps a listed window only where the provider serves it', () => {
    expect(keepsListedWindow('http://192.168.1.30:4000/v1', null, false)).toBe(false);
    expect(keepsListedWindow('http://192.168.1.30:4000/v1', null, true)).toBe(true);
    expect(keepsListedWindow('https://api.example.com/v1', null, false)).toBe(true);
  });
});

describe('what a marked gateway is sent', () => {
  const marked = byomRef(conn('http://192.168.1.30:4000/v1', { forwardsToCloud: true }));
  const seat = packSeatFor(marked, { ownTailnetSuffix: null })!;

  it('a private turn reaches it as the placeholder', () => {
    const history = [
      { role: 'user' as const, content: 'diary?' },
      { role: 'assistant' as const, content: 'The secret is teal.', localOnly: true as const },
    ];
    expect(historyForSeat(history, seat.leavesNetwork)[1]!.content).toBe(LOCAL_ONLY_STUB);
    const plainSeat = packSeatFor(byomRef(conn('http://192.168.1.30:4000/v1')), {
      ownTailnetSuffix: null,
    })!;
    expect(historyForSeat(history, plainSeat.leavesNetwork)[1]!.content).toBe(
      'The secret is teal.',
    );
  });

  it('a vault read of a private note stays on this device', async () => {
    const privacy = compileVaultPrivacy({
      exclude: [],
      localOnly: { paths: ['Private/**'], tags: [] },
    });
    const ctx = {
      seat,
      privacy,
      search: async () => [],
      read: async () => ({ text: '# Diary\nThe secret is teal.', version: 'v1' }),
      readCapChars: 64000,
      propose: () => undefined,
    };
    const r = await runVaultTool({ name: 'vaultRead', input: { path: 'Private/Diary.md' } }, ctx);
    expect(r.content).toContain('stays on this computer');
    expect(r.content).not.toContain('teal');
  });
});

describe('a ref saved before formats and the mark existed', () => {
  it('reads as OpenAI-compatible and not forwarding, and byomRef adds nothing to it', () => {
    const legacy: StackModelRef = {
      kind: 'byom',
      id: 'old',
      label: 'Old',
      baseUrl: 'http://192.168.1.20:11434/v1',
      model: 'qwen2.5:14b',
    };
    expect(byomWireOf(legacy as { wire?: 'openai' | 'anthropic' })).toBe('openai');
    expect(refStaysLocal(legacy)).toBe(true);
    expect(packSeatFor(legacy, { ownTailnetSuffix: null })?.leavesNetwork).toBe(false);
    expect(
      byomRef(conn(legacy.baseUrl, { id: 'old', label: 'Old', model: 'qwen2.5:14b' })),
    ).toEqual(legacy);
    expect(Object.keys(byomRef(conn(legacy.baseUrl)))).toEqual([
      'kind',
      'id',
      'label',
      'baseUrl',
      'model',
    ]);
  });

  it('a new ref carries the format, the address and the mark', () => {
    expect(
      byomRef(
        conn('http://192.168.1.30:4000', {
          wire: 'anthropic',
          addressId: 'addr_1',
          forwardsToCloud: true,
        }),
      ),
    ).toEqual({
      kind: 'byom',
      id: 'gw',
      label: 'Gateway',
      baseUrl: 'http://192.168.1.30:4000',
      model: 'bedrock-claude',
      wire: 'anthropic',
      addressId: 'addr_1',
      forwardsToCloud: true,
    });
  });
});
