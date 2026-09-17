# macOS desktop: unsigned, outside the App Store

OpenShore's Mac build ships the way the Uki Music desktop app does:
distributed straight from openshore.ai, never through the Mac App Store, with
no Apple Developer ID certificate and no notarization (founder decision; see
the `mac-desktop` job's header comment in `codemagic.yaml`). The build runs
on demand from the Codemagic UI, never automatically on push.

## What a visitor sees, and the copy to pair with the download link

electron-builder signs the app ad-hoc (the identity Apple Silicon requires
just to launch a binary at all), but the app is genuinely unsigned in
Apple's eyes. The first time someone opens it, Gatekeeper refuses a plain
double-click:

> "OpenShore" cannot be opened because the developer cannot be verified.

They right-click (or Control-click) the app in Finder, choose **Open**, and
confirm once in the dialog that appears. Every launch after that is a normal
double-click. Exact copy for the download page:

> **Download for Mac.** First launch only: right-click the app and choose
> Open (Apple's check for an app outside the Mac App Store), then confirm.
> Every launch after that opens normally.

## Publishing the build to the GitHub Release

The `mac-desktop` job's last step uploads the dmg/zip to whichever GitHub
Release is currently latest, the same release Linux and Windows publish to
via `release.yml`, so one link
(`https://github.com/openshore-labs/openshore.code.ai/releases/latest`)
carries every platform, and the desktop app's own macOS update check (which
opens exactly that URL when a newer version exists; see
`app/electron/main.ts`'s `checkMacUpdate`) has something real to point to.

Run the Linux/Windows release first (push a `v*` tag) so the release this
step uploads into already exists, then trigger `mac-desktop` from Codemagic.
This ordering matters for more than the upload: this job has no git tag to
read a version from the way release.yml's Linux/Windows jobs do (it runs on
demand, not on a tag push), so its first step looks up whichever release is
currently latest and stamps `app/package.json` to match before packaging.
Skip the ordering and the build stamps itself from an older release than the
one it is about to ship, and `app.getVersion()` inside the packaged app will
be wrong, which is exactly what the macOS update check compares against.

This needs one secret Codemagic does not have by default, since Codemagic's
own GitHub integration is read-only clone access, not a general API token:

1. github.com -> Settings -> Developer settings -> Personal access tokens ->
   Fine-grained tokens -> Generate new token.
2. Resource owner: `openshore-labs`. Repository access: **Only select
   repositories** -> `openshore.code.ai`. Permissions: **Contents: Read and
   write** (nothing else needed).
3. Codemagic -> this app -> Environment variables -> the `Harbor-os-code`
   group -> add `GH_RELEASE_TOKEN`, paste the token, mark **Secure**.

Without it, the build still succeeds and the dmg/zip are still attached as
Codemagic's own build artifacts (downloadable from the Codemagic UI); the
version stamp and the publish step both just warn and skip rather than
failing the build.

**A green build is not proof this worked.** Two real runs on 2026-09-17 both
came back green with nothing to show for it, for two different reasons:

1. **Attempt one:** the dmg/zip were still named `OpenShore-0.1.0...`, not the
   actual release version. `gh` (the GitHub CLI) turned out not to be on that
   Codemagic image at all, so both the version lookup and the upload silently
   skipped, exactly as designed, and exactly why that design is risky to
   trust from the build status alone. Fixed by having both steps install `gh`
   via Homebrew first if it is missing.
2. **Attempt two,** after that fix: still no macOS assets on the release, and
   both steps completed in under a second, too fast to be doing real work.
   The stamp step's own log read: `gh: To use GitHub CLI in automation, set
   the GH_TOKEN environment variable.` `gh` was present and ran, but refuses
   anonymous access in a non-interactive shell even to read a public repo's
   own release list. The stamp step never exported `GH_TOKEN` (the original,
   incorrect assumption was that a public repo needed no token for reads),
   so it silently skipped the stamp, which meant `MAC_RELEASE_TAG` was never
   set, which meant the publish step's own first check made it skip too, all
   before either one touched the network for real. Fixed by having the stamp
   step check for `GH_RELEASE_TOKEN` and export it as `GH_TOKEN` the same way
   the publish step already did.

To actually confirm a run published, do not trust the green checkmark or even
the per-step durations shown in the Codemagic UI at a glance, open the step
log itself. Either check the "Publish to the GitHub Release" step's own log
for `Publishing the macOS build to vX.Y.Z`, or just check the release itself:
`curl -s https://api.github.com/repos/openshore-labs/openshore.code.ai/releases/latest`
and look for a `.dmg` in `assets` with the current version in its filename.
