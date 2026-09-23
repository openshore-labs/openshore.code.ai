// Pure helper for the desktop update check (main.ts), pinned by a test the
// same way lifecycle.ts's helpers are: a plain string compare would treat
// "0.1.10" as older than "0.1.9" ("1" < "9"), which is exactly backwards.

/** True when `latest` is a newer dotted version than `current`. Missing
 *  segments compare as 0, so "1.2" and "1.2.0" are equal. */
export function versionIsNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

// ---- macOS in-place update: which release, which file ----------------------
// macOS ships unsigned (codemagic.yaml), so electron-updater's Squirrel path is
// out, and the desktop app updates itself instead (electron/macUpdate.ts): it
// downloads the release's .zip for this Mac's architecture, swaps the bundle,
// and relaunches. The Mac build runs on Codemagic after the Linux and Windows
// release, so the newest release can briefly have no Mac zip yet; the check
// takes the newest release that actually carries one, never an empty promise.

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

export interface ReleaseInfo {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: ReleaseAsset[];
}

/** The release's zip for this Mac. electron-builder names them
 *  `OpenShore-<v>-arm64-mac.zip` and `OpenShore-<v>-mac.zip` (x64). */
export function pickMacZip(assets: ReleaseAsset[], arch: string): ReleaseAsset | undefined {
  const zips = assets.filter((a) => /-mac\.zip$/i.test(a.name));
  return arch === 'arm64'
    ? zips.find((a) => /-arm64-mac\.zip$/i.test(a.name))
    : zips.find((a) => !/-arm64-mac\.zip$/i.test(a.name));
}

/** The newest published release, newer than `current`, that carries a zip
 *  for this Mac; undefined when there is nothing to update to. */
export function newestMacUpdate(
  releases: ReleaseInfo[],
  current: string,
  arch: string,
): { version: string; tag: string; asset: ReleaseAsset } | undefined {
  let best: { version: string; tag: string; asset: ReleaseAsset } | undefined;
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    const version = r.tag_name.replace(/^v/, '');
    if (!versionIsNewer(version, current)) continue;
    if (best && !versionIsNewer(version, best.version)) continue;
    const asset = pickMacZip(r.assets ?? [], arch);
    if (asset) best = { version, tag: r.tag_name, asset };
  }
  return best;
}

/** The .app bundle a running executable lives in
 *  (`/Applications/OpenShore.app/Contents/MacOS/OpenShore` gives
 *  `/Applications/OpenShore.app`), or undefined when it is not in one. */
export function bundleOf(exePath: string): string | undefined {
  const m = /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/.exec(exePath);
  return m?.[1];
}
