---
name: security-privacy-review
description: The CTO's security and privacy review for OpenShore, to the Proton standard. Use before an App Store or desktop release, before any change that adds a network call, a stored field, a table, a sign-in, a log line, a third-party service, or a privacy claim, and whenever the founder asks for a security or privacy review.
---

# OpenShore security and privacy review (the Proton standard)

OpenShore's promise is privacy: your models, your keys, your machine. The bar
is Proton's: keep the bare minimum, keep it unlinked, keep it briefly, say
exactly what you keep, and make every sentence about it true in code. Run the
sweep below; report findings ranked Critical, High, Medium, Low, each with
file:line, the concrete failure (who, from where, what they get), and the
smallest fix. Mark must-fix before submission versus follow-up.

The founder's own words (2026-10-01): "I only want to keep the bare minimum
data required to run the application. Use Proton as a gold standard North
Star for how we want to keep our users private and secure on the platform."

## 1. What our server keeps (supabase/)

- Every table and column that holds data about a person: name the feature
  that cannot work without it. No feature, drop it. A Personal build with
  the pay gates off needs an account (email, id), the synced preferences, and
  account deletion; little else.
- Linked or unlinked: a push token, a search, a diagnostic is never joined to
  the user id unless a feature needs it, with the reason written down.
- Retention: every personal table is covered by `delete-account`, and has a
  TTL where it can. "Forever" is a finding.
- Edge functions: no `console.log` of emails, tokens, request bodies, or IPs.
  Nothing passes a person's third-party token through our server unless the
  provider leaves no other way, and then it is never stored.
- A person's name, prompt text, code, keys, file paths and IP addresses never
  reach our tables.

## 2. What leaves the device (app/, os-code/)

- Every outbound call is on `app/src/lib/egressManifest.ts`, and the list, the
  App Store privacy label, and `app/ios/App/App/PrivacyInfo.xcprivacy` say the
  same thing. `app/test/egressManifest.test.ts` and
  `app/test/privacyManifest.test.ts` hold part of it; read them, do not
  trust them.
- Anything at launch or in the background with no tap is a finding unless it
  is on the list as "on" with a reason (update checks, catalog, preference
  sync). Prefer off until the person turns it on.
- Web search: what words go to which provider, from the app and from a Crew
  routine. Never the chat, never the files.
- The guardrail record: category, time, one-way hash. Never the prompt, never
  a named person.
- Required-reason APIs pulled in by every Capacitor plugin, not only ours.

## 3. Security of the engine, the daemon, and pairing

- Daemon routes: every route authenticated, bearer compares constant-time,
  binds to loopback or the person's tailnet only, `*.ts.net` is local only if
  it is the person's own tailnet (judged by address, `isLocalHost`).
- Pairing: one-time, short-lived, rate-limited claim codes; per-device
  credentials; revoke cuts one device.
- Secrets: in the OS secret store; never in a child process's environment
  (`os-code/src/core/exec/childEnv.ts`), logs, URLs, QR codes, journals, or
  crash text.
- Unattended work: a Crew routine reads text other people wrote. It may only
  search (when the switch is on), never fetch pages, never hand work to a
  cloud model; check the path from injected text to a search query that
  carries a secret.
- Electron: contextIsolation, sandbox, no nodeIntegration, a narrow `osc:*`
  surface with validated inputs, `openExternal` allowlisted, updates verified
  by `verifyAsset` against pinned keys.
- iOS: keychain accessibility class, file protection on chats and models,
  backups excluded for weights, no secrets in UserDefaults, ATS exception
  scoped to the user's own hosts by reason.

## 4. Claims are code

- Sweep the marketing site (`OpenShore.ai-marketing-site/src`, especially
  `privacy.njk`, `_data/tabpages.js`, `_data/oscode.js`, `_includes/viz.njk`,
  `ethics.njk`) and the app's copy (`egressManifest.ts`, `SettingsScreen.tsx`,
  `vaultCopy.ts`, greetings and guide cards) for absolutes: "never", "ever",
  "no phone-home", "nothing leaves", "encrypted", "no IP". Grep for the
  counterexample before allowing one.
- `/privacy` must be a privacy policy, not a feature page: who we are, what we
  collect and why, how long, processors (Supabase, Apple, the search
  provider, GitHub, and Stripe only when it sells), rights (access, export,
  deletion), children, contact (`SUPPORT_EMAIL`), and changes.
- App Store Connect's privacy answers and the App Review notes (in
  `openshore-hq`, `openshore-code/internal-docs/docs/app-review-notes.md`)
  match the code on the day of submission.

## 5. Output

A short verdict (ship / ship with these must-fixes / do not ship), then the
ranked findings, then a "Data we keep" table (data, where, why, retention,
keep, minimize, or drop). Record the run in `docs/` with its date, and any
ruling in `os-code/DECISIONS.md`.
