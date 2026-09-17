# macOS desktop build (Codemagic, unsigned)

The `mac-desktop` workflow in `codemagic.yaml` produces a `.dmg` and a `.zip`,
each for Apple Silicon (arm64) and Intel (x64), distributed straight from
openshore.ai the same way the Uki Music desktop app ships, never through the
Mac App Store.

This build is unsigned in Apple's eyes: no Developer ID certificate, no
notarization. That is a deliberate choice (founder, matching the Uki Music
build) to skip the Apple Developer certificate and notarization setup
entirely. Read "What this costs" below before shipping a download link, so the
tradeoff is a decision, not a surprise.

## Setup: none beyond what already exists

The workflow imports `Harbor-os-code`, the same Codemagic variable group the
iOS build already uses, for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
(so sign-in works here exactly like it does on iOS). That group already
exists. There is nothing new to create in Codemagic, no Apple certificate, no
API key. Start the `mac-desktop` workflow from the Codemagic UI whenever you
want a build.

## What this costs: the Gatekeeper prompt

The first time someone opens the app, macOS Gatekeeper shows "Apple could not
verify that OpenShore is free of malware," with no plain "Open" button on that
first dialog. They get past it one of two ways:

- **Right-click (or Control-click) the app and choose Open.** That shows a
  second dialog with an actual Open button. This is the one extra step,
  compared to a notarized app's plain double-click, and it is only needed
  once, the very first launch.
- **Or, if that still refuses:** System Settings -> Privacy & Security,
  scroll to the Security section, and click "Open Anyway" next to the
  OpenShore mention that appears after the first blocked attempt.

Put a line like this on the download page or in the release notes, next to the
macOS download, so it never reads as broken:

> First launch: right-click the app and choose Open (this is normal for an
> app distributed outside the App Store; every launch after the first is
> ordinary).

electron-builder signs the app **ad-hoc** on its own during packaging (no
certificate needed for this part): that is a separate, unrelated requirement
Apple Silicon enforces just to execute any binary at all, and it has nothing
to do with the Gatekeeper prompt above.

## Running it

1. In Codemagic, pick the `mac-desktop` workflow and start a build on `main`.
2. It installs, runs the full test gate, builds the app, rebuilds the native
   terminal module for Electron, then packages with electron-builder.
3. When it finishes, the build's Artifacts list has the `.dmg` and `.zip` for
   both architectures.

## Getting it to users

The built files are the download. Host them the same way the Linux build is
hosted (a GitHub Release, or object storage) and point the "Get OpenShore"
button on the marketing site at them, with the Gatekeeper line above nearby.
The files are too large for the marketing site's own static hosting
(Cloudflare Pages caps a served file at 25 MiB).

## If you want to remove the Gatekeeper prompt later

That is exactly what a Developer ID certificate and notarization buy: a plain
double-click with no warning at all. It needs an Apple Developer account (you
already have one, from the iOS build), a Developer ID Application certificate,
and an App Store Connect API key for notarization, none of which this workflow
uses today. If that becomes worth the setup later, the pieces are: sign with
`CSC_LINK`/`CSC_KEY_PASSWORD`, add `hardenedRuntime: true` and an entitlements
plist back to the `mac` block in `app/package.json` (needed only once
notarization is in the picture), and pass `-c.mac.notarize.teamId=...` to
`electron-builder` with the App Store Connect key decoded to a file. Ask before
building that back in, since it reintroduces the certificate and API key setup
this doc exists to skip.
