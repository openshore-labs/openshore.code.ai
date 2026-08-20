// At-rest encryption is a trust claim, so these tests pin the claim itself:
// the sealed format is byte-compatible with the app's WebCrypto sealer (a blob
// sealed by either side opens on the other), tampering is detected, plaintext
// from before encryption still reads, the data key is created once and held at
// mode 600 when it falls back to the file store, journals seal on write and
// replay after reload, the boot migration reseals legacy sessions without
// losing a byte, and Stack Health's seal grades from the measured disk state.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import {
  _resetDataKeyCache,
  isSealed,
  loadOrCreateDataKey,
  openString,
  sealString,
} from '../src/core/security/atRest.js';
import { _setSecretTool } from '../src/auth/store.js';
import { LocalDriver, listSessions, sealSessionsAtRest } from '../src/daemon/session.js';
import { computeStackHealth } from '../src/insights/stackHealth.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
  // Force the encrypted-file backend so tests never touch a real keychain.
  _setSecretTool(false);
  _resetDataKeyCache();
});
afterEach(() => {
  delete process.env.OSC_HOME;
  _setSecretTool(undefined);
  _resetDataKeyCache();
  rmSync(home, { recursive: true, force: true });
});

const KEY = Buffer.alloc(32, 7);

describe('the seal format', () => {
  it('round-trips and marks blobs as sealed', () => {
    const blob = sealString(KEY, 'the launch codes are: there are no launch codes');
    expect(isSealed(blob)).toBe(true);
    expect(blob.startsWith('enc:v1:')).toBe(true);
    expect(openString(KEY, blob)).toBe('the launch codes are: there are no launch codes');
  });

  it('passes plaintext through unchanged (data from before encryption)', () => {
    expect(openString(KEY, '{"seq":1,"event":{}}')).toBe('{"seq":1,"event":{}}');
  });

  it('returns null on tamper or the wrong key, never garbage', () => {
    const blob = sealString(KEY, 'intact');
    const [p, v, iv, ct] = blob.split(':');
    const flipped = `${ct[0] === 'A' ? 'B' : 'A'}${ct.slice(1)}`;
    expect(openString(KEY, `${p}:${v}:${iv}:${flipped}`)).toBeNull();
    expect(openString(Buffer.alloc(32, 8), blob)).toBeNull();
  });

  it('is byte-compatible with the app-side WebCrypto sealer, both directions', async () => {
    const subtle = webcrypto.subtle;
    const webKey = await subtle.importKey('raw', KEY, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
    const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

    // Engine-sealed blob opens under the app's WebCrypto open() logic.
    const engineSealed = sealString(KEY, 'sealed by node:crypto');
    const [ivPart, ctPart] = engineSealed.slice('enc:v1:'.length).split(':');
    const opened = await subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64url(ivPart) },
      webKey,
      fromB64url(ctPart),
    );
    expect(new TextDecoder().decode(opened)).toBe('sealed by node:crypto');

    // App-sealed blob (WebCrypto emits ciphertext||tag) opens under the engine.
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await subtle.encrypt(
        { name: 'AES-GCM', iv },
        webKey,
        new TextEncoder().encode('sealed by WebCrypto'),
      ),
    );
    const appSealed = `enc:v1:${b64url(iv)}:${b64url(ct)}`;
    expect(openString(KEY, appSealed)).toBe('sealed by WebCrypto');
  });
});

describe('the data key', () => {
  it('is created once, cached, and stable across loads', () => {
    const first = loadOrCreateDataKey();
    expect(first).toBeDefined();
    expect(first?.key.length).toBe(32);
    _resetDataKeyCache();
    const second = loadOrCreateDataKey();
    expect(second?.key.equals(first!.key)).toBe(true);
  });

  it('reports the file backend honestly and holds the store at mode 600', () => {
    const dk = loadOrCreateDataKey();
    expect(dk?.protection).toBe('encrypted-file');
    const mode = statSync(join(home, 'credentials')).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('journal sealing', () => {
  it('seals every line on write and replays after reload', () => {
    const driver = new LocalDriver(home, { id: 'seal1' });
    driver.emit({ type: 'task-start', input: 'private prompt about my secret project' });
    driver.emit({ type: 'turn-start', turn: 1, model: 'qwen', providerKind: 'local' });

    const raw = readFileSync(join(home, 'sessions', 'seal1', 'events.jsonl'), 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim());
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(isSealed(line)).toBe(true);
      expect(line.includes('secret project')).toBe(false);
    }

    const reloaded = new LocalDriver(home, { id: 'seal1' });
    const replayed: string[] = [];
    reloaded.subscribe((event) => replayed.push(event.type));
    expect(replayed).toEqual(['task-start', 'turn-start']);
  });

  it('seals the session title and lists it back in the clear', () => {
    const driver = new LocalDriver(home, { id: 'seal2' });
    driver.emit({ type: 'task-start', input: 'rename the billing tables' });
    const infoRaw = JSON.parse(
      readFileSync(join(home, 'sessions', 'seal2', 'info.json'), 'utf8'),
    ) as { title: string };
    expect(isSealed(infoRaw.title)).toBe(true);
    const listed = listSessions().find((s) => s.id === 'seal2');
    expect(listed?.title).toBe('rename the billing tables');
  });

  it('still reads a legacy journal with plaintext lines mixed in', () => {
    const dir = join(home, 'sessions', 'legacy');
    mkdirSync(dir, { recursive: true });
    const dk = loadOrCreateDataKey()!;
    const plain = JSON.stringify({ seq: 1, event: { type: 'task-start', input: 'old' } });
    const sealed = sealString(
      dk.key,
      JSON.stringify({ seq: 2, event: { type: 'task-done', reason: 'complete' } }),
    );
    writeFileSync(join(dir, 'events.jsonl'), `${plain}\n${sealed}\n`);
    writeFileSync(
      join(dir, 'info.json'),
      JSON.stringify({ id: 'legacy', cwd: home, title: 'old', createdAt: 'x', updatedAt: 'x' }),
    );

    const driver = new LocalDriver(home, { id: 'legacy' });
    const replayed: string[] = [];
    driver.subscribe((event) => replayed.push(event.type));
    expect(replayed).toEqual(['task-start', 'task-done']);
  });
});

describe('the migration', () => {
  function writeLegacySession(id: string, title: string): void {
    const dir = join(home, 'sessions', id);
    mkdirSync(dir, { recursive: true });
    const lines = [
      JSON.stringify({ seq: 1, event: { type: 'task-start', input: `${id} prompt` } }),
      JSON.stringify({ seq: 2, event: { type: 'task-done', reason: 'complete' } }),
    ];
    writeFileSync(join(dir, 'events.jsonl'), `${lines.join('\n')}\n`);
    writeFileSync(
      join(dir, 'info.json'),
      JSON.stringify({
        id,
        cwd: home,
        title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  it('reseals legacy plaintext without losing a byte, and is idempotent', () => {
    writeLegacySession('mig1', 'my private title');
    const first = sealSessionsAtRest();
    expect(first.sealedLines).toBe(2);

    const raw = readFileSync(join(home, 'sessions', 'mig1', 'events.jsonl'), 'utf8');
    for (const line of raw.split('\n')) {
      if (line.trim()) expect(isSealed(line)).toBe(true);
    }
    const info = JSON.parse(readFileSync(join(home, 'sessions', 'mig1', 'info.json'), 'utf8'));
    expect(isSealed(info.title)).toBe(true);
    expect(listSessions().find((s) => s.id === 'mig1')?.title).toBe('my private title');

    // The events replay intact after resealing.
    const driver = new LocalDriver(home, { id: 'mig1' });
    const replayed: string[] = [];
    driver.subscribe((event) => replayed.push(event.type));
    expect(replayed).toEqual(['task-start', 'task-done']);

    // Second pass changes nothing.
    expect(sealSessionsAtRest().sealedLines).toBe(0);
  });
});

describe('the measured seal in Stack Health', () => {
  it('reads sealed journals and grades the file-backed key as a note, not green', () => {
    const driver = new LocalDriver(home, { id: 'sh1' });
    driver.emit({ type: 'task-start', input: 'do a thing' });
    driver.emit({ type: 'turn-start', turn: 1, model: 'qwen', providerKind: 'local' });
    driver.emit({
      type: 'usage',
      promptTokens: 100,
      completionTokens: 50,
      dollars: 0,
      contextPercent: 1,
    });
    driver.emit({ type: 'task-done', reason: 'complete' });

    const health = computeStackHealth('all');
    expect(health.privacyRing.localTurns).toBe(1);
    expect(health.tokens.local.prompt).toBe(100);

    const fact = health.seal.find((f) => f.key === 'encryptedAtRest')!;
    // Everything is sealed, but the key sits in the encrypted file (no
    // keychain in tests), so the honest grade is a note, never green.
    expect(fact.state).toBe('note');
    expect(fact.label).toContain('encrypted at rest');
  });

  it('counts remaining plaintext lines and says so', () => {
    const dir = join(home, 'sessions', 'sh2');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'events.jsonl'),
      `${JSON.stringify({ seq: 1, event: { type: 'task-start', input: 'old' } })}\n`,
    );
    writeFileSync(
      join(dir, 'info.json'),
      JSON.stringify({
        id: 'sh2',
        cwd: home,
        title: 'old',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    const fact = computeStackHealth('all').seal.find((f) => f.key === 'encryptedAtRest')!;
    expect(fact.state).toBe('note');
    expect(fact.label).toContain('1 older line');
  });
});

describe('CTO must-fix hardening', () => {
  it('breaks a stale first-run create lock and still creates a key', () => {
    const lock = join(home, 'data-key.lock');
    mkdirSync(lock, { recursive: true });
    // Age the lock past the stale threshold, as a crashed creator would.
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const dk = loadOrCreateDataKey();
    expect(dk).toBeDefined();
    expect(dk?.key.length).toBe(32);
  });

  it('forces a trailing newline when migrating a crash-truncated journal', () => {
    const dir = join(home, 'sessions', 'trunc');
    mkdirSync(dir, { recursive: true });
    // No trailing newline: the shape a crash mid-append leaves behind.
    writeFileSync(
      join(dir, 'events.jsonl'),
      JSON.stringify({ seq: 1, event: { type: 'task-start', input: 'x' } }),
    );
    writeFileSync(
      join(dir, 'info.json'),
      JSON.stringify({ id: 'trunc', cwd: home, title: 't', createdAt: 'x', updatedAt: 'x' }),
    );
    sealSessionsAtRest();
    const raw = readFileSync(join(dir, 'events.jsonl'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(isSealed(raw.trim())).toBe(true);
  });

  it('leaves a journal alone while another process may be appending to it', () => {
    const dir = join(home, 'sessions', 'busy');
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ seq: 1, event: { type: 'task-start', input: 'x' } });
    writeFileSync(join(dir, 'events.jsonl'), `${line}\n`);
    // Freshly written file + a guard window: the migration must not touch it.
    const guarded = sealSessionsAtRest({ skipNewerThanMs: 60_000 });
    expect(guarded.sealedLines).toBe(0);
    expect(readFileSync(join(dir, 'events.jsonl'), 'utf8')).toBe(`${line}\n`);
    // Without the guard (the file is old enough), it seals.
    const unguarded = sealSessionsAtRest();
    expect(unguarded.sealedLines).toBe(1);
  });
});
