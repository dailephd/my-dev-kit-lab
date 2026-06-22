#!/usr/bin/env node
/**
 * Deterministic fake CLI for the security-validation adversarial harness.
 *
 * Simulates a "well-behaved" my-dev-kit-style CLI for CI tests that cannot
 * depend on a globally installed package.
 *
 * Supported flags:
 *   --root <dir>          Source root (treated as read-only; not validated for traversal)
 *   --out <dir>           Output directory for generated artifacts
 *   --index <dir>         Index artifact directory (also written with fake manifest)
 *   --file <path>         Path to read (simulates source retrieval)
 *   --path <path>         Graph path argument (logged only)
 *   --node <id>           Graph node argument (logged only)
 *   --query <q>           Search query (logged only)
 *   --format <f>          Output format: "json" | "text" (default: text)
 *   --emit-stderr <msg>   Write msg to stderr (simulates a warning)
 *   --escape-to <dir>     [HARNESS TESTING ONLY] Write an escape sentinel file here
 *                         Used to verify the harness can detect writes outside workspace.
 *   --fail                Exit with code 1 (simulates a CLI error)
 *
 * On success: writes a fake manifest.json to --out and/or --index, exits 0.
 * On --fail: emits an error message and exits 1.
 * Does NOT modify any files in --root.
 * Does NOT write anywhere other than --out and --index (unless --escape-to is set).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    root: null,
    out: null,
    index: null,
    file: null,
    path: null,
    node: null,
    query: null,
    format: "text",
    emitStderr: null,
    escapeTo: null,
    fail: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") result.root = args[++i];
    else if (a === "--out") result.out = args[++i];
    else if (a === "--index") result.index = args[++i];
    else if (a === "--file") result.file = args[++i];
    else if (a === "--path") result.path = args[++i];
    else if (a === "--node") result.node = args[++i];
    else if (a === "--query") result.query = args[++i];
    else if (a === "--format") result.format = args[++i];
    else if (a === "--emit-stderr") result.emitStderr = args[++i];
    else if (a === "--escape-to") result.escapeTo = args[++i];
    else if (a === "--fail") result.fail = true;
  }
  return result;
}

function fakeManifest(root) {
  return JSON.stringify(
    {
      schemaVersion: 1,
      version: "0.0.0-fake",
      generatedAt: new Date().toISOString(),
      root: root ?? "",
      files: [],
    },
    null,
    2
  );
}

function run() {
  const opts = parseArgs(process.argv);

  if (opts.emitStderr) {
    process.stderr.write(`[fake-cli] warning: ${opts.emitStderr}\n`);
  }

  if (opts.fail) {
    if (opts.format === "json") {
      process.stdout.write(
        JSON.stringify({ error: "fake-cli: --fail was requested" }) + "\n"
      );
    } else {
      process.stderr.write("fake-cli: --fail was requested\n");
    }
    process.exit(1);
  }

  const manifest = fakeManifest(opts.root);

  if (opts.out) {
    try {
      mkdirSync(opts.out, { recursive: true });
      writeFileSync(path.join(opts.out, "manifest.json"), manifest, "utf8");
    } catch (err) {
      process.stderr.write(`fake-cli: failed to write --out: ${err.message}\n`);
      process.exit(1);
    }
  }

  if (opts.index) {
    try {
      mkdirSync(opts.index, { recursive: true });
      writeFileSync(path.join(opts.index, "manifest.json"), manifest, "utf8");
    } catch (err) {
      process.stderr.write(`fake-cli: failed to write --index: ${err.message}\n`);
      process.exit(1);
    }
  }

  // FOR HARNESS TESTING ONLY: deliberately write outside declared paths.
  // This flag exists solely so the harness can verify its own detection logic.
  if (opts.escapeTo) {
    try {
      mkdirSync(opts.escapeTo, { recursive: true });
      writeFileSync(
        path.join(opts.escapeTo, "escape-sentinel.txt"),
        "harness-escape-detection-test\n",
        "utf8"
      );
    } catch (err) {
      process.stderr.write(`fake-cli: --escape-to failed: ${err.message}\n`);
    }
  }

  if (opts.format === "json") {
    process.stdout.write(
      JSON.stringify({
        status: "ok",
        root: opts.root,
        out: opts.out,
        index: opts.index,
      }) + "\n"
    );
  } else {
    if (opts.out || opts.index) {
      process.stdout.write("fake-cli: artifacts written\n");
    } else {
      process.stdout.write("fake-cli: ok (no output requested)\n");
    }
  }

  process.exit(0);
}

run();
