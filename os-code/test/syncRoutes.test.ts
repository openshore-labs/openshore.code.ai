// Sync on all devices, the computer's side for chats and projects (2026-10-16):
// one opaque document per chat or project, compare-and-swap on every write,
// each person in their own folder.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docVersion, syncRootFor, writeDoc } from '../src/core/sync/docStore.js';
import { syncRoute } from '../src/daemon/syncRoutes.js';

const freshRoot = () => mkdtempSync(join(tmpdir(), 'osc-sync-'));

function call(root: string, method: string, path: string, body?: Record<string, unknown>) {
  const url = new URL(`http://x/sync/${path}`);
  return syncRoute({
    method,
    parts: url.pathname.split('/').filter(Boolean).slice(1),
    url,
    root,
    readBody: async () => body ?? {},
  });
}

describe('the /sync routes', () => {
  it('creates, lists, reads, updates by version, and removes by version', async () => {
    const root = freshRoot();
    const made = await call(root, 'PUT', 'chats/c1', { text: '{"a":1}', ifAbsent: true });
    expect(made.status).toBe(200);
    const v1 = (made.json as { version: string }).version;
    expect(v1).toBe(docVersion('{"a":1}'));
    const list = await call(root, 'GET', 'chats');
    expect((list.json as { docs: Array<{ id: string; version: string }> }).docs).toEqual([
      expect.objectContaining({ id: 'c1', version: v1 }),
    ]);
    expect((await call(root, 'GET', 'chats/c1')).json).toEqual({ text: '{"a":1}', version: v1 });
    const upd = await call(root, 'PUT', 'chats/c1', { text: '{"a":2}', ifMatch: v1 });
    expect(upd.status).toBe(200);
    const v2 = (upd.json as { version: string }).version;
    expect((await call(root, 'DELETE', `chats/c1?ifMatch=${v1}`)).status).toBe(409);
    expect((await call(root, 'DELETE', `chats/c1?ifMatch=${v2}`)).status).toBe(200);
    expect((await call(root, 'GET', 'chats/c1')).status).toBe(404);
  });

  it('answers a stale or taken write as a conflict, and never writes it', async () => {
    const root = freshRoot();
    await call(root, 'PUT', 'projects/p1', { text: 'one', ifAbsent: true });
    expect(await call(root, 'PUT', 'projects/p1', { text: 'two', ifAbsent: true })).toEqual({
      status: 409,
      json: { conflict: 'exists' },
    });
    expect(await call(root, 'PUT', 'projects/p1', { text: 'two', ifMatch: 'old' })).toEqual({
      status: 409,
      json: { conflict: 'changed' },
    });
    expect((await call(root, 'GET', 'projects/p1')).json).toMatchObject({ text: 'one' });
  });

  it('takes a guard on every write, and only ids and kinds it knows', async () => {
    const root = freshRoot();
    expect((await call(root, 'PUT', 'chats/c1', { text: 'x' })).status).toBe(400);
    expect((await call(root, 'GET', 'chats/..%2Fx')).status).toBe(400);
    expect((await call(root, 'GET', 'secrets')).status).toBe(404);
    expect((await call(root, 'GET', 'chats/c1/more')).status).toBe(404);
  });

  it('settles two writes racing on one version: one lands, one is a conflict', async () => {
    const root = freshRoot();
    const first = await writeDoc(root, 'chats', 'c', 'start', { ifAbsent: true });
    const v = first.ok ? first.version : '';
    const [a, b] = await Promise.all([
      writeDoc(root, 'chats', 'c', 'from the phone', { ifMatch: v }),
      writeDoc(root, 'chats', 'c', 'from the iPad', { ifMatch: v }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    // No temporary file is left behind.
    expect(readdirSync(join(root, 'chats'))).toEqual(['c.json']);
  });

  it('keeps each person in their own folder, readable by this account alone', async () => {
    const owner = syncRootFor({ userId: 'me', role: 'admin' });
    const a = syncRootFor({ userId: 'u_a', role: 'member' });
    const b = syncRootFor({ userId: 'u_b', role: 'member' });
    expect(new Set([owner, a, b]).size).toBe(3);
    const root = freshRoot();
    await writeDoc(root, 'chats', 'c', 'x', { ifAbsent: true });
    if (process.platform !== 'win32') {
      expect(statSync(join(root, 'chats')).mode & 0o777).toBe(0o700);
      expect(statSync(join(root, 'chats', 'c.json')).mode & 0o777).toBe(0o600);
    }
  });
});
