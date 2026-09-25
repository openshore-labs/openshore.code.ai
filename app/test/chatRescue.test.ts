// No dead ends in chat (founder, 2026-09-25): a failed turn always leaves a way
// to keep talking. These pin the pure choices behind the stopped card.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  isFailedStop,
  isSetupFailure,
  pointsAtConnections,
  rescueSource,
} from '../src/lib/chatRescue.js';
import { WORKSPACE_HINT } from '../src/lib/providers.js';

const harborLite = { modelId: 'harbor-lite', modelName: 'Harbor Lite' };
const phone = { harborLiteHost: true, harborLite, stackReady: false };

describe('chat rescue', () => {
  it('continues a failed Claude chat on Harbor Lite on the phone', () => {
    expect(rescueSource({ kind: 'cloud', provider: 'anthropic', model: 'claude' }, phone)).toEqual({
      kind: 'device',
      ...harborLite,
    });
  });

  it('never rescues onto the brain that just failed', () => {
    expect(rescueSource({ kind: 'device', ...harborLite }, phone)).toBeUndefined();
    expect(
      rescueSource({ kind: 'stack' }, { harborLiteHost: false, harborLite, stackReady: true }),
    ).toBeUndefined();
  });

  it('falls back to the Stack off the phone, and to nothing when nothing is ready', () => {
    const cloud = { kind: 'cloud' as const, provider: 'anthropic', model: 'claude' };
    expect(rescueSource(cloud, { harborLiteHost: false, harborLite, stackReady: true })).toEqual({
      kind: 'stack',
    });
    expect(
      rescueSource(cloud, { harborLiteHost: false, harborLite, stackReady: false }),
    ).toBeUndefined();
  });

  it('reads the workspace-id stop as a setup failure that points at Cloud Connections', () => {
    expect(isFailedStop(WORKSPACE_HINT)).toBe(true);
    expect(isSetupFailure(WORKSPACE_HINT)).toBe(true);
    expect(pointsAtConnections(WORKSPACE_HINT)).toBe(true);
  });

  it('a stop the person asked for is not a failure', () => {
    expect(isFailedStop('Stopped at your request.')).toBe(false);
    expect(isFailedStop('The step was declined.')).toBe(false);
  });

  it('every failed stop in the transcript carries a way on', () => {
    const src = readFileSync(new URL('../src/components/MessageList.tsx', import.meta.url), 'utf8');
    expect(src).toContain('Continue with {rescueLabel}');
    expect(src).toContain('Choose another model');
    const chat = readFileSync(new URL('../src/screens/ChatScreen.tsx', import.meta.url), 'utf8');
    expect(chat).toMatch(/onRescue=/);
    expect(chat).toMatch(/onPickModel=/);
  });

  it('a guide skips a Claude key whose setup a turn proved wrong', () => {
    const store = readFileSync(new URL('../src/state/store.ts', import.meta.url), 'utf8');
    expect(store).toContain('s.cloudKeyPresent && !s.cloudKeyNeedsFix');
  });
});
