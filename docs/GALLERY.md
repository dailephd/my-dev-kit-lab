# Gallery

The gallery manifest is a deterministic index of the artifacts produced by the Milestone 1 lab demo workflow.

Benchmark metadata and answer keys are now validated before the lab demo runs, but the gallery manifest format is unchanged in this prompt.

## What It Contains

`gallery-manifest.json` records:

- when the gallery was generated
- the output directory
- generated artifact paths
- summary metrics
- warnings

The required Prompt 4 item is `token-savings-demo`, which points to the token-savings summary, runs, HTML report, and optional PNG screenshot.

## Generated Artifacts

Running the lab demo writes:

- `token-savings-summary.json`
- `token-savings-runs.json`
- `token-savings-report.html`
- `token-savings-report.png` when screenshot capture succeeds
- `gallery-manifest.json`
- `commands/*` telemetry files from external my-dev-kit subprocess calls

## Regenerate The Demo Gallery

```bash
npm run lab-demo -- --cases examples/lab-demo-cases.json --kit-command "node tests/fixtures/fake-my-dev-kit-cli.js" --out lab-output/demo-gallery
```

## Interpret `token-savings-demo`

The gallery item summarizes static context comparison results:

- how many cases ran
- how many completed
- how many were skipped
- average raw full-file estimated tokens
- average my-dev-kit estimated tokens
- average tokens saved
- average percent saved
- token count method

Screenshots are tied directly to the generated HTML report. They are presentation output derived from evaluation artifacts, not the source of truth.

## Commit Policy

Commit source files, documentation, tests, and the `lab-output/.gitkeep` placeholder only.

Do not commit generated:

- lab output JSON
- HTML reports
- screenshots
- command telemetry logs

## Known Limitations

- token counts use `estimated_chars_div_4`
- provider telemetry does not exist yet
- the gallery currently covers the Milestone 1 token-savings demo only
- portfolio-specific templates are future work
