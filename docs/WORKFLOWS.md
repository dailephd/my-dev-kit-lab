# Workflows

## Workflow 1: Benchmark Project Validation

Purpose:
- validate benchmark contracts
- validate benchmark project structure
- validate behavior parity across benchmark projects

Commands:
- `npm run test:benchmarks`
- `npm run verify:benchmarks`
- `npm run verify`
- `python -m unittest discover benchmarks/projects/todo-python/tests`

Expected outputs:
- passing benchmark contract checks
- passing benchmark structure checks
- passing parity checks for TypeScript, JavaScript, Python, and mixed boundary projects
- concise pass/fail output from the benchmark verification script

Current limitations:
- no screenshots
- no token/context comparison
- no provider telemetry
- no gallery workflow

Placeholders for later workflows:
- report and screenshot capture
- token-savings evaluation
- tutorial and gallery workflow
- provider telemetry
