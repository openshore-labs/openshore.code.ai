# Release tiers

Founder, 2026-09-27: "Let's pull crew and terminal into standard v1. V2 will be
currents, stack health, and launch. V3 marketplace. And v4 is the enterprise
track with admin configuration and project permissions, etc. the company
collaboration features. Let's just build personal for now and get that working
fully."

## The tiers

| Tier | Name | What it carries |
| --- | --- | --- |
| v1 | Personal | One person, their desktop and their own phone. Chats, Projects, Terminal, Repositories, Stack, Vault, Crew (routines), Cloud Connections, Pairing, the Marketplace (catalog browsing and downloads; v1 since 2026-10-11), and Settings. |
| v2 | Currents | Agentic Currents and Harness Currents, Stack Health, Launch with Codemagic. |
| v3 | Reserved | Nothing today. The Marketplace moved to v1 on 2026-10-11; its community reviews stay off until a migration grants review writes back. |
| v4 | Enterprise | Admin configuration, teams (shared projects, the team vault, project permissions), seats, and shared-hub members. |

Each tier carries every tier before it.

Founder, 2026-10-11: the Marketplace comes back into the Personal build so the
open-source community can help build it. It is a plain v1 room now (no
`FEATURE_TIER` entry, no `SHIPS_` gate). Its reviews stay shut
(`REVIEWS_OPEN` in `app/src/lib/reviews.ts`): production's 0027 revoked review
writes, so posting or reporting cannot work until a migration grants them back.

## How a build picks its tier

One gate, `app/src/lib/focus.ts`. A build is Personal (v1) unless
`VITE_RELEASE_TIER` is set to `2`, `3` or `4`. Nothing in `release.yml`,
`codemagic.yaml` or an `.env` file sets it, so every shipped build is Personal
today. The later tiers' code stays in the tree; the gate shuts their doors (the
Sidebar, navigation, links, settings rows) and keeps their launch-time work from
running. `app/test/focus.test.ts` pins both: what a Personal build shows, and
that no later-tier surface has a door in it.

The test suite runs at tier 4 (`vite.config.ts`, `test.env`), so every tier's
code stays tested while only v1 ships.

## Rules for new work

- A new feature names its tier in `FEATURE_TIER` before it has a door.
- A v1 room never depends on a later-tier feature to work.
- Unlocking a tier for release is a founder call, recorded in
  `os-code/DECISIONS.md`.
