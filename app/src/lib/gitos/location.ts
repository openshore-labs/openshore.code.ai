// The gitOS location layer: the ONE vocabulary for "where does this thing's
// bytes physically live," shared by Repositories and (in time) Vault. This is
// the merge the CTO ruled for: gitOS unifies at the LOCATION descriptor, not at
// the byte-transport interface. Vault resolves bytes through a StorageProvider
// (text, any backend); a repo resolves a REAL filesystem path and hands it to
// the git stack. So a StorageLocation only ever names a filesystem-real place:
// this device's managed folder, or a folder the user picked (a local disk, a
// NAS, a Tailscale-mounted share). Cloud drives are deliberately not locations
// here; they are a backup target, because a live .git needs a real filesystem.

export type StorageLocation =
  // The box's managed home (~/OSCode on the desktop or daemon host). The engine
  // resolves the exact path; the app never needs it.
  | { kind: 'device' }
  // An absolute folder the user chose. The engine validates and confines it.
  | { kind: 'folder'; path: string };

/** A short, human line for a location, for pickers and repo cards. */
export function describeLocation(loc: StorageLocation): string {
  return loc.kind === 'device' ? 'This device' : loc.path;
}

/** The parent folder to hand the engine, or undefined for the device default
 *  (the engine then uses ~/OSCode). Repos never carry a cloud provider id, so
 *  there is nothing else to resolve. */
export function locationParent(loc: StorageLocation): string | undefined {
  return loc.kind === 'folder' ? loc.path : undefined;
}
