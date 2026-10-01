# Release signing: what the founder does once

Every desktop update is now checked before it runs. A release file is
trusted only when its signature matches a key built into the app, so a leaked
upload token (the one Codemagic uses, or GitHub's own) can no longer put its
own program on every desktop: at worst, an update is refused. This follows the
CTO's rulings 1 and 2 of 2026-09-29.

There are two keys, one per build service, so a leak on one cannot sign the
other platform's updates:

- **Mac key**: its private half lives only in Codemagic. It signs the Mac zip
  and dmg.
- **Windows and Linux key**: its private half lives only in GitHub's `release`
  environment. It signs the Windows installer and the Linux AppImage and deb.

## Until you do this

Both public keys in the app start empty, and that is safe but limited:

- **Mac**: the Update button opens the release page instead of updating in
  place. The person downloads the new version and macOS checks it.
- **Windows and Linux**: updates install as before, without the check. The
  app writes a line in its log saying the check was skipped.
- Releases still publish when you run the Release workflow, unsigned, exactly as today.

## The steps (about fifteen minutes)

1. **Make the keys.** On any computer with this repository and Node, run:

   ```sh
   node app/scripts/release-keygen.mjs
   ```

   It prints two key pairs, each with a private key and a public key, and
   says where each one goes. Nothing is saved to disk. Keep the terminal open
   for the next three steps.

2. **Mac private key into Codemagic.** In Codemagic, open the app's settings,
   then Environment variables. Add a variable named
   `OPENSHORE_MAC_SIGNING_KEY`, paste the Mac private key as its value, type
   `openshore-mac-signing` as its group, and tick Secure. Save.

3. **Windows and Linux private key into GitHub.** In the repository on GitHub,
   open Settings, then Environments.
   - Open the environment named `release` (create it with New environment if
     it is not there yet).
   - Under Deployment branches and tags, choose Selected branches and tags,
     then add the branch `main` and the tag pattern `v*`.
   - Leave Required reviewers off. Releases go out when you run the Release workflow.
   - Under Environment secrets, add `OPENSHORE_DESKTOP_SIGNING_KEY` and paste
     the Windows and Linux private key.

4. **Public keys into the app.** Open `app/electron/releaseKeys.ts` and paste
   the Mac public key between the quotes of `MAC_RELEASE_PUBLIC_KEY`, and the
   Windows and Linux public key between the quotes of
   `DESKTOP_RELEASE_PUBLIC_KEY`. Commit and push to main.

5. **Rebuild.** That push publishes a release. In its GitHub Actions run, the
   step "Sign the Windows and Linux files" should say `Signed` for each file.
   When the Mac build runs on Codemagic (started by the release, or by hand),
   its step "Sign the macOS files" should say the same. The release page then
   shows a `.sig` file beside every `.exe`, `.AppImage`, `.deb`, `.zip` and
   `.dmg`. Clear the terminal from step 1.

Do steps 2 and 3 before step 4. Once a build carrying a public key is
installed, every later release for that platform must be signed, or that
build refuses it: a Mac opens the release page, and Windows and Linux show
"The update did not finish".

## Building the Mac release by hand

`pnpm --filter oscode-app release:mac` signs the Mac files too when
`OPENSHORE_MAC_SIGNING_KEY` is set in your shell. Without it, the files carry
no `.sig`, and Macs with the Mac key open the release page for them.

## If a key leaks

Make a new pair for that platform only (`node app/scripts/release-keygen.mjs
mac` or `... desktop`), replace the secret, paste the new public key into
`releaseKeys.ts`, and push. Installed apps still hold the old key, so they
refuse that one release: people on that platform download it once from the
release page by hand, and updates work in place again from there.

## The Windows certificate (optional, unchanged)

Code-signing the Windows installer with a certificate stays optional: add the
`WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` repository secrets when you have
one. From the first build signed with it, the installed app also requires
that certificate's publisher name on every update, so **every Windows build
after that must be signed with it**. Never remove those secrets once they are
in use.
