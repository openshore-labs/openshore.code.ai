// The iCloud Drive native plugin contract, plus a web mock so the app runs
// where the native side is absent (browser dev, and any non-iOS platform).
// Off-device iCloud is simply unavailable, never faked: available() returns
// false and the provider stays unselectable, exactly as the seam requires.
import { registerPlugin } from '@capacitor/core';

export interface IcloudPluginContract {
  /** Is the ubiquity container reachable right now (signed in, provisioned)? */
  available(): Promise<{ available: boolean }>;
  list(options: { resourceId: string }): Promise<{
    // `evicted` marks a note iCloud holds but has not downloaded here (a
    // placeholder). It exists, so a same-name create must open it, never
    // overwrite the cloud copy (UI-2); read() materializes it on demand.
    files: Array<{ path: string; updatedAt: string; size: number; evicted?: boolean }>;
  }>;
  read(options: {
    resourceId: string;
    path: string;
    // `downloading` is true when the note exists in iCloud but its bytes are
    // not on this device yet (a placeholder), distinct from truly missing.
  }): Promise<{ found: boolean; text?: string; updatedAt?: string; downloading?: boolean }>;
  write(options: {
    resourceId: string;
    path: string;
    text: string;
  }): Promise<{ updatedAt: string }>;
  remove(options: { resourceId: string; path: string }): Promise<void>;
}

const webMock: IcloudPluginContract = {
  async available() {
    return { available: false };
  },
  async list() {
    return { files: [] };
  },
  async read() {
    return { found: false };
  },
  async write() {
    throw new Error('iCloud is only available on this iPhone.');
  },
  async remove() {
    // Nothing to remove off-device; a no-op keeps callers simple.
  },
};

export const Icloud = registerPlugin<IcloudPluginContract>('OscodeIcloud', {
  web: () => webMock,
});
