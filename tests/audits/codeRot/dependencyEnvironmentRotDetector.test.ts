import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { DEPENDENCY_ENVIRONMENT_ROT_DETECTOR } from "../../../src/audits/codeRot/detectors/dependencyEnvironmentRotDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dep-env-rot-test-"));
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

function writeFile(root: string, relativePath: string, content = ""): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function buildContext(root: string): AuditDetectorContext {
  const inventory = scanProjectInventory(root);
  const sourceOfTruth = collectSourceOfTruth(root, inventory);
  const target = resolveAuditTarget(undefined, root);
  const config = normalizeAuditConfig({ include: "docs,tests,package,architecture,cli" }, root);
  return { target, config, inventory, sourceOfTruth };
}

async function run(root: string) {
  const ctx = buildContext(root);
  return DEPENDENCY_ENVIRONMENT_ROT_DETECTOR.run(ctx);
}

describe("DEPENDENCY_ENVIRONMENT_ROT_DETECTOR — package manager mismatch", () => {
  it("flags docs instructing pnpm install with an npm lockfile present and no npm mention nearby", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "package-lock.json", JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }));
      writeFile(root, "README.md", "Run `pnpm install` to set up dependencies.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.toLowerCase().includes("pnpm install"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag when npm install is mentioned nearby", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "package-lock.json", JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }));
      writeFile(root, "README.md", "Run `npm install` to set up dependencies.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.toLowerCase().includes("pnpm"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEPENDENCY_ENVIRONMENT_ROT_DETECTOR — Node engine/CI mismatch", () => {
  it("flags a CI Node version below package.json's engines.node minimum", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {}, engines: { node: ">=20" } }));
      writeFile(root, ".github/workflows/ci.yml", "name: CI\njobs:\n  test:\n    steps:\n      - node-version: 16\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("below package.json's engines.node minimum"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a CI Node version at or above the minimum", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {}, engines: { node: ">=20" } }));
      writeFile(root, ".github/workflows/ci.yml", "name: CI\njobs:\n  test:\n    steps:\n      - node-version: 22\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("below package.json's engines.node minimum"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEPENDENCY_ENVIRONMENT_ROT_DETECTOR — undocumented optional tools", () => {
  it("flags a script invoking an optional tool not mentioned in docs", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { "security:semgrep": "semgrep scan" } }));
      writeFile(root, "README.md", "This project has a security workflow.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("semgrep"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a script invoking a tool that is documented", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { "security:semgrep": "semgrep scan" } }));
      writeFile(root, "README.md", "Runs semgrep as an optional static-analysis step.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("semgrep"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEPENDENCY_ENVIRONMENT_ROT_DETECTOR — local-only guarantee", () => {
  it("source does not import child_process or call any subprocess-execution helper", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/audits/codeRot/detectors/dependencyEnvironmentRotDetector.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/child_process|execSync\(|execFileSync\(|spawnSync\(|\bspawn\(/);
  });
});

describe("DEPENDENCY_ENVIRONMENT_ROT_DETECTOR — real self-scan regression guard", () => {
  it("produces no findings against this repo's own current package/CI/docs state", async () => {
    const issues = await run(process.cwd());
    expect(issues).toEqual([]);
  });
});
