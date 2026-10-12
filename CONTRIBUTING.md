# Contributing to OpenShore

Thanks for wanting to help. OpenShore is a local-first coding agent and app:
your models, your keys, your machine. The code is open source under the
Apache License 2.0 (`LICENSE`). This page says how to get a change in.

## The short version

Make something work. That is the whole bar.

You do not need to polish the look, the motion, or the wording. Formatting,
design and every word a person sees get snapped to the OpenShore brand
guidelines by the maintainer when your change is pulled in. Spend your time
on a feature that functions and a test that shows it does.

## How the project is run

OpenShore is maintained by Open Shore LLC, which owns this repository, the
OpenShore name, and the official builds (the App Store app, the signed
desktop releases, and their update feed). The founder decides what merges
and what ships. A working change can still be turned down, or reshaped
before it lands, if it does not fit where the product is going; when that
happens we say why.

Open an issue before anything larger than a fix, so nobody spends a weekend
on something that will not land.

## Where help is wanted

- **The Marketplace**: the catalog of models people can download and run
  locally (`app/src/screens/MarketplaceScreen.tsx`, the catalog builder in
  `os-code/scripts/`, and `os-code/docs/MARKETPLACE.md`). New sources, better
  hardware fit, install flows that work on more machines.
- **Model servers and providers**: anything that speaks to a local model
  server, or a provider people bring their own key for.
- **OS Code, the terminal CLI, and the engine** (`os-code/`): `osc` commands,
  tools, the agent loop, and the checks that let a small local model do real
  work.

## The agreement

Before your first pull request can merge, you sign the OpenShore
Contributor License Agreement (`CLA.md`). The CLA check comments on your
pull request with the sentence to reply with; it takes a minute. You keep
the copyright in what you write; the CLA gives Open Shore LLC the license to
ship it, including under other terms later. Contributing for an employer?
Make sure you are allowed to.

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
pick a model. No account, no cloud key and no secrets are needed to build,
test, or chat; a build with no account backend configured stays open.

`ARCHITECTURE.md` maps the code in one page, and `docs/README.md` indexes
the feature docs.

## Before you open a pull request

```
pnpm --filter os-code build
pnpm -r format        # rewrites formatting for you
pnpm -r typecheck
pnpm -r test
```

What has to pass: the build, the typecheck, and the tests about behavior,
including the one you add for your change.

What you can leave red: the house-style checks. They hold the brand (no em
dashes, motion and spacing tokens, button and icon rules, contrast, exact
copy), and the maintainer fixes them when pulling your change in. They live
in these test files, so a failure in one of them is not on you:

- `app/test/em-dash-policy.test.ts`, `os-code/test/em-dash-policy.test.ts`
- `app/test/uiGuards*.test.ts`, `app/test/polish-standards.test.ts`,
  `app/test/*Polish*.test.ts`, `app/test/frontier-polish.test.ts`
- `app/test/motion*.test.ts`, `app/test/spacing-elevation.test.ts`,
  `app/test/contrast.test.ts`, `app/test/reviewStaffContrast.test.ts`
- `app/test/copy-glossary.test.ts`, `app/test/copyBlocks.test.ts`,
  `app/test/deviceNoun.test.ts`, `app/test/vaultCopy.test.ts`
- `os-code/test/progressShape.test.ts`
- lint warnings about style (`pnpm -r lint`)

Two rules are not style, and a change that breaks them will not land:

- **Nothing leaves the device unlisted.** A new network call gets an entry
  in `app/src/lib/egressManifest.ts` saying what it sends and when
  (`app/test/egressManifest.test.ts` fails on any unlisted host).
- **A project's own config can only make OpenShore stricter** until the
  person trusts that folder. A new config key is classified in
  `os-code/src/config/projectPolicy.ts` (`os-code/test/projectTrust.test.ts`).

`CLAUDE.md` holds the full set of standing rules, written for the coding
agents that work on this repository. You do not need to read it to
contribute.

## Pull requests

- One change per pull request, with a title that says what it does.
- Say what you changed and how you checked it.
- Add a test that shows the feature works, or that would have caught the
  bug.
- Do not commit secrets, keys, or model weights.

CI runs on your pull request with no secrets. A first-time contributor's run
waits for a maintainer to approve it, which is GitHub's default.

## Conduct

Everyone taking part follows the code of conduct (`CODE_OF_CONDUCT.md`).

## Security

Please do not open a public issue for a security problem. See
`SECURITY.md`.
