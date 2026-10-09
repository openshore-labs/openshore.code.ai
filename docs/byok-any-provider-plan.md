# Bring your own keys, any provider, and keys on your server

Founder, 2026-10-09: "I want VPS integrated with the most flexible way to
bring your keys with whatever provider since there are so many." Then: "Go.
Build this and push to Main. I agree with parking 'rent one for me'. I want
this to strictly be a bring your own keys scenario."

Strictly bring your own keys means OpenShore runs no gateway, resells no
model, rents no server, and holds no key on any machine of ours. Every key is
the person's, stored on the person's own device or the person's own server,
and spent only with the provider the person picked.

The plan has four parts, built in this order. Each part lands on main with its
tests, its egress entries, and its DECISIONS lines.

## Part 1. A longer list of named providers (Cloud Connections)

- Named providers join `PROVIDERS` (`app/src/lib/providers.ts`) as data, each
  with its OpenAI-compatible base, its key page, and `liveModels: true`, so
  the models come from the provider's own `GET {base}/models` on the person's
  key and nothing is typed here. Only providers whose base, key page, and
  model list were confirmed in their own documentation (2026-10-09) are named:
  Groq, Together AI, DeepSeek, Mistral, xAI, Cerebras, Hugging Face, Nebius
  Token Factory, Novita AI, MiniMax, and NVIDIA. Everyone else (Fireworks,
  DeepInfra, Hyperbolic, Z.ai, Alibaba Model Studio, Cohere, SambaNova,
  Featherless, a provider founded next week) works through Part 2.
- The live list reader accepts the shapes these providers send (a `data` list
  or a bare list; row types `text`, `chat`, `model`, and Mistral's `base`
  rows that say they chat) and drops rows that are not chat models.
- A key check that a provider answers with 400 (xAI) reads as rejected, not
  unverified, per provider.
- Cloud Connections keeps its familiar seven at the top, then the connected
  named providers, then one "More providers" row opening a searchable sheet of
  the rest. On a phone, a last row points to "Any address" in the Stack.
- Fixes the larger list makes visible: removing a provider takes its models
  off every stack, as removing a connected model already does; an error names
  the provider, never its id; a DeepSeek reasoning turn keeps
  `reasoning_content` when it replays a tool round; and the desktop's
  guarded fetch carries `x-api-key` and `anthropic-version`, so the desktop's
  Claude key check sends its key.

## Part 2. Any address (the Stack's "Connect a model")

- The form takes a name, an address, a format (OpenAI-compatible or
  Anthropic-compatible), and an optional key, then reads the address's own
  model list and lets the person tick several. A typed model name stays as the
  fallback for a server with no list.
- One connection per ticked model, sharing an `addressId`, so every reader,
  sweep, and saved placement keyed `byom:<id>` keeps working. The key is
  written under each connection's own secret name.
- The Anthropic format sends a conservative Messages request (no adaptive
  thinking, no cache markers, no workspace header, a set `max_tokens`, merged
  same-role turns) and falls back to no tools on a 400, 404 or 422 in round
  one, as the OpenAI path does. Stop answers at once on both formats.
- "It passes requests on to a cloud provider" is a stricter-only mark on a
  connection (a gateway such as LiteLLM on your own network). Marked, the
  connection is cloud everywhere the app judges reach (`byomReach`,
  `packSeatFor`), so private notes never go to it. The mark can only make a
  connection count as leaving, never staying.
- A window the model list reports is kept only for an address that leaves
  this network (for a local server it is the native window, not the served
  one).

## Part 3. Keys on your server

- When a server (`osc serve --server`, docked over Tailscale) is docked, a
  connected provider's row in Cloud Connections gains "On your server". On,
  the key goes once over the docked link to the server's own encrypted
  credential store, and the server's coding sessions can use it while this
  device sleeps. Off, the server deletes it. Removing the provider here
  removes it there too. Forgetting the server deletes its keys there first.
- The server keeps only the key and the provider's address. It never checks
  the key itself (no new outbound call, no key-checking oracle); the first
  use shows whether it works. `GET /keys` answers which providers hold a key
  there, never the key, a fingerprint, or a date.
- "Use on your server" places one of that provider's models as the server's
  model, so a key is never stranded with nothing to run.
- Routines stay offline and on a local model (CTO 3), and the free chat with
  a server stays local; copy says the key serves coding sessions on your
  server, never "always on" and never routines.
- Over SSH, `osc key add <provider>` reads the key from the terminal or a
  pipe (never from the command line), `osc key list` names the providers, and
  `osc key remove <provider>` deletes one. A key added there never passes
  through the phone.
- The routes answer only on a server and only to an admin device. Every error
  is scrubbed of keys.

## Part 4. Your own gateway, as a guide

For Bedrock, Azure, and Vertex, which sign in their own way, a short guide
shows running LiteLLM on your own computer or server with your own keys, then
connecting it through Part 2 with the gateway mark on. A guide, not code we
run.

## What stays parked

"Rent one for me" (OpenShore creating the server through a provider's
account), founder, 2026-10-09.
