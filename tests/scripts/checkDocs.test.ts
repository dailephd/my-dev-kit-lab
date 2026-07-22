import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

// Locates a "### <version> [optional title]" roadmap section structurally
// (by heading ownership, not by snapshotting the section's prose) and
// replaces only that section's single "Status:" line. Used to keep the
// v0.4.3-published rejection test valid across future editorial wording
// changes to the legitimate unreleased status sentence.
function replaceRoadmapVersionStatus(body: string, version: string, replacementStatusLine: string): string {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`^### ${escapedVersion}\\b.*$`, "m");
  const headingMatch = headingPattern.exec(body);
  if (!headingMatch) {
    throw new Error(`Roadmap section ${version} was not found.`);
  }

  const sectionStart = headingMatch.index;
  const afterHeadingIndex = sectionStart + headingMatch[0].length;
  const remainder = body.slice(afterHeadingIndex);
  const nextHeadingMatch = /^(?:### |## )/m.exec(remainder);
  const sectionEnd = nextHeadingMatch ? afterHeadingIndex + nextHeadingMatch.index : body.length;
  const section = body.slice(sectionStart, sectionEnd);

  const statusLineMatches = section.match(/^Status:.*$/gm) ?? [];
  if (statusLineMatches.length !== 1) {
    throw new Error(`Roadmap section ${version} must contain exactly one Status line.`);
  }

  const originalStatusLine = statusLineMatches[0];
  const statusIndexInSection = section.indexOf(originalStatusLine);
  const newSection =
    section.slice(0, statusIndexInSection) +
    replacementStatusLine +
    section.slice(statusIndexInSection + originalStatusLine.length);

  return body.slice(0, sectionStart) + newSection + body.slice(sectionEnd);
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
    (root) => edit(root, "docs/ROADMAP.md", (body) => {
      const mutated = replaceRoadmapVersionStatus(body, "v0.4.3", "Status: **published.**");
      expect(mutated).not.toBe(body);
      return mutated;
    }),
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

describe("replaceRoadmapVersionStatus helper", () => {
  const roadmapBody = fs.readFileSync("docs/ROADMAP.md", "utf8");

  it("DOCFIX-001 the current documentation passes", () => {
    expect(execFileSync(process.execPath, ["scripts/check-docs.mjs"], { encoding: "utf8" })).toContain("passed");
  });

  it("DOCFIX-002 the v0.4.3 section is found even though its heading includes a title", () => {
    const mutated = replaceRoadmapVersionStatus(roadmapBody, "v0.4.3", "Status: **docfix-002-marker**.");
    expect(mutated).toContain("Status: **docfix-002-marker**.");
    expect(mutated).toContain("### v0.4.3 — stage-specific bounded-context and workflow-instruction evaluation");
  });

  it("DOCFIX-003 only the v0.4.3 Status line is replaced", () => {
    const mutated = replaceRoadmapVersionStatus(roadmapBody, "v0.4.3", "Status: **docfix-003-marker**.");
    const originalLines = roadmapBody.split("\n");
    const mutatedLines = mutated.split("\n");
    expect(mutatedLines.length).toBe(originalLines.length);
    const differingLines = originalLines.filter((line, index) => line !== mutatedLines[index]);
    expect(differingLines).toHaveLength(1);
  });

  it("DOCFIX-004 the v0.4.2 section remains unchanged", () => {
    const mutated = replaceRoadmapVersionStatus(roadmapBody, "v0.4.3", "Status: **docfix-004-marker**.");
    const extractSection = (body: string, version: string) => {
      const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const headingMatch = new RegExp(`^### ${escaped}\\b.*$`, "m").exec(body);
      if (!headingMatch) throw new Error(`section ${version} missing in test fixture`);
      const afterHeading = headingMatch.index + headingMatch[0].length;
      const nextHeadingMatch = /^(?:### |## )/m.exec(body.slice(afterHeading));
      const end = nextHeadingMatch ? afterHeading + nextHeadingMatch.index : body.length;
      return body.slice(headingMatch.index, end);
    };
    expect(extractSection(mutated, "v0.4.2")).toBe(extractSection(roadmapBody, "v0.4.2"));
  });

  it("DOCFIX-005 content after the v0.4.3 section remains unchanged", () => {
    const mutated = replaceRoadmapVersionStatus(roadmapBody, "v0.4.3", "Status: **docfix-005-marker**.");
    const nextHeadingIndexOriginal = roadmapBody.indexOf("### v0.5.0");
    const nextHeadingIndexMutated = mutated.indexOf("### v0.5.0");
    expect(nextHeadingIndexOriginal).toBeGreaterThan(0);
    expect(roadmapBody.slice(nextHeadingIndexOriginal)).toBe(mutated.slice(nextHeadingIndexMutated));
  });

  it("DOCFIX-006 the mutation produces different text", () => {
    const mutated = replaceRoadmapVersionStatus(roadmapBody, "v0.4.3", "Status: **docfix-006-marker**.");
    expect(mutated).not.toBe(roadmapBody);
  });

  it("DOCFIX-007 a missing version section throws the exact helper error", () => {
    expect(() => replaceRoadmapVersionStatus(roadmapBody, "v9.9.9", "Status: **x**.")).toThrow(
      "Roadmap section v9.9.9 was not found."
    );
  });

  it("DOCFIX-008 a section with no Status line throws the exact helper error", () => {
    const body = "### v0.4.3 — test\n\nNo status line here.\n\n### v0.5.0\n\nStatus: **x**.\n";
    expect(() => replaceRoadmapVersionStatus(body, "v0.4.3", "Status: **y**.")).toThrow(
      "Roadmap section v0.4.3 must contain exactly one Status line."
    );
  });

  it("DOCFIX-009 a section with two Status lines throws the exact helper error", () => {
    const body = "### v0.4.3 — test\n\nStatus: **a**.\n\nStatus: **b**.\n\n### v0.5.0\n\nStatus: **x**.\n";
    expect(() => replaceRoadmapVersionStatus(body, "v0.4.3", "Status: **y**.")).toThrow(
      "Roadmap section v0.4.3 must contain exactly one Status line."
    );
  });

  it("DOCFIX-010 the false published v0.4.3 state is rejected by check-docs", () => expectFailure(
    (root) => edit(root, "docs/ROADMAP.md", (body) => replaceRoadmapVersionStatus(body, "v0.4.3", "Status: **published.**")),
    "next planned v0.4.3 lifecycle",
  ));

  it("DOCFIX-011 the obsolete complete planned-status literal is absent from the test source", () => {
    // Built at runtime (not as one literal) so this assertion's own search
    // argument does not itself reintroduce the obsolete text into the file.
    const obsoleteStatusLine = ["Status: **planned,", " unreleased, and not implemented**."].join("");
    const selfSource = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(selfSource).not.toContain(obsoleteStatusLine);
  });

  it("DOCFIX-012 the current complete valid v0.4.3 status wording is not copied into the test", () => {
    const v043SectionMatch = /^### v0\.4\.3\b[\s\S]*?(?=^### |^## )/m.exec(roadmapBody);
    expect(v043SectionMatch).not.toBeNull();
    const currentStatusLine = v043SectionMatch![0].match(/^Status:.*$/m)?.[0];
    expect(currentStatusLine).toBeDefined();
    const selfSource = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(selfSource).not.toContain(currentStatusLine!);
  });
});
