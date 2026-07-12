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

const CURRENT_V042_STATUS_LINE = "Status: **implementation complete, release-prepared (package metadata `0.4.2`), unreleased/not yet published**.";

function setPackageVersion(root: string, version: string) {
  const target = path.join(root, "package.json");
  const pkg = JSON.parse(fs.readFileSync(target, "utf8"));
  pkg.version = version;
  fs.writeFileSync(target, JSON.stringify(pkg, null, 2) + "\n");
}

function setV042StatusWording(root: string, newStatusText: string) {
  const target = path.join(root, "docs/ROADMAP.md");
  let body = fs.readFileSync(target, "utf8");
  if (!body.includes(CURRENT_V042_STATUS_LINE)) throw new Error("fixture assumption drifted: v0.4.2 status line not found");
  body = body.replace(CURRENT_V042_STATUS_LINE, `Status: **${newStatusText}**.`);
  // The manifest requires the literal word "unreleased" somewhere in ROADMAP.md regardless
  // of which specific negated phrase this test is exercising on the v0.4.2 Status line itself.
  if (!body.includes("unreleased")) body += "\n<!-- preserved status marker: unreleased -->\n";
  fs.writeFileSync(target, body);
}

function appendFabricatedVersionSection(root: string, version: string, statusLine: string | null) {
  const target = path.join(root, "docs/ROADMAP.md");
  const status = statusLine === null ? "" : `\n${statusLine}\n`;
  fs.appendFileSync(target, `\n### v${version} — fabricated test-only section\n${status}`);
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
    ["manual pentest reassignment", "docs/ROADMAP.md", "### v0.4.0 — Android validation MVP", "### v0.4.0 — manual pentest", "manual pentest placement"]
  ])("rejects %s", (_name, file, search, replacement, expected) => withDocs((root) => { const target = path.join(root, file); fs.writeFileSync(target, fs.readFileSync(target, "utf8").replace(search as string | RegExp, replacement)); }, (run) => expect(run).toThrow(expected as string)));

  it("rejects v1.0.0 moved before v0.9.2", () => withDocs((root) => { const target = path.join(root, "docs/ROADMAP.md"); let body = fs.readFileSync(target, "utf8"); const section = body.match(/### v1\.0\.0[\s\S]*?(?=### v1\.1\.0)/)?.[0] ?? ""; body = body.replace(section, "").replace("### v0.9.2", `${section}\n### v0.9.2`); fs.writeFileSync(target, body); }, (run) => expect(run).toThrow("semantic order")));

  it("allows legitimate wording changes that preserve structure", () => withDocs((root) => fs.appendFileSync(path.join(root, "README.md"), "\nAdditional explanatory wording.\n"), (run) => expect(run()).toContain("passed")));
});

describe("docs:check release-state validation (version-aware)", () => {
  it("accepts package.json version 0.4.1 matching its published roadmap section (last-published-version development state)", () =>
    withDocs((root) => setPackageVersion(root, "0.4.1"), (run) => expect(run()).toContain("passed")));

  it("accepts the real current release-prepared/unreleased v0.4.2 state unmodified", () =>
    withDocs(() => {}, (run) => expect(run()).toContain("passed")));

  it.each([
    "not yet published",
    "not published",
    "unpublished",
    "release-prepared and not yet published",
    "implementation complete but unpublished",
    "publication pending",
  ])("accepts negated publication wording for the current package version: %s", (phrase) =>
    withDocs((root) => setV042StatusWording(root, phrase), (run) => expect(run()).toContain("passed")));

  it("accepts a published status for the current package version when the whole document set is self-consistent (post-publication state)", () =>
    withDocs((root) => {
      setPackageVersion(root, "9.9.9");
      appendFabricatedVersionSection(root, "9.9.9", "Status: **published**.");
    }, (run) => expect(run()).toContain("passed")));

  it("rejects a positive publication claim elsewhere when the canonical roadmap status is unreleased", () =>
    withDocs((root) => {
      // Canonical docs/ROADMAP.md status for v0.4.2 remains unreleased (untouched); another
      // document contradicts it with an unnegated publication claim.
      fs.appendFileSync(path.join(root, "README.md"), "\nv0.4.2 has already been published to npm.\n");
    }, (run) => expect(run).toThrow("v0.4.2 release state")));

  it("accepts an accurate negated publication claim elsewhere that agrees with the canonical unreleased roadmap status", () =>
    withDocs((root) => {
      fs.appendFileSync(path.join(root, "README.md"), "\nFor the avoidance of doubt, v0.4.2 remains not yet published.\n");
    }, (run) => expect(run()).toContain("passed")));

  it("does not cross-contaminate adjacent version mentions in the same sentence (windowing regression)", () =>
    withDocs((root) => {
      // v0.4.0 and v0.4.1 are canonically published; v0.4.2 is canonically unreleased. A single
      // sentence mentioning all three, with the unreleased clause trailing last, must not cause
      // the earlier published versions to be misread as unreleased.
      fs.appendFileSync(path.join(root, "README.md"), "\nv0.4.0 delivered X; v0.4.1 delivered Y. v0.4.2 is release-prepared but not yet published.\n");
    }, (run) => expect(run()).toContain("passed")));

  it("rejects when the current package version has no matching roadmap section", () =>
    withDocs((root) => setPackageVersion(root, "9.9.9"), (run) => expect(run).toThrow("v9.9.9")));

  it("rejects when the matching roadmap section has no Status line", () =>
    withDocs((root) => {
      setPackageVersion(root, "9.9.9");
      appendFabricatedVersionSection(root, "9.9.9", null);
    }, (run) => expect(run).toThrow("Status")));

  it("rejects a future/planned status for the current package version", () =>
    withDocs((root) => {
      setPackageVersion(root, "9.9.9");
      appendFabricatedVersionSection(root, "9.9.9", "Status: **planned**.");
    }, (run) => expect(run).toThrow("release state")));

  it("rejects a deferred status for the current package version", () =>
    withDocs((root) => {
      setPackageVersion(root, "9.9.9");
      appendFabricatedVersionSection(root, "9.9.9", "Status: **deferred**.");
    }, (run) => expect(run).toThrow("release state")));

  it("rejects an invalid semantic package version", () =>
    withDocs((root) => setPackageVersion(root, "not-a-version"), (run) => expect(run).toThrow("semantic version")));

  it("ignores an unrelated future roadmap version's planned status when validating the real current package version", () =>
    withDocs((root) => appendFabricatedVersionSection(root, "9.9.9", "Status: **planned**."), (run) => expect(run()).toContain("passed")));
});
