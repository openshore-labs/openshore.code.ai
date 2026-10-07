# Proposal: every way to connect a model, made easy (2026-10-07)

Status: BUILT on `claude/connect-anywhere-proposal` (2026-10-07): parts A and B, with the founder's
additions (the room is Computer, linking is docking, a server is set up in Cloud Connections
too, nothing gated). Part C, the GPU server's spend line and Stop, and the reference VPS eval
are not built. What was built and what is left: `os-code/PROGRESS.md`. Founder brief: "the main
paths for use [are] cloud provider APIs, local models on your device, local
models on your hub device that pairs via Tailscale, and VPS. I want to lower
the barrier of entry and streamline all of those options." And on servers:
"You could get these huge models and control them in your phone like you are
coding with Claude." Prompted by a friend who uses Venice.ai's API from VS Code.

## The answer in ten lines

1. Treat it as two questions, not one list. **Where the model thinks** (the
   brain) and **where the work happens** (the hands: files, terminal, Crew,
   Vault). Today they are tangled; untangling them is the streamlining.
2. There are five brains: a cloud API, this device, your computer over
   Tailscale, your server, and an AI subscription you already pay for. The
   founder's four plus the one that was missing.
3. There are three places for the hands: this device, your computer, and your
   server. A server is just "your computer" that someone else's building keeps
   powered.
4. Every brain is added from one door, **Add a model**, and lands as the same
   row in the Stack with one line saying where it runs. Every place for the
   hands is added from one door, **Add a computer**, in Pairing.
5. Servers come in two kinds, and copy must not blur them. A **small server**
   (CPU, a few GB, a few dollars a month) runs the engine and a 3B or 4B all
   the time. A **GPU server** (rented by the hour) runs the huge models. The
   "huge models from my phone" picture is a GPU server, and it costs money
   while it runs.
6. Most of the server path is already built: `osc serve` runs headless, binds
   the tailnet only, and runs Crew with no desktop app. The one real gap is
   pairing a phone to it, which today only the Electron app can approve.
7. Tailscale stays the only door to a computer. No public bind, ever.
8. Venice.ai is a cloud API, and it works today through Connect a model. Make
   it, and OpenRouter (one key, hundreds of models), one tap.
9. Copy stays honest: "while your server is running", never "always on"; no
   speed or quality claim about a server until `osc eval` has run on one.
10. "Rent one for me" (OpenShore creating the server through a provider's
    API) is the most native feel and comes last, on its own go.

## The map

Brains (where the model thinks):

| Brain                   | Examples                                                                    | Colour                                  | Who pays                    | State today                            |
| ----------------------- | --------------------------------------------------------------------------- | --------------------------------------- | --------------------------- | -------------------------------------- |
| Cloud API               | Anthropic, OpenAI, Google, Moonshot, Perplexity; **add** Venice, OpenRouter | amber                                   | per token, the person's key | Built (`app/src/lib/providers.ts`)     |
| This device             | Harbor Lite on the phone, Ollama on the desktop                             | teal                                    | nothing                     | Built                                  |
| Your computer           | Ollama or a model server on the paired desktop, over Tailscale              | teal                                    | nothing                     | Built (BYOM over the tailnet, the hub) |
| Your server             | Ollama or vLLM on a rented box, over Tailscale                              | teal, with a spend line on a GPU server | the server's rent           | **New** (part B)                       |
| A subscription you have | Claude Code, Codex, through CLI Pairing                                     | amber                                   | the person's plan           | Built as a v2 current (CLI Pairing)    |

Hands (where the work happens):

| Place         | What runs there                                                        | State today           |
| ------------- | ---------------------------------------------------------------------- | --------------------- |
| This device   | chats; on the desktop the whole engine                                 | Built                 |
| Your computer | engine, Terminal, Crew, Vault, coding sessions, reached from the phone | Built (pairing, Plus) |
| Your server   | the same, on a box that stays up                                       | **New** (part B)      |

Any brain can drive any hands the rules allow: a phone can code on a server
with Claude, or chat with a 70B on a GPU server while its files stay on the
desktop. Crew keeps its rule that a routine runs on a local brain, judged by
address, so a model on the person's own server qualifies and a cloud API does
not.

## Am I missing anything? Yes, four things

1. **Subscriptions people already pay for.** Many people have Claude Pro or
   ChatGPT Plus, not an API key. CLI Pairing (Claude Code or Codex run
   headless on the person's computer) is that path, and it is built as an
   Agentic Current in tier 2. It is the lowest barrier of all for those
   people. Recommend naming it in Add a model as a door, with the door shut in
   the Personal build until tier 2 opens, so the plan is visible.
2. **One key for everything (routers).** OpenRouter gives one key and one bill
   for hundreds of models; Venice is a smaller, privacy-led version of the
   same idea. For a newcomer, one key beats five accounts. Add OpenRouter as
   a named provider beside Venice.
3. **GPU by the hour.** "Huge models" need a GPU server, and GPU servers cost
   enough per hour that people start and stop them. That needs a start and
   stop the person can see and a running-cost line, not just a pairing.
   Phase 6 below.
4. **Recovery when a path breaks.** Every path above fails differently (key
   expired, Tailscale off, server down, model not pulled). One "Why can't I
   reach it" line per row, from the existing `daemonHealth` and key checks,
   is part of streamlining; a newcomer cannot debug five setups.

Also considered and left where it is: a work or team server (shared hubs) is
tier 4 (Enterprise) and stays there.

## Part A: Add a model, one door

**Today.** Cloud keys live in the provider list, BYOM is "Connect a model" in
the Stack, local picks are the First Seat and the catalog, and the hub's models
come through pairing. Four places for one idea.

**Change.** One sheet, **Add a model**, from the Stack and from the empty chat,
with these doors in this order:

1. **On this device** (the fit-aware pick; downloads are a card the person taps).
2. **On your computer** or **On your server** (lists what the paired machine
   has; shown once one is paired, otherwise "Pair a computer" leads to part B).
3. **With an API key**, a grid of named providers plus "Any OpenAI-compatible
   address" (today's BYOM form).
4. **With a subscription you have** (CLI Pairing; shut in Personal).

Each finishes as the same Stack row with a "Runs on" line: "This iPhone",
"Your computer (studio-mac)", "Your server (hetzner-1)", "Venice, cloud".

**New named providers.** Venice (`https://api.venice.ai/api/v1`,
OpenAI-compatible) and OpenRouter, each one entry in `PROVIDERS`
(`app/src/lib/providers.ts:45-254`), with the key check and secret storage
for free. The rules:

- Egress: each API host goes on the `cloud-models` entry and is named in its
  `what` line (`app/src/lib/egressManifest.ts:199-212`); each key page's host
  goes on `LINK_ONLY_HOSTS`. The egress test fails until both are there.
- Claims: Venice's policy says it does not store prompts or outputs, and its
  terms say some models are served through third parties it binds not to
  train on user content. We cannot verify either. Copy attributes ("Venice says
  it does not keep your prompts") or says nothing. OpenRouter forwards to many
  providers with their own policies; copy says so.
- Run the security-privacy review skill on the diff.

Tier and gate: free, like every connected model (chatting needs no account).

## Part B: your server

### What already works

| Piece                       | Where                                                         | On a headless Linux box                            |
| --------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| Headless daemon             | `os-code/src/commands/serve.ts`, `osc serve --bind tailscale` | Works. Port 4816, tailnet plus loopback.           |
| No public bind              | `os-code/src/core/security/daemonAuth.ts:148-159`             | Enforced, no override. Keep it.                    |
| Crew scheduler              | `os-code/src/routines/scheduler.ts`, started by `startDaemon` | Runs with no desktop app. One clock per machine.   |
| Per-device credentials      | `os-code/src/core/security/credentials.ts`                    | Hashed, mode 600, 180 days, revocable.             |
| Desktop to another computer | `RemoteHubPanel`, `app/src/screens/PairScreen.tsx:399-475`    | Works with an address and an `osc token mint` key. |
| Locality                    | `os-code/src/harness/locality.ts`                             | A 100.x tailnet address reads local.               |
| Vault over the daemon       | `app/src/lib/gitos/hub.ts`                                    | Works against any daemon.                          |

### What is missing

1. **Approving a phone.** `startDaemon` hands out a credential only when
   `options.approvePairing` says yes (`serve.ts:187-197`), and only Electron
   sets it, so `osc serve` can never pair a phone.
2. **Minting the QR claim.** Only Electron does it (`engineHost.ts:1086-1090`).
3. **Installing.** From source today (pnpm, build, link, Node 22.12+).
4. **Staying up.** No service unit; the daemon dies with the SSH session.
5. **Copy.** "Check that it is awake with OpenShore open"
   (`remoteDriver.ts:156-157`) is wrong for a server.

### The design

**1. `osc pair --server`.** Run over SSH. Starts or attaches to the daemon,
mints a claim through `pairClaims.ts`, prints the QR in the terminal on the
tailnet address, and the address and code as text. When a phone claims, the
terminal shows its label and four-digit code and asks `Allow this device?
[y/N]`. The person signed in to the server gives the yes, the same trust as
the desktop's native dialog; the approver exists only while the command runs,
so an unattended server still never hands out a credential. An admin device
already paired can approve the next one through a new admin route, so a second
phone needs no SSH.

**2. One install command**, shown in the app with a copy button:

```sh
curl -fsSL https://github.com/openshore-labs/openshore-releases/releases/latest/download/install-server.sh | sh
```

- Downloads one Linux server asset (x64, arm64) from the GitHub Release with
  Node bundled, and checks it against the pinned Ed25519 keys desktop updates
  use (`app/electron/releaseVerify.ts`, `releaseKeys.ts`) before running it.
  The script is short and the sheet links it, so a careful person can read it
  first.
- Creates an `openshore` system user and a systemd unit
  (`osc serve --bind tailscale`, restart on failure); `~/.os-code` at 700.
- No Tailscale: it stops and prints Tailscale's own install line and
  `tailscale up`. We do not install network software on someone's box silently.
- Ends by running `osc pair --server`.
- `release.yml` gains the asset and a headless smoke test.

**3. Add a computer, in Pairing.** One sheet with two doors: "A computer at
home" (today's desktop QR flow) and "A server you rent" (three steps: rent any
Linux box, 2 GB or more, no provider named or ranked; paste the command over
SSH; scan). The row reads "Your server (hostname)"; `/health` gains
`kind: 'server' | 'desktop'` so the app knows without asking. The desktop's
bare Access-key field moves under "Other ways".

**4. A brain on the server.** The installer offers Ollama with the fit-aware
pick, the same table as the reference box (4 to 8 GB CPU: a 3B or 4B; a 7B
does not fit). That is the small server: always ready, cheap, and the floor
the harness was tuned for.

### Part B2: the GPU server, "huge models from my phone"

The same install on a GPU box, with vLLM or Ollama serving a large open model
(a 32B coder on one big GPU, 70B and up on more), reached over the tailnet.
It works through the same pairing and the same Add a model door. What it adds:

- **Cost is visible.** A GPU server is billed by the hour. Its row carries an
  amber spend line ("Billed by the hour by your provider while it runs") even
  though the address is teal, because tenet 4's amber means spend, not only
  cloud. OpenShore cannot read the provider's meter without its API (part C),
  so the line states the fact, not a number.
- **Stop is one tap.** The row has "Stop the model" (unloads it, frees the
  GPU) through the daemon; stopping the machine itself is the provider's
  console until part C.
- **Big models want big context.** The engine budgets against the window the
  server really serves (`servedWindow.ts`), so a 70B with a short served
  window is planned as one.
- **Measure first.** `osc eval --deep` on a GPU server, recorded beside the
  reference box, before any copy says how good or how fast.

### The honesty calls

- **Local by address, rented by fact.** A model on the person's server,
  reached over their tailnet, reads local, and the privacy rules and Crew
  treat it as local. Setup says once: "This server runs on hardware you rent
  from another company, which can reach its disk. Pick one you trust." The
  Vault stays on the person's own device unless they choose "on your server"
  in Vault.
- **Never always on.** Routines skip a slot missed while the box was down
  (`scheduler.ts:582`). Copy: "while your server is running".
- **Secrets.** No OS keychain on a headless box. Keys stay in `~/.os-code`
  (600, the `openshore` user), never in the unit's environment
  (`childEnv.ts`). Settings says where. The security review weighs it.
- **What we keep.** Nothing new on our servers: no server list, address or
  hostname reaches Supabase. Pairing goes over Tailscale with nothing through
  us, as the `your-computer` manifest entry already says.

## Part C, later: "Rent one for me"

The person pastes a provider token (Hetzner first for small servers; a GPU
provider separately), OpenShore creates the box with cloud-init that runs the
installer and joins the tailnet, and the QR arrives on its own; with the token
it can also start, stop, delete, and show the meter. Each provider is a new
third-party service with its own manifest entry and review, the token can
spend the person's money (kept on the device only, every create or start an
amber card the person taps, Delete always free), and it ranks providers. Build
it only once part B shows people renting servers for OpenShore.

## Tier, gate, and order

- **Tier.** Parts A and B are one person and their own machines, so tier 1
  (Personal): `FEATURE_TIER` gains `servers: 1`, recorded in DECISIONS as the
  founder's go of 2026-10-07. The subscription door stays tier 2 with CLI
  Pairing. Part C is its own call.
- **Gate.** New providers and Add a model are free. Pairing a server is Plus
  (`PAY_GATE.pairing`); revoking and forgetting stay free.
- **Order.** Each step ships alone and leaves the app working:
  1. Venice and OpenRouter as named providers (part A, providers).
  2. `osc pair --server`, the terminal yes, `/health` kind, the admin-approve
     route. Testable on any Linux box with Tailscale.
  3. The server asset, installer, systemd unit, smoke test.
  4. Add a computer and the server copy in the app.
  5. Add a model, the one door, with the "Runs on" line and the
     reach-it diagnosis per row.
  6. The GPU server: the spend line, Stop the model, the eval run.
  7. Part C on its own go.

## Founder decisions still open

1. A rented server judged local by address, with the one setup line? Or amber,
   which keeps Crew off a model on the server?
2. Tailscale only (recommended: one reviewed door), or an SSH-tunnel path too
   for people who will not install Tailscale?
3. Show the subscription door shut in Personal, or hide it until tier 2?

Sources for the Venice facts: [Venice API reference](https://docs.venice.ai/api-reference),
[Venice OpenAI migration guide](https://docs.venice.ai/overview/guides/openai-migration).
