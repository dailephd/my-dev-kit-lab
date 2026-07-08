import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { ARCHITECTURE_DRIFT_DETECTOR } from "../../../src/audits/codeRot/detectors/architectureDriftDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "arch-drift-test-"));
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
  return ARCHITECTURE_DRIFT_DETECTOR.run(ctx);
}

describe("ARCHITECTURE_DRIFT_DETECTOR — claimed paths that don't exist", () => {
  it("flags a backtick path in CURRENT_STATE.md that does not exist", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "docs/CURRENT_STATE.md", "This is the concise source of truth. See `src/nonexistent/module.ts` for details.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("claims path") && i.title.includes("src/nonexistent/module.ts"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a backtick path that exists", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/real/module.ts", "export {};\n");
      writeFile(root, "docs/CURRENT_STATE.md", "This is the concise source of truth. See `src/real/module.ts` for details.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("claims path"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("demotes a historically-framed missing path to low severity", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "docs/ARCHITECTURE.md", "Historically, `src/old/module.ts` used to handle this before it was removed.\n");
      const issues = await run(root);
      const issue = issues.find((i) => i.title.includes("stale") && i.title.includes("src/old/module.ts"));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("low");
    } finally {
      cleanup(root);
    }
  });
});

describe("ARCHITECTURE_DRIFT_DETECTOR — audit framework described as planned but implemented", () => {
  it("flags CURRENT_STATE.md describing the audit framework as planned when src/audits and an audit script exist", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { audit: "tsx scripts/audit.ts" } }));
      writeFile(root, "src/audits/core/placeholder.ts", "export {};\n");
      writeFile(
        root,
        "docs/CURRENT_STATE.md",
        "This is the concise source of truth.\n\nThe following are planned, not implemented:\n\n- generic audit framework and code rot detector\n"
      );
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("audit framework"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag when the audit framework is not actually implemented", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "docs/CURRENT_STATE.md",
        "This is the concise source of truth.\n\nThe following are planned, not implemented:\n\n- generic audit framework and code rot detector\n"
      );
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("audit framework"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("ARCHITECTURE_DRIFT_DETECTOR — major dirs absent from ARCHITECTURE.md", () => {
  it("flags a major src/ directory (3+ files) not mentioned in ARCHITECTURE.md", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/widgets/a.ts", "export {};\n");
      writeFile(root, "src/widgets/b.ts", "export {};\n");
      writeFile(root, "src/widgets/c.ts", "export {};\n");
      writeFile(root, "docs/ARCHITECTURE.md", "## Current implemented architecture\n\nThis project has a core module.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('"src/widgets"'))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a small src/ directory (fewer than 3 files)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/tiny/a.ts", "export {};\n");
      writeFile(root, "docs/ARCHITECTURE.md", "## Current implemented architecture\n\nThis project has a core module.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('"src/tiny"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("ARCHITECTURE_DRIFT_DETECTOR — unsupported current claims", () => {
  it("flags an unhedged 'manual pentest is implemented' claim", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "docs/SOMETHING.md", "The manual pentest is implemented and ready to use.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("manual pentest"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a hedged/planned manual pentest mention", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "docs/SOMETHING.md", "A manual pentest framework is planned for a future version.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("manual pentest"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("ARCHITECTURE_DRIFT_DETECTOR — Android/mobile regex grouping guard", () => {
  it("does not flag a bare 'Android validation' mention with no implementation claim (regression guard for the alternation-grouping bug)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "docs/SOMETHING.md", "Android validation profiles are planned for a future release.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("Android"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("ARCHITECTURE_DRIFT_DETECTOR — real self-scan regression guard", () => {
  it("does not flag any unsupported manual-pentest/Android current claim against this repo's own current docs", async () => {
    const issues = await run(process.cwd());
    expect(issues.some((i) => i.category === "architecture-drift" && (i.title.includes("manual pentest") || i.title.includes("Android")))).toBe(
      false
    );
  });
});
