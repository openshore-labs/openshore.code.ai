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

## 2. Create an App Store Connect API key

Codemagic uses this key to sign the app and upload builds.

1. App Store Connect -> Users and Access -> Integrations tab -> App Store
   Connect API -> Team Keys -> Generate API Key.
2. Name: `codemagic`. Access: **App Manager**.
3. Download the `.p8` file (one chance only; keep it safe).
4. Note the **Key ID** and the **Issuer ID** shown on that page.

## 3. Connect Codemagic

1. Sign in at codemagic.io with GitHub and grant it access to
   `openshore-labs/openshore.code.ai`.
2. Add the repo as an application. Codemagic finds `codemagic.yaml` at the
   repo root by itself.
3. Teams -> your team -> Integrations -> Developer Portal -> Manage keys ->
   add the API key: upload the `.p8`, paste the Key ID and Issuer ID, and
   name the integration exactly **`appstore`** (the yaml refers to it by
   that name).

## 4. First build

1. In Codemagic, open the app -> Start new build -> pick the
   `ios-testflight` workflow and the `main` branch.
2. The first run is the slow one (20 to 40 minutes): it resolves Swift
   packages, downloads the llama.cpp Metal framework, and mints signing
   certificates. Later runs reuse all of it.
3. When it finishes, the build appears in App Store Connect -> TestFlight
   within a few minutes.

Every later push to `main` triggers this automatically.

## 5. Onto your iPhone

1. App Store Connect -> your app -> TestFlight -> Internal Testing ->
   create a group (`founders`), add your own Apple ID as a tester.
2. Install **TestFlight** from the App Store on your iPhone.
3. Accept the email invite; OS Code appears in TestFlight; tap Install.

Internal testing needs no App Review, updates land in minutes, and the
build stays live for 90 days.

## Troubleshooting

- **Signing errors on the first build**: the `appstore` integration name
  in Codemagic must match the yaml exactly, and the API key needs the App
  Manager role.
- **"No matching profiles"**: the bundle ID in App Store Connect must be
  exactly `ai.openshore.oscode` (explicit, not wildcard).
- **Swift package resolution fails**: retry the build first; it is nearly
  always a transient fetch. LLM.swift is pinned to v3.0.3 in
  `app/plugins/oscode-llama/Package.swift`.
- **Build number conflicts**: the workflow stamps Codemagic's own
  `BUILD_NUMBER`; if you ever upload from Xcode by hand, bump past it.
