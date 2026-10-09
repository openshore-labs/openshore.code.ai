// Where this machine keeps its keys, in plain words, for osc doctor, osc login
// and osc key (keys on your server, 2026-10-09). Where the OS holds no key
// for the credentials file (Linux with no keychain, which a rented server
// usually is), the file's lock is made from this machine's own name and id,
// which any process on it can read. That holder is said plainly and never
// called encrypted: anyone who can read the file, or a copy of the disk, can
// read the keys in it.
import { join } from 'node:path';
import { oscHome } from '../config/load.js';
import { fileKeyHolder, storeBackend, type StoreBackend } from './store.js';

export interface KeyHome {
  /** A noun phrase: "the OS keychain", "a file only this account and root
   *  can read". */
  where: string;
  /** One more sentence when the holder is weaker than its name suggests. */
  caveat?: string;
}

/** The plain sentence for a file whose key comes from the machine. */
export function machineDerivedCaveat(): string {
  return `Its lock comes from this machine's own name and id, so anyone who can read ${join(oscHome(), 'credentials')}, or a copy of this disk, can read the keys in it.`;
}

export function keyHome(backend: StoreBackend = storeBackend()): KeyHome {
  if (backend === 'keychain') return { where: 'the OS keychain' };
  const holder = fileKeyHolder();
  if (holder === 'macos-keychain') {
    return { where: 'the encrypted local store, its key in the macOS Keychain' };
  }
  if (holder === 'windows-dpapi') {
    return { where: 'the encrypted local store, its key held by Windows for your account' };
  }
  if (holder === 'unreadable') {
    return { where: 'the encrypted local store (its key is locked right now)' };
  }
  return {
    where: 'a file only this account and root can read',
    caveat: machineDerivedCaveat(),
  };
}
