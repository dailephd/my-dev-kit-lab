# Benchmark Projects

This directory contains deterministic benchmark projects used by my-dev-kit-lab.

Each project implements the same Todo Core behavior in a different language layout:

- `todo-ts`
- `todo-js`
- `todo-python`
- `todo-mixed-ts-py`

These projects are intentionally small so future prompts can compare raw full-file context, my-dev-kit retrieval output, screenshots, and workflow evidence against a stable baseline.

Benchmark project profiles live in `benchmarks/contracts/benchmark-project-profiles.json`.

Each profile records:

- project identity and description
- language mix and primary language
- source roots and test roots
- deterministic file-tree metadata
- complexity metrics and complexity score
- benchmark purpose and expected use cases

Current complexity levels:

- `todo-ts`: small
- `todo-js`: small
- `todo-python`: small
- `todo-mixed-ts-py`: mixed-language

The current projects are not intended to be large. They are deliberately small so benchmark validation, token-savings evaluation, and future prompt or agent experiments stay deterministic and cheap. Larger benchmark projects can be added later as separate profiles without changing the current evaluator.
