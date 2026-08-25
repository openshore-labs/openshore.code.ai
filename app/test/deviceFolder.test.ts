import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Electron bridge and platform so the provider's client logic can be
// tested without a main process. `ret.current` lets a test simulate "no bridge".
const h = vi.hoisted(() => {
  const b = {
    vaultList: vi.fn(),
    vaultRead: vi.fn(),
    vaultWrite: vi.fn(),
    vaultRemove: vi.fn(),
  };
  return { b, ret: { current: b as unknown }, platform: vi.fn(() => 'electron') };
});
vi.mock('../src/lib/electronBridge.js', () => ({ bridge: () => h.ret.current }));
vi.mock('../src/lib/platform.js', () => ({ platform: h.platform }));

import { deviceFolderProvider, isDeviceFolderAvailable } from '../src/lib/gitos/deviceFolder.js';

beforeEach(() => {
  h.b.vaultList.mockReset();
  h.b.vaultRead.mockReset();
  h.b.vaultWrite.mockReset();
  h.b.vaultRemove.mockReset();
  h.ret.current = h.b;
  h.platform.mockReturnValue('electron');
});

describe('device folder provider availability', () => {
  it('is available only on Electron with the file bridge present', () => {
    expect(isDeviceFolderAvailable()).toBe(true);
    h.platform.mockReturnValue('web');
    expect(isDeviceFolderAvailable()).toBe(false);
    h.platform.mockReturnValue('electron');
    h.ret.current = undefined;
    expect(isDeviceFolderAvailable()).toBe(false);
  });
});

describe('device folder provider', () => {
  it('lists through the bridge', async () => {
    const files = [{ path: 'a.md', updatedAt: 't', size: 3 }];
    h.b.vaultList.mockResolvedValue(files);
    expect(await deviceFolderProvider.list('vault.personal')).toBe(files);
  });

  it('reads, mapping a missing note (null) to undefined', async () => {
    h.b.vaultRead.mockResolvedValue({ path: 'a.md', text: 'hi', updatedAt: 't' });
    expect(await deviceFolderProvider.read('vault.personal', 'a.md')).toEqual({
      path: 'a.md',
      text: 'hi',
      updatedAt: 't',
    });
    h.b.vaultRead.mockResolvedValue(null);
    expect(await deviceFolderProvider.read('vault.personal', 'x.md')).toBeUndefined();
  });

  it('writes through the bridge, ignoring the resource id (one on-disk vault)', async () => {
    h.b.vaultWrite.mockResolvedValue({ path: 'a.md', text: 'body', updatedAt: 't' });
    const saved = await deviceFolderProvider.write('anything', 'a.md', 'body');
    expect(h.b.vaultWrite).toHaveBeenCalledWith('a.md', 'body');
    expect(saved).toEqual({ path: 'a.md', text: 'body', updatedAt: 't' });
  });

  it('removes through the bridge', async () => {
    h.b.vaultRemove.mockResolvedValue(undefined);
    await deviceFolderProvider.remove('vault.personal', 'a.md');
    expect(h.b.vaultRemove).toHaveBeenCalledWith('a.md');
  });

  it('throws a clear error when the desktop bridge is absent', async () => {
    h.ret.current = undefined;
    await expect(deviceFolderProvider.list('vault.personal')).rejects.toThrow(/desktop app/i);
  });

  it('grants a lease trivially (shared folder, no exclusive lock)', async () => {
    const lease = await deviceFolderProvider.acquireLease('vault.personal', 'me', 1000);
    expect(lease.holder).toBe('me');
    expect(new Date(lease.expiresAt).getTime()).toBeGreaterThan(0);
  });
});
