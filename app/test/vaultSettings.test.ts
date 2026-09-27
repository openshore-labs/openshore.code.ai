// Vault M7, the customization surface (CTO L5 to L7, L11 to L13, L18; CX Y1 to
// Y17). One file, fenced by owner so the wave 1 streams never touch the same
// lines: wave 0's guards, stream E's providers, stream F's settings loader,
// sheet logic and starter, and wave 2's room wiring.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SRC = join(ROOT, 'src');

// ---- M7 wave 0 begin ----

describe("the settings writer is the person's alone (L7)", () => {
  it('the app agent path never names writeConfig or vaultWriteConfig', () => {
    const text = readFileSync(join(SRC, 'lib/vaultTool.ts'), 'utf8');
    expect(text).not.toMatch(/\b(?:writeConfig|writeVaultConfigFile|vaultWriteConfig)\b/);
  });

  it('no driver names them either', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
      });
    const hits = walk(join(SRC, 'drivers')).filter((f) =>
      /\b(?:writeConfig|writeVaultConfigFile|vaultWriteConfig)\b/.test(readFileSync(f, 'utf8')),
    );
    expect(hits.map((f) => relative(SRC, f))).toEqual([]);
  });
});

// ---- M7 wave 0 end ----

// ---- M7 stream E begin ----
// Providers (L7, L16): writeConfig on the desktop folder, the hub and Local
// (ifMatch, ifAbsent, `obsidian/*` refused); settingsWrite lit only with
// writeConfig, compare-and-swap, writable and not away; the team vault on
// main has no writeConfig and reads defaults.

// The contract rows (ifMatch, ifAbsent, a conflict hands back theirs) are in
// providerContract.test.ts for all three; the caps rows in vaultCaps.test.ts.
// Here: how each one keeps the file. The mocks are scoped to this fence
// (doMock, then unmock), so the other fences import the real modules.

describe('writeConfig on each provider (stream E)', () => {
  const E = {
    store: new Map<string, string>(),
    sealed: [] as string[],
    bridge: undefined as Record<string, unknown> | undefined,
  };
  type Mods = {
    local: typeof import('../src/lib/gitos/local.js');
    hub: typeof import('../src/lib/gitos/hub.js');
    folder: typeof import('../src/lib/gitos/deviceFolder.js');
    gitos: typeof import('../src/lib/gitos/index.js');
    caps: typeof import('../src/lib/vaultCaps.js');
    copy: typeof import('../src/lib/vaultCopy.js');
    fakeHubDaemon: typeof import('./support/fakeHubDaemon.js').fakeHubDaemon;
  };
  let m: Mods;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('../src/lib/platform.js', () => ({
      platform: () => 'electron',
      storeGetJson: async (k: string) => {
        const v = E.store.get(k);
        return v ? JSON.parse(v) : undefined;
      },
      storeSetJson: async (k: string, v: unknown) => {
        E.sealed.push(k);
        E.store.set(k, JSON.stringify(v));
      },
      storeDelete: async (k: string) => {
        E.store.delete(k);
      },
      storeKeys: async (prefix: string) => [...E.store.keys()].filter((k) => k.startsWith(prefix)),
      sealBlob: async (t: string) => `sealed:${t}`,
      openBlob: async (b: string) => (b.startsWith('sealed:') ? b.slice(7) : null),
    }));
    vi.doMock('../src/lib/electronBridge.js', () => ({ bridge: () => E.bridge }));
    m = {
      local: await import('../src/lib/gitos/local.js'),
      hub: await import('../src/lib/gitos/hub.js'),
      folder: await import('../src/lib/gitos/deviceFolder.js'),
      gitos: await import('../src/lib/gitos/index.js'),
      caps: await import('../src/lib/vaultCaps.js'),
      copy: await import('../src/lib/vaultCopy.js'),
      fakeHubDaemon: (await import('./support/fakeHubDaemon.js')).fakeHubDaemon,
    };
  });

  afterAll(() => {
    vi.doUnmock('../src/lib/platform.js');
    vi.doUnmock('../src/lib/electronBridge.js');
    vi.resetModules();
  });

  beforeEach(() => {
    E.store.clear();
    E.sealed = [];
    E.bridge = { vaultList: async () => [] };
  });

  const R = 'vault.personal';

  describe('This device keeps the settings in one sealed key', () => {
    it('writes the sealed key, never a note, and reads it back', async () => {
      const { localProvider } = m.local;
      const r = await localProvider.writeConfig!(R, 'oscode/vault', '{"version":1}\n', {
        ifAbsent: true,
      });
      expect(r.ok).toBe(true);
      expect(E.sealed).toEqual([`oscode.gitos.config.${R}.vault`]);
      expect([...E.store.keys()].some((k) => k.startsWith(`oscode.gitos.file.${R}.`))).toBe(false);
      expect(await localProvider.list(R)).toEqual([]);
      expect(await localProvider.readConfig!(R, 'oscode/vault')).toEqual({
        ok: true,
        text: '{"version":1}\n',
        version: r.ok ? r.file.version : '',
      });
      // Obsidian's names stay absent here: nothing writes them.
      expect(await localProvider.readConfig!(R, 'obsidian/app')).toEqual({
        ok: false,
        reason: 'absent',
      });
    });

    it('a note write under a dot folder is refused, so nothing poses as the file (L8)', async () => {
      const { localProvider } = m.local;
      for (const path of ['.oscode/vault.json', '.oscode/x.md', '.obsidian/app.json', 'a/.b.md']) {
        await expect(localProvider.write(R, path, '{}')).rejects.toThrow(/not a note name/);
      }
      expect(E.store.size).toBe(0);
      expect((await localProvider.write(R, 'Plans.md', 'ok')).ok).toBe(true);
    });

    it('a note and the settings keep versions of their own', async () => {
      const { localProvider } = m.local;
      const note = await localProvider.write(R, 'a.md', 'x', { ifAbsent: true });
      const cfg = await localProvider.writeConfig!(R, 'oscode/vault', '{}', { ifAbsent: true });
      expect(note.ok && cfg.ok && note.file.version !== cfg.file.version).toBe(true);
      // The note's version is no guard for the settings file.
      const stale = await localProvider.writeConfig!(R, 'oscode/vault', '{"a":1}', {
        ifMatch: note.ok ? note.file.version! : '',
      });
      expect(stale).toMatchObject({ ok: false, conflict: 'changed', theirs: { text: '{}' } });
    });
  });

  describe('Your computer writes through PUT /vault/config/oscode/vault', () => {
    const make = () => {
      const d = m.fakeHubDaemon();
      const p = m.hub.createHubProvider({
        baseUrl: 'http://mac.tail1234.ts.net:4816',
        token: async () => d.token,
        hubUserId: 'owner',
        fetch: d.fetch,
      });
      return { d, p };
    };

    it('sends the text with exactly one guard, and answers the new version', async () => {
      const { d } = make();
      const seen: unknown[] = [];
      const inner = d.fetch;
      d.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'PUT') seen.push(JSON.parse(String(init.body)));
        return inner(input, init);
      }) as typeof fetch;
      const q = m.hub.createHubProvider({
        baseUrl: 'http://mac.tail1234.ts.net:4816',
        token: async () => d.token,
        hubUserId: 'owner',
        fetch: d.fetch,
      });
      const first = await q.writeConfig!(R, 'oscode/vault', 'one', { ifAbsent: true });
      const version = first.ok ? first.file.version! : '';
      expect(version).toBe(d.configVersions.get('oscode/vault'));
      await q.writeConfig!(R, 'oscode/vault', 'two', { ifMatch: version });
      expect(seen).toEqual([
        { text: 'one', ifAbsent: true },
        { text: 'two', ifMatch: version },
      ]);
      expect(d.calls.filter((c) => c.startsWith('PUT'))).toEqual([
        'PUT /vault/config/oscode/vault',
        'PUT /vault/config/oscode/vault',
      ]);
    });

    it('an obsidian/* name never leaves this device', async () => {
      const { d, p } = make();
      await expect(
        p.writeConfig!(R, 'obsidian/app' as 'oscode/vault', '{}', { ifAbsent: true }),
      ).rejects.toThrow(m.copy.VAULT_SETTINGS_NAME_REFUSED);
      expect(d.calls).toEqual([]);
    });

    it('a computer from before M7 says to update, and nothing changes', async () => {
      const { d, p } = make();
      d.old = true;
      await expect(p.writeConfig!(R, 'oscode/vault', '{}', { ifAbsent: true })).rejects.toThrow(
        m.copy.HUB_UPDATE_LINE,
      );
      expect(d.config.has('oscode/vault')).toBe(false);
    });

    it('away, the write throws and the reach reads away', async () => {
      const { d, p } = make();
      d.up = false;
      await expect(p.writeConfig!(R, 'oscode/vault', '{}', { ifAbsent: true })).rejects.toThrow();
      expect(p.reach()).toBe('away');
    });

    it('the registered face refuses in plain words with nothing paired', async () => {
      m.hub.setHubVaultLink(undefined);
      await expect(
        m.hub.hubProvider.writeConfig!(R, 'oscode/vault', '{}', { ifAbsent: true }),
      ).rejects.toThrow(m.copy.HUB_PAIR_LINE);
    });
  });

  describe('This folder writes through osc:vaultWriteConfig', () => {
    it('sends only the name, the text and a plain guard', async () => {
      const calls: unknown[][] = [];
      E.bridge = {
        vaultList: async () => [],
        vaultWriteConfig: async (...args: unknown[]) => {
          calls.push(args);
          return { ok: true, version: 'v9' };
        },
      };
      const r = await m.folder.deviceFolderProvider.writeConfig!(R, 'oscode/vault', '{}', {
        ifMatch: 'v8',
      });
      expect(r).toMatchObject({ ok: true, file: { path: '.oscode/vault.json', version: 'v9' } });
      expect(calls).toEqual([['oscode/vault', '{}', { ifMatch: 'v8' }]]);
    });

    it('a desktop whose main lacks the call says to update', async () => {
      await expect(
        m.folder.deviceFolderProvider.writeConfig!(R, 'oscode/vault', '{}', { ifAbsent: true }),
      ).rejects.toThrow(m.copy.VAULT_CAP_UPDATE_LINE);
    });

    it("main's answer is held to the seam: refusals throw, a wrong shape never reads as saved", () => {
      const { configWriteAnswer } = m.folder;
      expect(() => configWriteAnswer({ ok: false, reason: 'refused' }, 't')).toThrow(
        m.copy.VAULT_SETTINGS_WRITE_REFUSED,
      );
      expect(() => configWriteAnswer({ ok: false, reason: 'too-large' }, 't')).toThrow(
        m.copy.VAULT_SETTINGS_TOO_LARGE,
      );
      for (const bad of [undefined, null, 'ok', { ok: true }, { ok: true, version: '' }, {}]) {
        expect(() => configWriteAnswer(bad, 't')).toThrow(m.copy.VAULT_CAP_UPDATE_LINE);
      }
      expect(
        configWriteAnswer(
          { ok: false, conflict: 'changed', current: { text: 'theirs', version: 'v2' } },
          'mine',
        ),
      ).toMatchObject({
        ok: false,
        conflict: 'changed',
        theirs: { text: 'theirs', version: 'v2' },
      });
      expect(configWriteAnswer({ ok: false, conflict: 'missing' }, 'mine')).toEqual({
        ok: false,
        conflict: 'missing',
      });
    });
  });

  describe('settingsWrite on the storages on main (L7, L16)', () => {
    it('lights where writeConfig is, and the team vault reads defaults', () => {
      const lit = (id: Parameters<typeof m.gitos.providerFor>[0]) =>
        m.caps.vaultCaps(m.gitos.providerFor(id)!, { readOnly: false }).settingsWrite;
      expect(lit('local')).toBe(true);
      expect(lit('files')).toBe(true);
      expect(lit('hub')).toBe(true);
      expect(lit('org')).toBe(false);
      expect(lit('gdrive')).toBe(false);
      expect(lit('icloud')).toBe(false);
    });

    it("says why where it does not, in the storage's own words", () => {
      const { vaultCapLine } = m.copy;
      expect(vaultCapLine('org', 'settingsWrite')).toBe(
        'Team vault settings cannot change here yet.',
      );
      expect(vaultCapLine('gdrive', 'settingsWrite')).toMatch(/^Google Drive vaults are read-only/);
      expect(vaultCapLine('icloud', 'settingsWrite')).toMatch(/iCloud Drive/);
    });
  });
});

// ---- M7 stream E end ----

// ---- M7 stream F begin ----
// Settings (L5, L6, L11 to L13, L18; CX Y2, Y3, Y5, Y13, Y17): no files
// equals VAULT_SETTINGS_DEFAULTS and today's behavior; a `.obsidian` field
// renders read-only with "From Obsidian"; a widening ask yields one set-aside
// line and changes nothing; a bad file writes nothing; a same-field conflict
// shows "Use {yours}"; the cache and its invalidations; delete mode; the
// starter is refused on a non-empty vault and writes ifAbsent.

describe.todo('vault settings in the app (stream F)');

// ---- M7 stream F end ----

// ---- M7 wave 2 begin ----
// The room (Y4, Y7): the entry points, the Wayfinding rows, the overrides
// into vaultOverrides, the team read-only footer.

describe.todo('vault settings in the room (wave 2)');

// ---- M7 wave 2 end ----
