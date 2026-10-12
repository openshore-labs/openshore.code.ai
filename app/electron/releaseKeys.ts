// The public halves of OpenShore's two release signing keys, pinned in the
// app (CTO rulings 1 and 2, 2026-09-29). Each is the base64 of the key's 32
// raw bytes, exactly as `node app/scripts/release-keygen.mjs` prints it. Two
// keys, not one, so a leak on one build service cannot sign the other
// platform's updates: the Mac key's private half lives only in Codemagic, the
// desktop key's only in GitHub's `release` environment.
//
// Both pinned 2026-09-30, from the founder's keygen run (the maintainer release-signing runbook);
// the private halves went into Codemagic's openshore-mac-signing group and
// GitHub's `release` environment first. An empty key is a deliberate state
// the code still handles (Mac: the Update click opens the release page;
// Windows and Linux: electron-updater installs without a signature check, and
// main.ts logs it), for a platform whose key has to be rotated.
// Once a build carrying a key ships, every later release for that platform
// must be signed with the matching private key, or installed apps refuse it
// (Mac: opens the release page; Windows and Linux: the bar says the update did
// not finish). A leaked key is replaced per the maintainer release-signing runbook.

/** Checks the macOS zip or dmg before it is unpacked and swapped in. */
export const MAC_RELEASE_PUBLIC_KEY = 'Ttc2v0Sp0xpEcOYljT7Wby+lO/GNoNyLMeCtqoxQMZw=';

/** Checks the Windows installer and the Linux AppImage or deb before
 *  electron-updater installs it. */
export const DESKTOP_RELEASE_PUBLIC_KEY = 'eZhSikfaYlS9xRQnFK6331uUw2/n/y92SclmhRJUnlI=';
