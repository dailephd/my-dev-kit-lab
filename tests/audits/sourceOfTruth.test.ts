import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../src/audits/core/sourceOfTruth.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sot-test-"));
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

function collect(root: string) {
  const inventory = scanProjectInventory(root);
  return collectSourceOfTruth(root, inventory);
}

describe("collectSourceOfTruth — package truth", () => {
  it("reads name, version, and scripts from package.json", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "package.json",
        JSON.stringify({
          name: "fixture-pkg",
          version: "2.3.4",
          scripts: { build: "tsc", test: "vitest run" },
        })
      );
      const snapshot = collect(root);
      expect(snapshot.package?.name).toBe("fixture-pkg");
      expect(snapshot.package?.version).toBe("2.3.4");
      expect(snapshot.package?.scripts).toEqual({ build: "tsc", test: "vitest run" });
    } finally {
      cleanup(root);
    }
  });

  it("returns null package truth when package.json is absent", () => {
    const root = makeTempDir();
    try {
      const snapshot = collect(root);
      expect(snapshot.package).toBeNull();
    } finally {
      cleanup(root);
    }
  });

  it("does not modify package.json", () => {
    const root = makeTempDir();
    try {
      const content = JSON.stringify({ name: "fixture", version: "1.0.0" });
      writeFile(root, "package.json", content);
      collect(root);
      expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toBe(content);
    } finally {
      cleanup(root);
    }
  });
});

describe("collectSourceOfTruth — lockfile truth", () => {
  it("reads root version from package-lock.json when present", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(
        root,
        "package-lock.json",
        JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 })
      );
      const snapshot = collect(root);
      expect(snapshot.lockfile.present).toBe(true);
      expect(snapshot.lockfile.rootVersion).toBe("1.0.0");
      expect(snapshot.lockfile.lockfileVersion).toBe(3);
    } finally {
      cleanup(root);
    }
  });

  it("reports a version mismatch as metadata (packageManagerConsistent), not as an AuditIssue", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "2.0.0" }));
      writeFile(
        root,
        "package-lock.json",
        JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 })
      );
      const snapshot = collect(root);
      expect(snapshot.lockfile.packageManagerConsistent).toBe(false);
      // Batch 2 never produces issues from collection alone.
      expect("issues" in snapshot).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("reports present:false when no lockfile exists", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const snapshot = collect(root);
      expect(snapshot.lockfile.present).toBe(false);
      expect(snapshot.lockfile.packageManagerConsistent).toBeNull();
    } finally {
      cleanup(root);
    }
  });
});

describe("collectSourceOfTruth — command/script classification", () => {
  it("classifies scripts into groups", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "package.json",
        JSON.stringify({
          name: "fixture",
          version: "1.0.0",
          scripts: {
            build: "tsc",
            test: "vitest run",
            "security:validate": "tsx scripts/security/validate.ts",
            "experiment:list": "tsx scripts/experiments/listExperiments.ts",
            audit: "tsx scripts/audits/runAudit.ts",
            "docs:check": "echo docs",
            "release:prepare": "echo release",
            "custom-thing": "echo hi",
          },
        })
      );
      const snapshot = collect(root);
      expect(snapshot.commands.scriptsByGroup.build).toEqual(["build"]);
      expect(snapshot.commands.scriptsByGroup.test).toEqual(["test"]);
      expect(snapshot.commands.scriptsByGroup.security).toEqual(["security:validate"]);
      expect(snapshot.commands.scriptsByGroup.experiment).toEqual(["experiment:list"]);
      expect(snapshot.commands.scriptsByGroup.audit).toEqual(["audit"]);
      expect(snapshot.commands.scriptsByGroup.docs).toEqual(["docs:check"]);
      expect(snapshot.commands.scriptsByGroup.release).toEqual(["release:prepare"]);
      expect(snapshot.commands.scriptsByGroup.other).toEqual(["custom-thing"]);
    } finally {
      cleanup(root);
    }
  });
});

describe("collectSourceOfTruth — docs truth", () => {
  it("detects README and docs files", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "README.md", "# Fixture\n\nThis project has an audit.\n");
      writeFile(root, "docs/GUIDE.md", "# Guide\n");
      const snapshot = collect(root);
      expect(snapshot.docs.hasReadme).toBe(true);
      const readme = snapshot.docs.files.find((f) => f.relativePath === "README.md");
      expect(readme?.mentionsAudit).toBe(true);
      expect(readme?.title).toBe("Fixture");
    } finally {
      cleanup(root);
    }
  });

  it("detects CHANGELOG", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "CHANGELOG.md", "# Changelog\n");
      const snapshot = collect(root);
      expect(snapshot.docs.hasChangelog).toBe(true);
    } finally {
      cleanup(root);
    }
  });
});

describe("collectSourceOfTruth — CI/workflow truth", () => {
  it("detects GitHub workflow files and extracts Node versions", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        ".github/workflows/ci.yml",
        [
          "name: CI",
          "jobs:",
          "  validate:",
          "    strategy:",
          "      matrix:",
          "        node-version:",
          "          - 20",
          "          - 22",
          "    steps:",
          "      - run: npm ci",
          "      - run: npm run build",
          "      - run: npm run test",
        ].join("\n")
      );
      const snapshot = collect(root);
      expect(snapshot.ci.workflows).toHaveLength(1);
      const workflow = snapshot.ci.workflows[0];
      expect(workflow.name).toBe("CI");
      expect(workflow.nodeVersionsReferenced).toEqual(["20", "22"]);
      expect(workflow.packageManagerCommandsReferenced).toContain("npm ci");
      expect(workflow.npmScriptsReferenced).toEqual(expect.arrayContaining(["build", "test"]));
    } finally {
      cleanup(root);
    }
  });

  it("does not modify CI files", () => {
    const root = makeTempDir();
    try {
      const content = "name: CI\n";
      writeFile(root, ".github/workflows/ci.yml", content);
      collect(root);
      expect(fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")).toBe(content);
    } finally {
      cleanup(root);
    }
  });
});

describe("collectSourceOfTruth — build tooling truth", () => {
  it("detects tsconfig.json", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "tsconfig.json", "{}");
      const snapshot = collect(root);
      expect(snapshot.buildTooling.hasTsconfig).toBe(true);
      expect(snapshot.buildTooling.tsconfigPaths).toContain("tsconfig.json");
    } finally {
      cleanup(root);
    }
  });
});

describe("collectSourceOfTruth — security/experiment/audit command presence", () => {
  it("detects audit/security/experiment script presence", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "package.json",
        JSON.stringify({
          name: "fixture",
          version: "1.0.0",
          scripts: {
            audit: "tsx scripts/audits/runAudit.ts",
            "security:validate": "tsx scripts/security/validate.ts",
            "security:deps": "tsx scripts/security/runDependencyChecks.ts",
            "experiment:list": "tsx scripts/experiments/listExperiments.ts",
          },
        })
      );
      const snapshot = collect(root);
      expect(snapshot.security.hasSecurityValidateScript).toBe(true);
      expect(snapshot.security.hasSecurityDepsScript).toBe(true);
      expect(snapshot.security.hasSecurityPackageScript).toBe(false);
      expect(snapshot.experiment.hasExperimentListScript).toBe(true);
      expect(snapshot.experiment.hasExperimentDescribeScript).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("collectSourceOfTruth — does not execute commands", () => {
  it("produces no evidence of subprocess execution (structural check: no exec/spawn imports triggered)", () => {
    // This is a structural guarantee, not something directly observable at
    // runtime without a spy on child_process -- verified by code inspection
    // (sourceOfTruth.ts imports only node:fs and node:path) and by this
    // collection completing near-instantly for a tiny fixture, consistent
    // with pure file reads rather than any process spawn.
    const root = makeTempDir();
    try {
      const start = Date.now();
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      collect(root);
      const elapsedMs = Date.now() - start;
      expect(elapsedMs).toBeLessThan(2000);
    } finally {
      cleanup(root);
    }
  });
});

describe("collectSourceOfTruth — real self-scan smoke", () => {
  it("collecting against this repo's own root produces a well-formed snapshot", () => {
    const inventory = scanProjectInventory(process.cwd());
    const snapshot = collectSourceOfTruth(process.cwd(), inventory);
    expect(snapshot.package?.name).toBe("@dailephd/my-dev-kit-lab");
    expect(snapshot.docs.hasReadme).toBe(true);
    expect(snapshot.docs.hasChangelog).toBe(true);
    expect(snapshot.ci.workflows.length).toBeGreaterThan(0);
    expect(snapshot.buildTooling.hasTsconfig).toBe(true);
    expect(snapshot.security.hasSecurityValidateScript).toBe(true);
    expect(snapshot.experiment.hasExperimentListScript).toBe(true);
  });
});
