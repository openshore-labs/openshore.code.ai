# Getting OS Code onto your iPhone with Codemagic + TestFlight

One-time setup, then every push to `main` builds and ships to TestFlight
automatically. Work through the steps in order; each one is small.

## What you need

- Your Apple Developer Program account (paid, active).
- A Codemagic account (codemagic.io, free tier is enough to start).
- This repo (`openshore-labs/openshore.code.ai`) on GitHub.

## 1. Create the app record in App Store Connect

1. Sign in at appstoreconnect.apple.com.
2. First the bundle ID: developer.apple.com -> Account -> Certificates,
   Identifiers & Profiles -> Identifiers -> add (+) -> App IDs -> App.
   - Description: `OS Code`
   - Bundle ID: **explicit**, `ai.openshore.oscode`
   - Capabilities: leave the defaults.
3. Back in App Store Connect: Apps -> add (+) -> New App.
   - Platform: iOS
   - Name: `OS Code` (if taken, `OS Code by OpenShore`)
   - Language: English (U.S.)
   - Bundle ID: pick `ai.openshore.oscode`
   - SKU: `oscode-ios`
4. Once the app record exists: App Information (left sidebar) -> Subtitle
   -> `Localized stack. No limits.` (27/30 chars). Save.
   - Brand call (CMO + Brand Exec, founder sign-off 2026-08-18): leads
     with "Localized" (runs on your machine, tailored to you) and
     "limits" (the cloud pain point) over spelling out "cost" or
     "curate", which cost too many characters for what they added.

## 2. Create an App Store Connect API key

Codemagic uses this key to sign the app and upload builds.

1. App Store Connect -> Users and Access -> Integrations tab -> App Store
   Connect API -> Team Keys -> Generate API Key.
2. Name: `codemagic`. Access: **Admin** (not App Manager — Codemagic's
   automatic code signing creates certificates and provisioning profiles
   via the Developer Portal API, which App Manager can't reach; it only
   covers app metadata and TestFlight).
3. Download the `.p8` file (one chance only; keep it safe).
4. Note the **Key ID** and the **Issuer ID** shown on that page.

## 3. Connect Codemagic

1. Sign in at codemagic.io with GitHub and grant it access to
   `openshore-labs/openshore.code.ai`.
2. Add the repo as an application. Codemagic finds `codemagic.yaml` at the
   repo root by itself.
3. Teams -> your team -> Integrations -> Developer Portal -> Manage keys ->
   add the API key: upload the `.p8`, paste the Key ID and Issuer ID, and
   name the integration exactly **`os_code_app_store`** (the yaml refers
   to it by that name).

## 4. First build

1. In Codemagic, open the app -> Start new build -> pick the
   `ios-testflight` workflow and the `main` branch.
2. The first run is the slow one (20 to 40 minutes): it resolves Swift
   packages, downloads the llama.cpp Metal framework, and mints signing
   certificates. Later runs reuse all of it.
3. When it finishes, the build appears in App Store Connect -> TestFlight
   within a few minutes.

Every later push to `main` triggers this automatically.

## 5. Onto your iPhone (internal testing, no review)

The pipeline uploads each build to App Store Connect but does NOT submit
it for external beta review (`submit_to_testflight: false`), so it never
blocks on the Beta App Information form. Internal testers automatically
receive every uploaded build.

1. App Store Connect -> your app -> TestFlight -> Internal Testing ->
   create a group (`founders`), add your own Apple ID as a tester.
2. Install **TestFlight** from the App Store on your iPhone.
3. Once a build finishes processing it appears in TestFlight; tap Install.
   (Internal testers get new builds automatically, no per-build step.)

Internal testing needs no App Review, updates land in minutes, and each
build stays live for 90 days.

## 6. External testers (optional, later)

External testing (up to 10,000 people) needs a one-time Apple review and
some contact info first:

1. App Store Connect -> your app -> TestFlight -> Test Information: fill in
   the **Feedback Email** (Beta App Information) and the **First/Last name,
   Phone, Email** (Beta App Review Information). Save.
2. In `codemagic.yaml`, set `submit_to_testflight: true` (optionally add
   `beta_groups: [<external group name>]`). Ask Claude to make this change.
3. Push; the next build auto-submits for beta review.

## Troubleshooting

- **Signing errors on the first build**: the `os_code_app_store`
  integration name in Codemagic must match the yaml exactly, and the API
  key needs the **Admin** role (App Manager can't create certificates or
  provisioning profiles, only manage app metadata and TestFlight).
- **Signing.** We use MANUAL signing (needs the API key at **Admin**).
  The "Set up code signing" step creates the distribution certificate from
  a generated private key, then the App Store profile, then assigns it.
  The private key is the crux: `fetch-signing-files --create` can only
  mint a certificate when given one (`--certificate-key`), because a
  distribution cert's private key is never downloadable. Automatic signing
  (an `ios_signing:` block) does NOT work here: it only fetches profiles
  and raises "No matching profiles found" on a fresh account. Never run
  both modes at once.
- **Persist the signing key — done in the script, one manual step left.**
  The "Set up code signing" step now reads the private key from the
  encrypted Codemagic env var `CERTIFICATE_PRIVATE_KEY` when it is set, so
  the same distribution certificate is reused every build. It still falls
  back to generating a fresh one-off key (and prints a warning) if that var
  is not set, so an unconfigured pipeline still builds, it just keeps
  minting certificates. **To finish this once:** add `CERTIFICATE_PRIVATE_KEY`
  as an encrypted variable under Codemagic → your app → Environment
  variables (mark it Secure), pasting in a PEM RSA private key. If Apple
  already rejects new certificates because you are at the cap from earlier
  ad-hoc runs, revoke an old, unused "iOS Distribution" certificate at
  [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list)
  first, then add the var and rebuild.
- **"No matching profiles found ... distribution type app_store"**: an
  `ios_signing:` block is present (automatic signing) but the profile/cert
  do not exist and it will not create them. Use the manual signing step
  instead; remove the `ios_signing:` block.
- **Macro/plugin archive failure at `ComputeTargetDependencyGraph`**:
  LLM.swift is macro-based and pulls a build plugin; a headless archive
  cannot trust them interactively. Handled by
  `--archive-xcargs "... -skipMacroValidation -skipPackagePluginValidation"`
  on `build-ipa`. Keep those flags.
- **Swift package resolution fails**: retry the build first; it is nearly
  always a transient fetch. LLM.swift is pinned to v3.0.3 in
  `app/plugins/oscode-llama/Package.swift`.
- **Build number conflicts**: the workflow stamps Codemagic's own
  `BUILD_NUMBER`; if you ever upload from Xcode by hand, bump past it.
