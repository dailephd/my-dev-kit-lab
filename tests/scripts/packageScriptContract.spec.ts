import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  version: string;
  files: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8")) as {
  packages: { "": { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } };
};
const tutorialScenario = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "examples", "tutorial-browser", "scenario.json"), "utf8")
) as {
  schemaVersion: string;
  steps: Array<{ id: string; action?: { type: string; [key: string]: unknown } }>;
};

const testScriptNames = Object.keys(pkg.scripts).filter((name) => name.startsWith("test:"));

describe("package script contract: test vs verify", () => {
  it("defines a canonical full test script", () => {
    expect(pkg.scripts.test).toBe("vitest run");
  });

  it("defines a verify script", () => {
    expect(pkg.scripts.verify).toBeDefined();
  });

  it("does not invoke npm run test from verify", () => {
    expect(pkg.scripts.verify).not.toMatch(/npm run test(\s|$)/);
  });

  it("does not invoke bare npm test from verify", () => {
    expect(pkg.scripts.verify).not.toMatch(/(^|\s)npm test(\s|$)/);
  });

  it("does not invoke the bare vitest runner from verify", () => {
    expect(pkg.scripts.verify).not.toMatch(/vitest run(?!\s)/);
  });

  it("does not chain any focused test:* script into verify", () => {
    for (const name of testScriptNames) {
      expect(pkg.scripts.verify).not.toMatch(new RegExp(`npm run ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`));
    }
  });

  it("retains the non-test verification gates in verify", () => {
    expect(pkg.scripts.verify).toMatch(/npm run build/);
    expect(pkg.scripts.verify).toMatch(/npm run verify:benchmarks/);
  });
});

describe("installed tutorial package contract", () => {
  it("pins Playwright as the runtime dependency without browser packages or install hooks", () => {
    expect(pkg.dependencies?.playwright).toBe("1.60.0");
    expect(pkg.devDependencies?.playwright).toBeUndefined();
    expect(pkg.dependencies).not.toHaveProperty("@playwright/browser-chromium");
    expect(pkg.dependencies).not.toHaveProperty("@playwright/browser-firefox");
    expect(pkg.dependencies).not.toHaveProperty("@playwright/browser-webkit");
    expect(pkg).not.toHaveProperty("postinstall");
  });

  it("keeps the lockfile root classification and package version stable", () => {
    expect(lock.packages[""].dependencies?.playwright).toBe("1.60.0");
    expect(lock.packages[""].devDependencies?.playwright).toBeUndefined();
    expect(pkg.version).toBe("0.4.8");
  });

  it("ships only the canonical generic tutorial resources", () => {
    expect(pkg.files).toContain("examples/tutorial-browser/");
    expect(pkg.files).not.toContain("tests/");
    expect(pkg.files.some((entry) => entry.includes(".webm") || entry.includes("screenshots"))).toBe(false);
    expect(pkg.files.some((entry) => entry.includes("chromium") || entry.includes("browser-cache"))).toBe(false);
  });

  it("does not retain a static test fixture copy", () => {
    expect(fs.existsSync(path.join(repoRoot, "tests", "fixtures", "tutorial-browser", "index.html"))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, "tests", "fixtures", "tutorial-browser", "scenario.json"))).toBe(false);
    for (const file of ["index.html", "prepare.mjs", "server.mjs", "scenario.json"]) {
      expect(fs.existsSync(path.join(repoRoot, "examples", "tutorial-browser", file))).toBe(true);
    }
  });

  it("keeps the canonical packaged scenario on schema 1.0.0 with both drag families", () => {
    expect(tutorialScenario.schemaVersion).toBe("1.0.0");
    expect(tutorialScenario.steps).toHaveLength(9);
    expect(tutorialScenario.steps.map((step) => step.id)).toEqual([
      "open-app",
      "activate",
      "fill-name",
      "submit-name",
      "hover-button",
      "drag-card",
      "pointer-click-surface",
      "pointer-drag-surface",
      "wait-banner"
    ]);
    expect(tutorialScenario.steps.map((step) => step.action?.type)).toEqual([
      "goto",
      "click",
      "fill",
      "press",
      "hover",
      "drag",
      "pointer-click",
      "pointer-drag",
      "wait-for"
    ]);
    expect(tutorialScenario.steps.find((step) => step.id === "drag-card")?.action).toEqual({
      type: "drag",
      source: { kind: "test-id", testId: "drag-card" },
      target: { kind: "test-id", testId: "drop-zone" }
    });
  });
});
