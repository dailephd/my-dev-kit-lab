import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(fs.readFileSync("docs/documentation-preservation-manifest.json", "utf8"));
const files = [...new Set([...(manifest.requiredDocuments as string[]), "docs/documentation-preservation-manifest.json", "package.json"])];

function withDocs(change: (root: string) => void, assertion: (run: () => string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-check-"));
  try {
    for (const file of files) {
      const destination = path.join(root, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.resolve(file), destination);
    }
    change(root);
    assertion(() => execFileSync(process.execPath, [path.resolve("scripts/check-docs.mjs")], {
      env: { ...process.env, DOCS_CHECK_ROOT: root }, encoding: "utf8", stdio: "pipe",
    }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function edit(root: string, file: string, transform: (body: string) => string) {
  const target = path.join(root, file);
  fs.writeFileSync(target, transform(fs.readFileSync(target, "utf8")));
}

function expectFailure(change: (root: string) => void, message: string) {
  withDocs(change, (run) => expect(run).toThrow(message));
}

describe("documentation structural preservation", () => {
  it("accepts the current comprehensive documentation", () => {
    expect(execFileSync(process.execPath, ["scripts/check-docs.mjs"], { encoding: "utf8" })).toContain("passed");
  });

  it.each(manifest.roadmap.requiredVersions as string[])("rejects removing roadmap version %s", (version) => {
    expectFailure((root) => edit(root, "docs/ROADMAP.md", (body) => {
      const escaped = version.replace(/\./g, "\\.");
      return body.replace(new RegExp(`^### ${escaped}[^\\n]*[\\s\\S]*?(?=^### |^## |\\z)`, "m"), "");
    }), `roadmap version ${version}`);
  });

  it.each([
    ["range substitution", (root: string) => edit(root, "docs/ROADMAP.md", (body) => body.replace("### v0.5.0", "### v0.5.x-v0.9.x\n\n### v0.5.0")), "version-range substitution"],
    ["semantic misordering", (root: string) => edit(root, "docs/ROADMAP.md", (body) => body.replace("### v0.5.0", "### TEMP").replace("### v0.5.1", "### v0.5.0").replace("### TEMP", "### v0.5.1")), "semantic order"],
    ["product direction", (root: string) => edit(root, "docs/ROADMAP.md", (body) => body.replace("## Product direction", "## Removed direction")), "Product direction"],
    ["roadmap acceptance", (root: string) => edit(root, "docs/ROADMAP.md", (body) => body.replace(/Acceptance:/g, "Completion checks:")), "Acceptance"],
    ["branch bookkeeping", (root: string) => edit(root, "docs/ROADMAP.md", (body) => `${body}\nCurrent branch: feature/drift\n`), "branch bookkeeping"],
    ["commit bookkeeping", (root: string) => edit(root, "docs/ROADMAP.md", (body) => `${body}\nCurrent commit: deadbeef\n`), "commit bookkeeping"],
    ["CI bookkeeping", (root: string) => edit(root, "docs/ROADMAP.md", (body) => `${body}\nCI run: #123\n`), "CI-run bookkeeping"],
  ])("rejects %s loss or role drift", (_name, change, message) => expectFailure(change as (root: string) => void, message as string));
});

describe("release and current/planned state", () => {
  it("rejects changing the published package version to planned", () => expectFailure(
    (root) => edit(root, "docs/ROADMAP.md", (body) => body.replace(/(### v0\.4\.2[^#]+?)Status: \*\*published\*\*; current npm baseline\./, "$1Status: **planned**.")),
    "current package v0.4.2 lifecycle",
  ));
  it("rejects marking v0.4.3 published", () => expectFailure(
    (root) => edit(root, "docs/ROADMAP.md", (body) => body.replace("Status: **planned, unreleased, and not implemented**.", "Status: **published**.")),
    "next planned v0.4.3 lifecycle",
  ));
  it("rejects describing v0.4.2 as future", () => expectFailure(
    (root) => edit(root, "README.md", (body) => `${body}\nv0.4.2 is not yet published.\n`), "v0.4.2 publication claim",
  ));
  it("rejects a positive publication claim for v0.4.3", () => expectFailure(
    (root) => edit(root, "README.md", (body) => `${body}\nv0.4.3 is published.\n`), "v0.4.3 publication claim",
  ));
  it("accepts negated publication wording for v0.4.3", () => withDocs(
    (root) => edit(root, "README.md", (body) => `${body}\nv0.4.3 is not published.\n`),
    (run) => expect(run()).toContain("passed"),
  ));
  it("accepts release-neutral final wording", () => withDocs(
    (root) => edit(root, "README.md", (body) => `${body}\nThe documentation set is internally consistent.\n`),
    (run) => expect(run()).toContain("passed"),
  ));
});

describe("capability, family, and boundary preservation", () => {
  it.each([
    ["Android unimplemented", "docs/COMMANDS.md", (body: string) => `${body}\nAndroid is not implemented.\n`, "Android implementation state"],
    ["android-compose current", "docs/COMMANDS.md", (body: string) => `${body}\nRun with --profile android-compose.\n`, "unsupported current surface android-compose"],
    ["security:pentest current", "docs/COMMANDS.md", (body: string) => `${body}\nRun npm run security:pentest.\n`, "unsupported current surface security:pentest"],
    ["README pillar", "README.md", (body: string) => body.replace(/experiment/gi, "study"), "preserved topic \"experiment\""],
    ["architecture subsystem", "docs/ARCHITECTURE.md", (body: string) => body.replace(/src\/mobile\/android/g, "mobile-subsystem"), "src/mobile/android"],
    ["command family", "docs/COMMANDS.md", (body: string) => body.replace(/experiment:list/g, "list-experiments"), "experiment:list"],
    ["workflow family", "docs/WORKFLOWS.md", (body: string) => body.replace(/## Fake-agent final demo/, "## Removed demo"), "Fake-agent final demo"],
    ["published changelog release", "CHANGELOG.md", (body: string) => body.replace(/^## \[0\.3\.4\][\s\S]*?(?=^## )/m, ""), "published release 0.3.4"],
    ["current/planned distinction", "docs/CURRENT_STATE.md", (body: string) => body.replace(/v0\.4\.3/g, "next patch").replace(/not implemented/g, "later"), "v0.4.3"],
  ])("rejects removing %s", (_name, file, transform, message) => expectFailure(
    (root) => edit(root, file as string, transform as (body: string) => string), message as string,
  ));

  it("allows legitimate wording additions with preserved meaning", () => withDocs(
    (root) => edit(root, "README.md", (body) => `${body}\nEvidence remains scoped to the selected target.\n`),
    (run) => expect(run()).toContain("passed"),
  ));
});
