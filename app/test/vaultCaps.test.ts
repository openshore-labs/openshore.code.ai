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
      settingsWrite: false,
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
      settingsWrite: false,
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
        settingsWrite: false,
      });
    }
    expect(vaultCaps(p, { readOnly: false, reach: 'unknown' }).rename).toBe(true);
    expect(vaultCaps(p, { readOnly: false, reach: 'reachable' }).trash).toBe(true);
  });
});

describe('vaultCaps, Vault M7 (CTO L7, L11)', () => {
  const full = fake({ compareAndSwap: true, ...ALL_M6, writeConfig: noop });

  it('settingsWrite needs writeConfig and compare-and-swap together', () => {
    expect(vaultCaps(full, WRITABLE).settingsWrite).toBe(true);
    expect(vaultCaps(fake({ compareAndSwap: true, ...ALL_M6 }), WRITABLE).settingsWrite).toBe(
      false,
    );
    expect(vaultCaps(fake({ ...ALL_M6, writeConfig: noop }), WRITABLE).settingsWrite).toBe(false);
  });

  it('read-only and away keep the settings sheet from saving', () => {
    expect(vaultCaps(full, { readOnly: true }).settingsWrite).toBe(false);
    expect(vaultCaps(full, { readOnly: false, reach: 'away' }).settingsWrite).toBe(false);
    expect(vaultCaps(full, { readOnly: false, reach: 'unknown' }).settingsWrite).toBe(true);
    expect(vaultCaps(full, { readOnly: false, reach: 'reachable' }).settingsWrite).toBe(true);
  });

  it("the vault's delete: permanent turns one-tap Trash off, and nothing else", () => {
    const base = vaultCaps(full, WRITABLE);
    const permanent = vaultCaps(full, WRITABLE, { delete: 'permanent' });
    expect(permanent).toEqual({ ...base, trash: false, emptyTrash: false });
    expect(vaultCaps(full, WRITABLE, { delete: 'trash' })).toEqual(base);
    expect(vaultCaps(full, WRITABLE, {})).toEqual(base);
  });

  // The team review of 2026-09-30: For good only where a delete really is.
  it('a storage that does not carry Delete out keeps one-tap Trash under For good', () => {
    const keeps = fake({ ...full, unappliedSettings: ['delete'] });
    const base = vaultCaps(keeps, WRITABLE);
    expect(base.trash).toBe(true);
    expect(vaultCaps(keeps, WRITABLE, { delete: 'permanent' })).toEqual(base);
    // Another unapplied field leaves the Delete choice where it was.
    const other = fake({ ...full, unappliedSettings: ['attachments.folder'] });
    expect(vaultCaps(other, WRITABLE, { delete: 'permanent' }).trash).toBe(false);
  });

  it('the team vault: a stored delete: permanent is still one tap to Trash', () => {
    const team = providerFor('org')!;
    expect(team.unappliedSettings).toContain('delete');
    for (const state of [
      WRITABLE,
      { readOnly: false, settingsAdmin: true },
      { readOnly: false, settingsAdmin: false },
    ]) {
      const caps = vaultCaps(team, state, { delete: 'permanent' });
      expect(caps).toEqual(vaultCaps(team, state));
      expect(caps.trash).toBe(true);
    }
  });

  it('every provider on main with writeConfig declares compare-and-swap', () => {
    for (const id of VAULT_COPY_PROVIDERS) {
      const p = providerFor(id)!;
      if (typeof p.writeConfig === 'function') expect(p.compareAndSwap, id).toBe(true);
    }
  });

  it('the team vault saves its settings for an admin only (CX Y14)', () => {
    const team = providerFor('org')!;
    expect(typeof team.writeConfig).toBe('function');
    expect(vaultCaps(team, { readOnly: false, settingsAdmin: true }).settingsWrite).toBe(true);
    expect(vaultCaps(team, { readOnly: false, settingsAdmin: false }).settingsWrite).toBe(false);
    // A member keeps every note action; only the sheet reads.
    const member = vaultCaps(team, { readOnly: false, settingsAdmin: false });
    expect(member).toEqual({ ...vaultCaps(team, WRITABLE), settingsWrite: false });
    // A lapsed plan is read-only: nothing writes, the sheet included (Y15).
    const lapsed = vaultCaps(team, { readOnly: true, settingsAdmin: true });
    expect(lapsed.settingsWrite || lapsed.rename || lapsed.trash).toBe(false);
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
    // writeConfig under compare-and-swap (Vault M7, CTO L7).
    settingsWrite: true,
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
    // writeConfig under compare-and-swap (Vault M7, CTO L7).
    settingsWrite: true,
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
    // writeConfig under compare-and-swap (Vault M7, CTO L7).
    settingsWrite: true,
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
    settingsWrite: false,
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
    settingsWrite: false,
  },
  // The held team branch (0024, 0025): a native move, a real Trash with
  // Restore and no Empty (R3), the settings row; no attachments.
  org: {
    rename: true,
    renameNative: true,
    folders: true,
    trash: true,
    emptyTrash: false,
    attachments: false,
    taskWriteBack: true,
    linkRewrite: true,
    today: true,
    settingsWrite: true,
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
