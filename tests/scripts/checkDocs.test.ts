import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const files = ["README.md", "CHANGELOG.md", "package.json", "docs/PROJECT_OVERVIEW.md", "docs/ARCHITECTURE.md", "docs/COMMANDS.md", "docs/WORKFLOWS.md", "docs/ROADMAP.md", "docs/CURRENT_STATE.md", "docs/security-validation-framework.md", "docs/documentation-preservation-manifest.json"];

function withDocs(change: (root: string) => void, assertion: (run: () => string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-check-"));
  try {
    for (const file of files) { const destination = path.join(root, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(path.resolve(file), destination); }
    change(root);
    assertion(() => execFileSync(process.execPath, [path.resolve("scripts/check-docs.mjs")], { env: { ...process.env, DOCS_CHECK_ROOT: root }, encoding: "utf8", stdio: "pipe" }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

describe("docs:check preservation manifest", () => {
  it("accepts the current comprehensive documentation", () => expect(execFileSync(process.execPath, ["scripts/check-docs.mjs"], { encoding: "utf8" })).toContain("passed"));

  it.each([
    ["roadmap version", "docs/ROADMAP.md", /### v0\.5\.1[^#]+/, "", "version v0.5.1"],
    ["version range", "docs/ROADMAP.md", /### v0\.5\.0/, "v0.5.x-v0.9.x\n\n### v0.5.0", "range substitution"],
    ["product direction", "docs/ROADMAP.md", "## Product direction", "## Removed direction", "section Product direction"],
    ["architecture direction", "docs/ROADMAP.md", "## Architecture direction", "## Removed architecture", "section Architecture direction"],
    ["README pillar", "README.md", /experiment/gi, "study", "topic experiment"],
    ["architecture audit subsystem", "docs/ARCHITECTURE.md", /audits/gi, "inspections", "topic audits"],
    ["experiment command", "docs/COMMANDS.md", /experiment:list/g, "list-experiments", "topic experiment:list"],
    ["CHANGELOG release", "CHANGELOG.md", /^## \[?v?0\.3\.4[^\n]*\n[\s\S]*?(?=^## |\z)/m, "", "released version 0.3.4"],
    ["manual pentest reassignment", "docs/ROADMAP.md", "### v0.4.0 — Android validation MVP", "### v0.4.0 — manual pentest", "manual pentest placement"],
    ["v0.4.2 premature publication", "docs/ROADMAP.md", "Status: **implemented on `feature/v0.4.2-android-audit-adapter` (Batches 1–3 complete), unreleased**.", "Status: **published**.", "v0.4.2 release state"]
  ])("rejects %s", (_name, file, search, replacement, expected) => withDocs((root) => { const target = path.join(root, file); fs.writeFileSync(target, fs.readFileSync(target, "utf8").replace(search as string | RegExp, replacement)); }, (run) => expect(run).toThrow(expected as string)));

  it("rejects v1.0.0 moved before v0.9.2", () => withDocs((root) => { const target = path.join(root, "docs/ROADMAP.md"); let body = fs.readFileSync(target, "utf8"); const section = body.match(/### v1\.0\.0[\s\S]*?(?=### v1\.1\.0)/)?.[0] ?? ""; body = body.replace(section, "").replace("### v0.9.2", `${section}\n### v0.9.2`); fs.writeFileSync(target, body); }, (run) => expect(run).toThrow("semantic order")));

  it("allows legitimate wording changes that preserve structure", () => withDocs((root) => fs.appendFileSync(path.join(root, "README.md"), "\nAdditional explanatory wording.\n"), (run) => expect(run()).toContain("passed")));
});
