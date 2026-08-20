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
