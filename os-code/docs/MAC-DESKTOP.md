# macOS desktop build (Codemagic, Developer ID)

The `mac-desktop` workflow in `codemagic.yaml` produces a signed, notarized
macOS app a person can download from openshore.ai and open with no Gatekeeper
warning: a `.dmg` and a `.zip`, each for Apple Silicon (arm64) and Intel (x64).

This is a Developer ID build (distributed from your own site), not a Mac App
Store build, and it is separate from the iOS TestFlight pipeline. It reuses your
Apple Developer account but needs its own certificate and its own Codemagic
variable group.

The workflow does not run on its own. It has no trigger, so it only runs when
you start it by hand from the Codemagic UI. That is deliberate: it costs Mac
minutes and it fails until the secrets below exist, so it should never fire on
an ordinary push.

## One-time Apple setup

You need three things from Apple: a Developer ID Application certificate, an App
Store Connect API key for notarization, and your Team ID.

### 1. Developer ID Application certificate

This is the certificate that signs a desktop app for distribution outside the
Mac App Store. It is not the same as the iOS distribution certificate the
TestFlight build uses.

1. Go to developer.apple.com, Certificates, Identifiers and Profiles,
   Certificates, and add one of type **Developer ID Application**.
2. Follow the prompts (upload a certificate signing request, or let Xcode create
   it), then download the resulting `.cer` and open it so it lands in your login
   Keychain.
3. In Keychain Access, find the certificate, expand it so its private key shows
   under it, select both the certificate and the key, right click, and Export
   the pair as a `.p12`. Set an export password and remember it.
4. Base64 the `.p12` so it can live in an environment variable:

   ```
   base64 -i DeveloperID.p12 | pbcopy
   ```

   That copies the value for `CSC_LINK`. The export password is
   `CSC_KEY_PASSWORD`.

### 2. App Store Connect API key (for notarization)

1. Go to App Store Connect, Users and Access, Integrations, App Store Connect
   API, and generate a team key. Access level **Developer** is enough to
   notarize.
2. Download the key file (`AuthKey_XXXXXXXXXX.p8`). App Store Connect lets you
   download it only once, so keep it safe.
3. Note the key's **Key ID** (the ten characters in the file name) and the
   **Issuer ID** (a UUID shown at the top of the Keys page).
4. Base64 the `.p8` (it is multiline, so it has to be encoded to fit one
   variable):

   ```
   base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
   ```

   That is the value for `APPLE_API_KEY_B64`.

### 3. Team ID

On developer.apple.com, Membership details, copy the ten-character **Team ID**.

## The Codemagic variable group

In Codemagic, open the app (or team) Environment variables and create a group
named exactly `openshore-mac-signing`. Add these six variables and mark every
one **Secure**:

| Variable            | Value                                          |
| ------------------- | ---------------------------------------------- |
| `CSC_LINK`          | base64 of the Developer ID Application `.p12`  |
| `CSC_KEY_PASSWORD`  | the password you set when exporting the `.p12` |
| `APPLE_API_KEY_B64` | base64 of the `AuthKey_XXXXXXXXXX.p8`          |
| `APPLE_API_KEY_ID`  | the API key's Key ID (ten characters)          |
| `APPLE_API_ISSUER`  | the Issuer ID (a UUID)                         |
| `APPLE_TEAM_ID`     | your ten-character Apple Team ID               |

The workflow already imports this group by name, so nothing in `codemagic.yaml`
changes once the group exists.

## Sign-in comes along for free

The workflow also imports `Harbor-os-code`, the same variable group the iOS
build uses, so `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` reach this
build's Vite compile too. Sign-in on the resulting desktop app works exactly
like it does on iOS, with no extra setup here, as long as that group already
has those two values (it does, since iOS sign-in works). Without them, sign-in
quietly does not render (see the note on the Linux build in
`.github/workflows/release.yml`) and the rest of the app is unaffected.

## Running it

1. In Codemagic, pick the `mac-desktop` workflow and start a build on `main`.
2. It installs, runs the full test gate, builds the app, rebuilds the native
   terminal module for Electron, then signs and notarizes. First notarization
   can take a few minutes while Apple's service processes the upload.
3. When it finishes, the build's Artifacts list has the `.dmg` and `.zip` for
   both architectures.

## Getting it to users

The signed files are the download. Host them the same way the Linux build is
hosted (a GitHub Release, or object storage) and point the "Get OpenShore"
button on the marketing site at them. The files are too large for the marketing
site's own static hosting (Cloudflare Pages caps a served file at 25 MiB).

## Notes

- The app id is `ai.openshore.oscode`, shared with the iOS build. That is fine:
  a Developer ID desktop app and an App Store iOS app can share a bundle id.
- If notarization ever fails with an authentication error, the API key values
  are the first thing to check: `APPLE_API_KEY_B64` must decode to the exact
  `.p8`, and the Key ID and Issuer ID must match that key.
- The certificate must be a Developer ID Application certificate. An iOS or Mac
  App Store certificate will sign but will not pass notarization for direct
  distribution.
