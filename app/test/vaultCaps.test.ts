// What the Vault offers on a storage (Vault M6, CTO K1; R2): one pure
// `vaultCaps`, lit by the provider's members and never by its id.
// - Every write-shaped cap needs compareAndSwap, so a provider without it
//   gets none, whatever members it has.
// - One-tap delete (`trash`) only where Trash is real: trash, list and
//   restore, all three.
// - Read-only and away turn the writes off; reading attachments and opening
//   Today's note stay.
// - The real providers on main answer the table below, so a held branch that
//   adds members changes this table and nothing in the room.
// - Every provider and cap pair has an honest line (vaultCapLine) that
//   passes the house copy rules, and every cap a provider on main lacks has
//   a line of its own, not the generic one.
import { describe, expect, it, vi } from 'vitest';
import type { StorageProvider } from '../src/lib/gitos/providers.js';

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'electron',
  storeGetJson: async () => undefined,
  storeSetJson: async () => {},
  storeDelete: async () => {},
  storeKeys: async () => [],
  sealBlob: async (t: string) => `sealed:${t}`,
  openBlob: async (b: string) => (b.startsWith('sealed:') ? b.slice(7) : null),
}));
vi.mock('../src/lib/electronBridge.js', () => ({ bridge: () => undefined }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async () => {
      throw new Error('File does not exist');
    },
    writeFile: async () => ({ uri: '' }),
    rename: async () => {},
    deleteFile: async () => {},
  },
}));

const { vaultCaps } = await import('../src/lib/vaultCaps.js');
const { providerFor } = await import('../src/lib/gitos/index.js');
const { VAULT_CAP_LINE_NAMES, VAULT_COPY_PROVIDERS, vaultCapLine } =
  await import('../src/lib/vaultCopy.js');

const noop = async () => {
  throw new Error('not called');
};

function fake(members: Partial<StorageProvider>): StorageProvider {
  return {
    id: 'local',
    label: 'Fake',
    blurb: '',
    ready: true,
    list: noop,
    stat: noop,
    read: noop,
    write: noop,
    remove: noop,
    acquireLease: noop,
    releaseLease: noop,
    ...members,
  } as StorageProvider;
}

const ALL_M6: Partial<StorageProvider> = {
  rename: noop,
  listFolders: noop,
  createFolder: noop,
  renameFolder: noop,
  trash: noop,
  listTrash: noop,
  restore: noop,
  emptyTrash: noop,
  listAttachments: noop,
  readBytes: noop,
};

const WRITABLE = { readOnly: false } as const;

describe('vaultCaps', () => {
  it('a compare-and-swap provider with every member offers everything', () => {
    expect(vaultCaps(fake({ compareAndSwap: true, ...ALL_M6 }), WRITABLE)).toEqual({
      rename: true,
      renameNative: true,
      folders: true,
      trash: true,
      emptyTrash: true,
      attachments: true,
      taskWriteBack: true,
      linkRewrite: true,
      today: true,
    });
  });

  it('without compareAndSwap no write-shaped cap lights, whatever members it has', () => {
    const caps = vaultCaps(fake({ ...ALL_M6 }), WRITABLE);
    expect(caps).toEqual({
      rename: false,
      renameNative: false,
      folders: false,
      trash: false,
      emptyTrash: false,
      // Reading is not a write.
      attachments: true,
      taskWriteBack: false,
      linkRewrite: false,
      today: false,
    });
  });

  it('rename falls back on compare-and-swap alone; renameNative needs the member', () => {
    const caps = vaultCaps(fake({ compareAndSwap: true }), WRITABLE);
    expect(caps.rename).toBe(true);
    expect(caps.renameNative).toBe(false);
  });

  it('one-tap Trash needs trash, list and restore together (R2)', () => {
    for (const missing of ['trash', 'listTrash', 'restore'] as const) {
      const members = { ...ALL_M6 };
      delete members[missing];
      expect(vaultCaps(fake({ compareAndSwap: true, ...members }), WRITABLE).trash, missing).toBe(
        false,
      );
    }
    // Restore only, no Empty: a team vault's Trash (R3).
    const members = { ...ALL_M6 };
    delete members.emptyTrash;
    const caps = vaultCaps(fake({ compareAndSwap: true, ...members }), WRITABLE);
    expect(caps.trash).toBe(true);
    expect(caps.emptyTrash).toBe(false);
  });

  it('attachments need both the bytes and the list', () => {
    expect(vaultCaps(fake({ compareAndSwap: true, readBytes: noop }), WRITABLE).attachments).toBe(
      false,
    );
  });

  it('read-only and away turn the writes off, and leave reading and Today', () => {
    const p = fake({ compareAndSwap: true, ...ALL_M6 });
    for (const s of [{ readOnly: true }, { readOnly: false, reach: 'away' as const }]) {
      expect(vaultCaps(p, s)).toEqual({
        rename: false,
        renameNative: false,
        folders: false,
        trash: false,
        emptyTrash: false,
        attachments: true,
        taskWriteBack: false,
        linkRewrite: false,
        today: true,
      });
    }
    expect(vaultCaps(p, { readOnly: false, reach: 'unknown' }).rename).toBe(true);
    expect(vaultCaps(p, { readOnly: false, reach: 'reachable' }).trash).toBe(true);
  });
});

// The providers on main, writable. A held branch that adds members updates
// its row here and nothing else.
const MAIN: Record<string, Record<string, boolean>> = {
  local: {
    rename: true,
    renameNative: true,
    folders: true,
    trash: true,
    emptyTrash: true,
    attachments: false,
    taskWriteBack: true,
    linkRewrite: true,
    today: true,
  },
  files: {
    rename: true,
    renameNative: true,
    folders: true,
    trash: true,
    emptyTrash: true,
    attachments: true,
    taskWriteBack: true,
    linkRewrite: true,
    today: true,
  },
  hub: {
    rename: true,
    renameNative: true,
    folders: true,
    trash: true,
    emptyTrash: true,
    attachments: true,
    taskWriteBack: true,
    linkRewrite: true,
    today: true,
  },
  icloud: {
    rename: false,
    renameNative: false,
    folders: false,
    trash: false,
    emptyTrash: false,
    attachments: false,
    taskWriteBack: false,
    linkRewrite: false,
    today: false,
  },
  gdrive: {
    rename: false,
    renameNative: false,
    folders: false,
    trash: false,
    emptyTrash: false,
    attachments: false,
    taskWriteBack: false,
    linkRewrite: false,
    today: false,
  },
  org: {
    rename: false,
    renameNative: false,
    folders: false,
    trash: false,
    emptyTrash: false,
    attachments: false,
    taskWriteBack: false,
    linkRewrite: false,
    today: false,
  },
};

describe('the providers on main', () => {
  for (const id of VAULT_COPY_PROVIDERS) {
    it(`${id} offers what its members allow`, () => {
      const p = providerFor(id)!;
      expect(p, id).toBeTruthy();
      expect(vaultCaps(p, WRITABLE)).toEqual(MAIN[id]);
    });
  }
});

describe('vaultCapLine', () => {
  const lines = VAULT_COPY_PROVIDERS.flatMap((provider) =>
    VAULT_CAP_LINE_NAMES.map((cap) => ({ provider, cap, line: vaultCapLine(provider, cap) })),
  );

  it('has a line for every provider and cap pair', () => {
    expect(lines).toHaveLength(VAULT_COPY_PROVIDERS.length * VAULT_CAP_LINE_NAMES.length);
    for (const { provider, cap, line } of lines) {
      expect(line.length, `${provider} ${cap}`).toBeGreaterThan(10);
      expect(line, `${provider} ${cap}`).toMatch(/\.$/);
    }
  });

  it('every line passes the house copy rules', () => {
    // The dash rule is the em-dash guard's, which scans this source whole.
    const banned = [
      /(^|\s)Retry\b/,
      /\bRead only\b/,
      /\bSetup\b/,
      /\balways on\b/i,
      /\bsynced\b|\bsafe\b/i, // K18: never for a move
      /\bfaster\b|\bsmarter\b|\bremembers\b/i, // 8.4
      /\bagents?\b/i, // X4: no agent claim in a capability line
      /\boops\b|\bsuccessfully\b/i, // CX R3
      /\b(?:leaves?|lands?|saved|stays?|kept)\b[^.;\n]*\b(?:in|to|into) (?:your|the) vault\b/i,
    ];
    for (const { provider, cap, line } of lines) {
      for (const re of banned) expect(line, `${provider} ${cap}`).not.toMatch(re);
    }
  });

  it('every cap a provider on main lacks has a line of its own', () => {
    const fallback = (cap: (typeof VAULT_CAP_LINE_NAMES)[number]) => vaultCapLine('files', cap);
    for (const id of VAULT_COPY_PROVIDERS) {
      const caps = MAIN[id]!;
      for (const cap of VAULT_CAP_LINE_NAMES) {
        if (caps[cap]) continue;
        // Empty Trash is said only where there is a Trash to empty.
        if (cap === 'emptyTrash' && !caps.trash) continue;
        expect(vaultCapLine(id, cap), `${id} ${cap}`).not.toBe(fallback(cap));
      }
    }
  });

  it('says "for good" only where a delete is permanent, and Trash only where it is real', () => {
    for (const id of VAULT_COPY_PROVIDERS) {
      const line = vaultCapLine(id, 'trash');
      if (MAIN[id]!.trash) continue;
      if (id !== 'gdrive') expect(line, id).toMatch(/for good and asks twice/);
    }
    expect(vaultCapLine('org', 'emptyTrash')).toBe(
      "Team notes are kept in your organization's history.",
    );
  });
});
