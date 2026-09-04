// The sealed per-project secrets store: read/write/delete against the device
// secret store, and the template shape. The store is mocked so the test never
// touches a real keychain.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('../src/lib/platform.js', () => ({
  secretGet: async (k: string) => store.get(k) ?? null,
  secretSet: async (k: string, v: string) => {
    store.set(k, v);
  },
  secretDelete: async (k: string) => {
    store.delete(k);
  },
}));

const {
  SECRETS_NOTE_TITLE,
  projectSecretsKey,
  secretsTemplate,
  readProjectSecrets,
  writeProjectSecrets,
  hasProjectSecrets,
} = await import('../src/lib/projectSecrets.js');

beforeEach(() => store.clear());

describe('projectSecrets store', () => {
  it('keys by project id and titles the note', () => {
    expect(projectSecretsKey('p1')).toBe('oscode.projectSecrets.p1');
    expect(SECRETS_NOTE_TITLE).toBe('Tokens and Secrets');
  });

  it('reads empty before anything is stored', async () => {
    expect(await readProjectSecrets('p1')).toBe('');
    expect(await hasProjectSecrets('p1')).toBe(false);
  });

  it('round-trips a write and read', async () => {
    await writeProjectSecrets('p1', '# Tokens and Secrets\n\ngithub: xyz');
    expect(await readProjectSecrets('p1')).toContain('github: xyz');
    expect(await hasProjectSecrets('p1')).toBe(true);
    // Stored under the sealed key, not anywhere else.
    expect(store.has('oscode.projectSecrets.p1')).toBe(true);
  });

  it('deletes the entry when emptied, leaving nothing sealed', async () => {
    await writeProjectSecrets('p1', 'secret');
    await writeProjectSecrets('p1', '   ');
    expect(store.has('oscode.projectSecrets.p1')).toBe(false);
    expect(await hasProjectSecrets('p1')).toBe(false);
  });

  it('keeps two projects separate', async () => {
    await writeProjectSecrets('a', 'A-secret');
    await writeProjectSecrets('b', 'B-secret');
    expect(await readProjectSecrets('a')).toBe('A-secret');
    expect(await readProjectSecrets('b')).toBe('B-secret');
  });

  it('template is a real heading and carries no realistic token shapes', () => {
    const t = secretsTemplate();
    expect(t.startsWith('# Tokens and Secrets')).toBe(true);
    expect(t).not.toMatch(/ghp_|sk-[a-z]/i);
  });
});
