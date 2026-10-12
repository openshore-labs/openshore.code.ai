# Security

If you find a security problem in OpenShore, please report it privately,
never in a public issue. Either:

- use GitHub's private vulnerability reporting: the **Security** tab of this
  repository, then **Report a vulnerability**; or
- email support@openshore.ai with "Security" in the subject.

Say what you found, how to reproduce it, and what it affects. We will answer,
keep you posted while we fix it, and credit you when the fix ships unless you
would rather we did not.

Supported: the latest release of the desktop apps, the iPhone app and the
`osc` CLI (`@openshore/os-code` on npm), and `main`.

## What is in scope

The engine and the daemon (`os-code/`), the apps (`app/`), the account
backend (`supabase/`), and the release and update path (signed updates,
`app/electron/releaseVerify.ts`). How the pieces fit is in
[`ARCHITECTURE.md`](ARCHITECTURE.md); what each one sends off a device is
listed in `app/src/lib/egressManifest.ts`.

Out of scope: what a model says, and anything a model you run yourself can do
once its weights are on your own machine. The guardrail layer's limits are
written down in the README under "Honest limits".
