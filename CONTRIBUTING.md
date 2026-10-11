# Contributing to OpenShore

Thanks for wanting to help. OpenShore is a local-first coding agent and app:
your models, your keys, your machine. The code is open source under the
Apache License 2.0 (`LICENSE`). This page says how to get a change in.

## How the project is run

OpenShore is maintained by Open Shore LLC, which owns this repository, the
OpenShore name, and the official builds (the App Store app, the signed
desktop releases, and their update feed). The maintainers review every pull
request and decide what merges and what ships. A good change can still be
turned down if it does not fit where the product is going; when that
happens we say why.

Big ideas are welcome. Open an issue first for anything larger than a fix,
so nobody spends a weekend on something that will not land.

## The agreement

Before your first pull request can merge, you sign the OpenShore
Contributor License Agreement (`CLA.md`). It takes a minute, through the
CLA check on the pull request. You keep the copyright in what you write;
the CLA gives Open Shore LLC the license to ship it, including under other
terms later. Contributing for an employer? Make sure you are allowed to.

## Rewards

Sometimes we pay contributors for work we value. That is our choice, case
by case, and never a promise: nothing about contributing entitles anyone to
payment, and a payment for one change says nothing about the next. Any
payment is a one-time reward unless we agree otherwise in writing.
Contributing does not make you an employee or contractor of Open Shore LLC.

## Getting set up

You need Node 22.12 or newer (`.nvmrc` pins the version CI uses) and pnpm
(`corepack enable`).

```
pnpm install
pnpm desktop
```

Point the desktop app at Ollama, or any OpenAI-compatible local server, and
pick a model. No account and no cloud key are needed to chat; a build with
no account backend configured stays open.

## Before you open a pull request

Run what CI runs:

```
pnpm --filter os-code build
pnpm -r format:check
pnpm -r lint
pnpm -r typecheck
pnpm -r test
```

The house rules are tests, so a red check usually names the rule. The ones
that surprise people most:

- **No em dashes, anywhere**, comments included
  (`test/em-dash-policy.test.ts` in both packages). Use a period, a comma, or
  a rewrite.
- **Copy says only what is true.** Every claim in the app has a test behind
  it, and nothing is called faster, smarter, private, or "always on" unless
  the code makes it so.
- **Everything that leaves a device is on one list**
  (`app/src/lib/egressManifest.ts`). A new network call is not done until its
  entry says what it sends and when.
- **Motion and UI use the tokens and guards** in `app/src/theme.css` and
  `app/test/support/uiGuards.ts`.
- **A project's own config can only make OpenShore stricter** until the
  person trusts that folder (`os-code/src/config/projectPolicy.ts`). A new
  config key is classified there.

`CLAUDE.md` holds the full set of standing rules, written for the coding
agents that work on this repository and just as true for people.

## Pull requests

- Keep each one to one change, with a title that says what it does.
- Say what you changed and how you checked it.
- Add or update the test that would have caught the problem.
- Do not commit secrets, keys, or model weights.

## Security

Please do not open a public issue for a security problem. See
`SECURITY.md`.
