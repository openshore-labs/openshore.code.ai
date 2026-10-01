# Pairing, reviewed and rebuilt (CX-led Creative Studio, 2026-10-01)

Founder brief: "Can you do a code review on the desktop+phone? Let's change the
name of that to Hub Pairing or something like that. Bring in my creative
studio, led by CX, to make sure this is a seamless and simple process. I liked
the QR code scanning that was pretty easy. Just take a whole look at the UI/UX
and code base to get it near-perfect." Same shape as the room redesigns: the
read, the direction, what shipped.

## The name

**Pairing.** "Hub pairing" was weighed and set aside: house Sentence case makes
it "Hub pairing", and "hub" is a word the brand sweep took out of customer copy
(`app/test/copy-glossary.test.ts` retires "your hub" for "your computer").
"Pairing" is one plain word people know from Bluetooth, it reads right from
either side (the desktop pairs a phone, the phone pairs a computer), and it
matches the "pairing code" and "Paired devices" already on screen. The phone's
page heading and the guide's step stay "Connect your computer". The glossary
now retires "Desktop + phone" and "Hub pairing" for "Pairing". The tray reads
"Pause phone access" and "Resume phone access".

## The read: bugs (all fixed)

1. A revoked phone was never told so. Its 401 carries no CORS headers, so the
   WebView's stream saw a network error and the link sat on "away" forever.
   Now, once per outage, the driver asks the credential-free route, and a
   refusal ends the chat with "Pair again" (`remoteDriver.ts`).
2. A spent pairing code could be thrown away. The phone traded the code, then
   dropped the new credential if the first health check timed out (a first
   Tailscale link through a relay is often slow), leaving a row on the
   computer nothing used. The credential is now saved first, the check
   retries once after two seconds, and a slow computer reads "Paired. Your
   computer did not answer the first check, so it may still be waking up."
3. Turn off did not survive a relaunch: the app reopened phone access at every
   launch. It is now remembered in userData (`lifecycle.ts`
   `readHubPaused`/`writeHubPaused`) and the launch skips the start.
4. Revoking did not cut an open event stream or shell. Both now re-check
   their credential on every keepalive (15 seconds) and end when it is gone.
5. Forgetting a computer on the phone left the phone's credential live on the
   computer. A new `DELETE /pair/self` revokes exactly the presented
   credential; Forget calls it, and so does pairing the same computer again.
6. Every phone was called "iPhone". An iPad now says iPad, and each row shows
   the date and time it paired, so two phones are told apart.
7. A QR could point the phone anywhere. A pairing QR or link is now accepted
   only for an address on the person's own network (loopback, the LAN, the
   tailnet's 100.x addresses), judged by address with the shared
   `hostIsLocal`, so a planted QR can never pose as "your computer".
8. Launch at login had a bridge and no switch. The desktop's Phone access card
   now has "Open OpenShore when this computer starts", with the line "Your
   phone reaches this computer only while OpenShore is open on it."

## The direction: UX (shipped)

- **The QR is a link** (`oscode://pair?u=...&c=...`), so the iPhone's own
  Camera app opens OpenShore with it. Pairing then asks "Pair with this
  computer?" with the host, Cancel and Pair; a link alone never pairs. The
  in-app scanner reads the link and the older JSON QR alike. The desktop says:
  "On your iPhone, point the Camera at this code, or open OpenShore, then
  Menu, Pairing, Scan."
- **An "it worked" moment on the desktop:** a phone that pairs while the room
  is open is named at the top ("iPhone paired"), with one haptic, and the QR
  folds into "Pair another phone".
- **The phone after pairing looks different:** "Connected to {name}" with a
  live Reachable or Not reachable pill, the terminal one tap away, and the
  setup steps folded away.
- **Scan first, typing second:** manual entry sits behind "Can't scan? Type
  it in", with placeholders that say where to look; the paste tip is gone
  (pasting still fills both fields).
- **Connecting reads as connecting:** the button says "Connecting to your
  computer..." while it works.
- **A wrong QR never ends the scan:** the camera keeps running and the sheet
  says that QR is not a pairing code. The camera error says where to allow it.
- **No sudo on a Mac:** the Tailscale line names the command on Linux only,
  and the desktop offers its own Tailscale download when Tailscale is down.
- **The guide points at what is there:** "On your computer, open OpenShore,
  then Pairing. The QR is there (if it says Off, tap Turn on)."
- **Revoke asks first**, in the confirm grammar: "Revoke {device}?", Cancel,
  then the danger button.
- **The expert tools fold away:** "Run on another computer" and "Replace the
  shared key" sit under More options.
- **Copy claims no more than is true:** the pairing code is "good for five
  minutes and only on your Tailscale network", and an expired code says to
  scan the new QR.

## Not changed, on purpose

The QR scan as the hero path and scan-then-connect in one motion; the
one-time claim traded for the phone's own credential, its five-minute life
and rate limit; no QR while the computer is reachable on loopback only;
`hubStatusLine` as the one tested source for status copy; the paywall before
the camera, with Revoke, Forget and Turn off always free; the split between
"refused" and "unreachable"; the sheet-based scanner and the house motion.

## Not yet built

The MagicDNS name in the QR (an IP can change if Tailscale is reinstalled), and
a "Get OpenShore for your computer" link on the phone (it needs the founder's
download URL and an egress entry). Nothing here has been run on a device yet.
