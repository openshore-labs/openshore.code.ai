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
- **`eval.json`**: a map of modelId to an eval entry with provenance:
  `{ probe?, deep?, source, attempts?, box?, date? }`. `probe` is the one-shot
  probe average (0..1); `deep` is the agent-loop score from `osc eval --deep`
  (0..1), the number a card may quote. `source` is `published` for a seed
  number or `measured` for a run on a named box (`box`, for example
  `cpu-7.6gb`) on a `date`, with the best-of `attempts` used. `osCodeFit` is
  `round(score * 5)` over the probe, else the deep score. A model needs an eval
  entry to earn a ratings block, and an orchestrator needs one to clear the
  curated gate; a measured deep score satisfies it on its own. A bare number is
  read as a published probe (older files). Nothing is entered that was not
  published or measured: no number for a model nobody has run.

A model whose license id is not on the allow-list in
`scripts/build-catalog/licenses.table.ts` is dropped fail-closed, no matter what
these files say.
