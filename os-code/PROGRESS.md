# PROGRESS: moved to the repo root

The dedicated, product-wide OS Code progress log now lives at the **repo root**:
[`../PROGRESS.md`](../PROGRESS.md).

Now that this repo is a pnpm workspace (the `os-code/` engine plus the `app/`
React shells for iOS and the Linux desktop), the root file is the single source
of truth for "what happened most recently" across the whole product. It is kept
separate from the Uki app's `PROGRESS.md` so neither log gets overloaded with
the other's context.

Record all OS Code progress in `../PROGRESS.md`. This file is intentionally a
pointer only, so the two never drift.

Engine-specific design rationale still lives in
[`DECISIONS.md`](./DECISIONS.md).
