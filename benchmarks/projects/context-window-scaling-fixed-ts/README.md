# context-window-scaling-fixed-ts

Static, committed benchmark project for the v0.7.0 context-window-scaling plugin. It is an ordinary
TypeScript tree, not a generator.

- `src/tasks/` and `tests/tasks/` hold the four small task-relevant implementation surfaces
  (shipping quote, invoice totals, inventory reservation, audit redaction).
- `src/filler/tier-1` ... `tier-4` hold scale-only catalog modules that are semantically unrelated to
  every task. Cases include filler tiers cumulatively through `rawIncludeGlobs`, so raw full-file
  context grows from scale A (tier-1) to scale D (tier-1..4).

Cases live in `benchmarks/contracts/context-window-scaling-cases.json`. Measured raw estimated-token
bands are enforced by `tests/benchmarks/contextWindowScalingCorpus.test.ts` using the production
raw-full-file baseline and `countEstimatedTokens`.
