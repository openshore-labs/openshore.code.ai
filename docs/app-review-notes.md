# App Review notes

Justifications to paste into App Store Connect review notes, and the standing
reasoning behind iOS configuration choices a reviewer may flag.

## App Transport Security: `NSAllowsArbitraryLoads` is on

`app/ios/App/App/Info.plist` sets `NSAllowsArbitraryLoads = true`. This is
deliberate and required. Justification for the reviewer:

> OS Code connects the iOS app to a code-execution daemon running on the user's
> own computer, reached over the user's private Tailscale tunnel or local
> network. These are private, user-owned hosts addressed by IP in the CGNAT
> (100.64.0.0/10) and RFC-1918 LAN ranges, not public DNS names, so they cannot
> be expressed as ATS exception domains and are not covered by
> NSAllowsLocalNetworking. Traffic stays inside the user's private tunnel. All
> third-party provider traffic (Hugging Face, Anthropic, Supabase) uses standard
> HTTPS. NSAllowsArbitraryLoads is required only to permit the plain-HTTP
> connection to the user's own device inside that private tunnel.

Why it is not narrowed:

- `NSExceptionDomains` keys on hostnames. The daemon has no stable public
  hostname; it is reached by a CGNAT or LAN **IP** that differs per user and per
  network, so there is no domain to scope an exception to.
- `NSAllowsLocalNetworking` covers RFC-1918 and link-local ranges but **not**
  the Tailscale CGNAT range (100.64.0.0/10), which is the primary transport, so
  it does not suffice on its own.
- Every outbound call to a real internet service (model downloads, cloud
  inference, account/billing) already uses HTTPS. The blanket flag only enables
  the one plain-HTTP hop to the user's own machine.

If Apple pushes back, the fallback is to keep the blanket load setting and
reiterate the above; there is no correct narrower configuration while the
transport is IP-addressed CGNAT.

## Background model downloads (background URLSession)

Pocket-model weights (Harbor, Harbor Mini, and marketplace models) are large:
about 380 MB to over 1 GB each. They download on a background `URLSession`
(`URLSessionConfiguration.background`, identifier
`ai.openshore.oscode.model-downloads`, in
`app/plugins/oscode-llama/ios/.../ModelStore.swift`) so the transfer survives
the user backgrounding or closing the app, and iOS relaunches the app in the
background to finish it. This is the standard system download mechanism, so:

- No `UIBackgroundModes` entry is required or declared. Background transfers are
  a first-class URLSession feature and do not need a background-mode
  capability. The only wiring is the AppDelegate's
  `handleEventsForBackgroundURLSession`, which hands the completion handler back
  to the session so the app re-suspends cleanly.
- Weights come straight from the source over HTTPS (Hugging Face resolve URLs);
  OpenShore never rehosts them. The files land in Application Support, excluded
  from iCloud backup, since they are re-downloadable.
- No silent or speculative downloads: a transfer only ever starts from a user
  action (choosing a guide or a marketplace model). `isDiscretionary` is false
  only so the download the user just asked for starts promptly rather than
  waiting for wifi and a charger.

## Completion push notifications (Push Notifications capability)

When the user starts a desktop coding session, the agent loop runs on their own
computer (the OS Code daemon), not the phone, and keeps running while the app is
closed. A content-free push tells the user when a run finishes, or blocks waiting
for their approval, so they know to come back. Justification for the reviewer:

> OS Code sends a local-work completion alert. The user's coding session runs on
> a machine they own (their desktop, reached over their private Tailscale
> network); when it finishes or needs the user's approval while the app is
> closed, the app receives a notification so the user can return. The push
> payload contains no code, no prompt, and no result, only an opaque session
> identifier. The device token is used solely to deliver these notifications and
> is never used for tracking.

Configuration notes:

- **Capability:** Push Notifications is enabled on the `ai.openshore.oscode` App
  ID; the entitlement is `App/App.entitlements` (`aps-environment`, set per build
  configuration via `APS_ENVIRONMENT`: development for local Debug, production
  for the Release build that ships). The provisioning profile must carry the
  entitlement, so enable Push on the App ID before the next distribution build.
- **No `UIBackgroundModes`.** This is a visible alert push, not a silent
  `content-available` background fetch, so no background mode is declared. The
  model download uses a background URLSession (above); the two are unrelated.
- **Permission is contextual.** The app asks for notification permission when the
  user first opens a desktop session (the walk-away-able moment), never at
  launch.
- **Privacy nutrition label / PrivacyInfo:** disclose the APNs device token in
  App Store Connect as data collected and used only to deliver notifications, not
  linked to identity and not used for tracking. If a `PrivacyInfo.xcprivacy`
  manifest is added to the target, mirror the same disclosure there.
