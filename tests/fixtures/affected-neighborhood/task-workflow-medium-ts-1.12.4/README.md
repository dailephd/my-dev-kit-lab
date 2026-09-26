Real `@dailephd/my-dev-kit@1.12.4` `index --call-graph` output (symbol-index.json, code-graph.json)
for `benchmarks/projects/task-workflow-medium-ts` (sourceRoots `src`, `tests`). Only `repoRoot` in the
symbol index was scrubbed of a machine path. Used by `tests/evaluation/affectedNeighborhood.test.ts`
to check task mapping against the real warm-index benchmark corpus without running my-dev-kit.
