// The public halves of OpenShore's two release signing keys, pinned in the
// app (CTO rulings 1 and 2, 2026-09-29). Each is the base64 of the key's 32
// raw bytes, exactly as `node app/scripts/release-keygen.mjs` prints it. Two
// keys, not one, so a leak on one build service cannot sign the other
// platform's updates: the Mac key's private half lives only in Codemagic, the
// desktop key's only in GitHub's `release` environment.
//
// Both start empty, until the founder runs the keygen (docs/release-signing.md).
// Empty is a deliberate state, not a bug:
//   - Mac: no in-place update. The Update click opens the release page, so the
//     person downloads the new version themselves and macOS checks it.
//   - Windows and Linux: electron-updater installs as before, with no
//     signature check, and main.ts says so in its log.
// Once a key is pasted here and a build carrying it ships, every later release
// for that platform must be signed with the matching private key, or installed
// apps refuse it (Mac: opens the release page; Windows and Linux: the bar says
// the update did not finish).

/** Checks the macOS zip or dmg before it is unpacked and swapped in. */
export const MAC_RELEASE_PUBLIC_KEY = '';

/** Checks the Windows installer and the Linux AppImage or deb before
 *  electron-updater installs it. */
export const DESKTOP_RELEASE_PUBLIC_KEY = '';
