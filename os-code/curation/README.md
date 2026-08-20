# Curation inputs

These files are the editorial layer the catalog builder merges on top of the
seed (`catalog.sample.json`). They are the founder's, not the machine's. The
builder reads them; it never writes them. See `docs/MARKETPLACE.md` for the full
workflow.

- **`recommended.json`**: a map of modelId to
  `{ isRecommended, note?, rank?, licenseNote? }`. `isRecommended` sets the
  OpenShore pick ribbon. `note` is the recommendation, leading with the reason.
  `rank` overrides `curation.rank` for editorial order. `licenseNote` is the ONLY
  place a human license note may come from.
- **`benchmarks.json`**: a map of modelId to `{ benchmarkName: score }`, in
  native units (HumanEval 0..100, MT-Bench 0..10, MTEB around 0..75, and so on).
  The benchmark names match `src/router/roles.ts`. These drive the per-capability
  stars through the normalization table in `scripts/build-catalog/stars.ts`.
- **`eval.json`**: a map of modelId to the local eval average (0..1) from the
  harness. `osCodeFit` is `round(average * 5)`. A model needs an eval entry to
  earn a ratings block, and an orchestrator needs one to clear the curated gate.

A model whose license id is not on the allow-list in
`scripts/build-catalog/licenses.table.ts` is dropped fail-closed, no matter what
these files say.
