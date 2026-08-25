# Completion push: setup and deploy

Content-free notifications that tell the user when a desktop coding session
finishes, or needs an approval, while the OS Code app is closed. The agent loop
runs on the user's own daemon, so this is the one piece that has to reach the
phone from off-device. Nothing here is live until the steps below are done; the
code ships dormant.

How it fits together:

- The phone registers its APNs token (`push-register`), mints an opaque grant
  (`push-grant`), and hands the grant to its daemon.
- The daemon, when a run finishes idle or blocks on an approval and no phone is
  watching, calls `push-send` with the grant. `push-send` signs an APNs token and
  delivers a content-free alert. Payloads carry only an opaque session id.

## One-time Apple setup (you)

1. Apple Developer portal, Keys, add a key with **Apple Push Notifications
   service (APNs)** enabled. Download the `.p8` (you can only download it once).
   Note its **Key ID** and your **Team ID**.
2. Identifiers, `ai.openshore.oscode`, enable the **Push Notifications**
   capability. Do this **before** the next TestFlight build, or manual signing
   fails: the Release build requests `aps-environment = production`, and the
   provisioning profile must carry it.

## Supabase secrets (you)

Set these as function secrets (one command; paste the `.p8` contents for the
key). `APNS_AUTH_KEY_P8` is the whole PEM block including the BEGIN/END lines;
escaped `\n` is fine.

```
supabase secrets set \
  APNS_AUTH_KEY_P8="$(cat AuthKey_XXXXXXXXXX.p8)" \
  APNS_KEY_ID=XXXXXXXXXX \
  APNS_TEAM_ID=YYYYYYYYYY \
  APNS_TOPIC=ai.openshore.oscode
```

## Deploy (you, one command at a time)

1. Apply the migration:

   ```
   supabase db push
   ```

2. Deploy the three functions:

   ```
   supabase functions deploy push-register push-grant push-send
   ```

3. Cut a TestFlight build (the simulator cannot receive a push token; test on a
   real device). Merging this branch to `main` triggers the Codemagic build.

## Notes

- `push-send` is `verify_jwt=false`: trust comes from the grant, which resolves
  the target user and devices server-side, never from the request. A leaked grant
  can only cause content-free banners to its own owner, rate-limited, and is
  revocable by clearing its `push_grants` row.
- Sandbox vs production is per device token (`push_devices.aps_environment`) and
  routed per token, so a TestFlight build (production) and a local Xcode build
  (sandbox) both work without a server change.
- Turning it off: revoke a grant (delete the row) to stop one daemon; unset the
  `APNS_*` secrets to stop all pushes (the daemon calls become 503 no-ops).
