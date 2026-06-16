# Publishing guide

This document describes what is safe to publish, what is intentionally excluded, how to validate before release, and how to create a release tag.

## What is safe to publish

The following are intentionally tracked and published:

- Source code (`src/`)
- Tests (`tests/`)
- Benchmark projects and contracts (`benchmarks/`)
- Example case files (`examples/`)
- Scripts (`scripts/`)
- Documentation (`docs/`, `README.md`, `CHANGELOG.md`)
- Configuration files (`package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`)
- GitHub metadata (`.github/FUNDING.yml`)

## What is intentionally excluded

The following are excluded via `.gitignore` and must not be committed:

| Category | Examples |
|---|---|
| Generated experiment artifacts | `lab-output/` (except `.gitkeep`) |
| Compiled output | `dist/`, `build/` |
| Test coverage | `coverage/` |
| Dependencies | `node_modules/` |
| Screenshots from local runs | `screenshots/` |
| Temporary files | `tmp/`, `temp/`, `artifacts/` |
| Environment and secrets | `.env`, `.env.*`, `*.key`, `*.pem`, `service-account*.json` |
| Editor/OS files | `.idea/`, `.vscode/`, `.DS_Store`, `Thumbs.db` |
| Logs and caches | `*.log`, `.cache/`, `__pycache__/` |

## How to validate before release

Run the full validation suite:

```bash
npm ci
npm run build
npm run test
npm run verify
```

Optionally run scoped test suites:

```bash
npm run test:benchmarks
npm run test:report
npm run test:experiments
npm run test:plots
npm run test:gallery
npm run test:integration
```

Check that no generated artifacts are staged:

```bash
git status --short
git diff --cached --name-only
```

## How to create a release tag

After all validation passes and the release branch is merged to `main`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Use semantic versioning (`vMAJOR.MINOR.PATCH`):

- Increment `PATCH` for documentation fixes and minor corrections
- Increment `MINOR` for new experiment types, new benchmark projects, or new pipeline stages
- Increment `MAJOR` for breaking changes to the experiment framework or artifact schema

## How to push to GitHub

```bash
# Verify remote
git remote -v

# Push branch
git push -u origin <branch>

# After merging to main
git push -u origin main

# Push tag
git push origin v0.1.0
```

## Release checklist

Before tagging a release, confirm:

- [ ] `.gitignore` excludes all generated/private artifacts
- [ ] No secrets or local absolute paths in tracked files
- [ ] `npm run build` passes
- [ ] `npm run test` passes
- [ ] `npm run verify` passes
- [ ] `git status` is clean
- [ ] `lab-output/` contents are not staged (except `.gitkeep`)
- [ ] README has current capabilities, quickstart, and support links
- [ ] CHANGELOG.md is updated
- [ ] GitHub remote URL is correct
