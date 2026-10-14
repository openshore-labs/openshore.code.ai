// Turning push back off at sign-out and when a computer is forgotten (security
// review 2026-10-01, follow-up 2). A device only ever deletes its own token and
// the grants it minted, a forget only that computer's grant, and nothing here
// can hold up a sign-out.
import { describe, expect, it, vi } from 'vitest';
import {
  forgetHubBody,
  grantIdsHere,
  pushForgottenPatch,
  signOutBody,
  unregisterPush,
} from '../src/state/pushOps.js';
import type { AppSettings } from '../src/state/store.js';

const A = 'http://100.64.0.1:7777';
const B = 'http://100.64.0.2:7777';
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'ab'.repeat(32);

function settings(extra: Partial<AppSettings> = {}): AppSettings {
  return {
    pushRegisteredDaemons: [A, B],
    pushGrantIds: { [A]: ID_A, [B]: ID_B },
    ...extra,
  } as AppSettings;
}

describe('the sign-out body', () => {
  it("names this device's token and its own grants, never all", () => {
    const body = signOutBody(settings(), TOKEN);
    expect(body).toEqual({ token: TOKEN, grantIds: [ID_A, ID_B] });
    expect(body).not.toHaveProperty('all');
  });

  it('sends the grants alone when the device has no token yet', () => {
    expect(signOutBody(settings(), undefined)).toEqual({ grantIds: [ID_A, ID_B] });
  });

  it('asks nothing when there is nothing to delete', () => {
    expect(signOutBody({} as AppSettings, undefined)).toBeUndefined();
  });

  it('reads only real ids', () => {
    expect(grantIdsHere(settings({ pushGrantIds: { [A]: ID_A, [B]: '' } }))).toEqual([ID_A]);
  });
});

describe('forgetting a computer', () => {
  it("deletes only that computer's grant", () => {
    expect(forgetHubBody(settings(), A)).toEqual({ grantIds: [ID_A] });
  });

  it('asks nothing for a computer registered before grant ids were kept', () => {
    expect(forgetHubBody(settings({ pushGrantIds: undefined }), A)).toBeUndefined();
  });

  it('forgets the registration there, so the next session registers afresh', () => {
    expect(pushForgottenPatch(settings(), A)).toEqual({
      pushRegisteredDaemons: [B],
      pushGrantIds: { [B]: ID_B },
    });
  });

  it('changes nothing for a computer that never registered', () => {
    expect(pushForgottenPatch(settings(), 'http://100.64.0.9:7777')).toBeUndefined();
  });

  it('clears every registration at sign-out', () => {
    expect(pushForgottenPatch(settings())).toEqual({
      pushRegisteredDaemons: undefined,
      pushGrantIds: undefined,
    });
    expect(pushForgottenPatch({} as AppSettings)).toBeUndefined();
  });
});

describe('the unregister call', () => {
  it('resolves true when the server confirms', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    await expect(unregisterPush({ grantIds: [ID_A] }, invoke)).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith({ grantIds: [ID_A] });
  });

  it('never throws on a refusal', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(unregisterPush({ grantIds: [ID_A] }, invoke)).resolves.toBe(false);
  });

  it('never waits past its bound', async () => {
    const invoke = vi.fn(() => new Promise(() => {}));
    await expect(unregisterPush({ all: true }, invoke, 10)).resolves.toBe(false);
  });

  it('makes no call with nothing to delete', async () => {
    const invoke = vi.fn();
    await expect(unregisterPush(undefined, invoke)).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});
