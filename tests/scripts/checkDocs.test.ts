import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type DocumentationManifest = {
  requiredDocuments: string[];
  documents: Record<
    string,
    {
      requiredTopics?: string[];
    }
  >;
  roadmap: {
    requiredVersions: string[];
  };
  changelog: {
    requiredPublishedReleases: string[];
  };
  currentFacts: {
    latestPublishedVersion: string;
    nextPlannedVersion: string;
  };
};

type PackageMetadata = {
  version: string;
};

const manifest: DocumentationManifest = JSON.parse(fs.readFileSync("docs/documentation-preservation-manifest.json", "utf8"));
const packageMetadata: PackageMetadata = JSON.parse(fs.readFileSync("package.json", "utf8"));
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
// replaces only that section's single "Status:" line. Used generically by
// lifecycle-sensitive tests so they stay valid across future editorial
// wording changes and across real release-lifecycle transitions.
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

type DocumentationLifecycleFacts = {
  packageVersion: string;
  latestPublishedVersion: string;
  nextPlannedVersion: string;
  latestPublishedRoadmapVersion: string;
  nextPlannedRoadmapVersion: string;
  followingPlannedVersion: string;
  followingPlannedRoadmapVersion: string;
};

function deriveDocumentationLifecycleFacts(
  manifestValue: DocumentationManifest,
  packageValue: PackageMetadata,
): DocumentationLifecycleFacts {
  const semver = /^\d+\.\d+\.\d+$/;
  const packageVersion = packageValue.version;
  const latestPublishedVersion = manifestValue.currentFacts.latestPublishedVersion;
  const nextPlannedVersion = manifestValue.currentFacts.nextPlannedVersion;

  if (!semver.test(packageVersion)) {
    throw new Error("Documentation lifecycle package version is invalid.");
  }
  if (!semver.test(latestPublishedVersion)) {
    throw new Error("Documentation lifecycle latest published version is invalid.");
  }
  if (!semver.test(nextPlannedVersion)) {
    throw new Error("Documentation lifecycle next planned version is invalid.");
  }
  if (packageVersion !== latestPublishedVersion) {
    throw new Error("Package version must equal manifest latestPublishedVersion for documentation lifecycle tests.");
  }

  const latestPublishedRoadmapVersion = `v${latestPublishedVersion}`;
  const nextPlannedRoadmapVersion = `v${nextPlannedVersion}`;
  const requiredVersions = manifestValue.roadmap.requiredVersions;

  if (!requiredVersions.includes(latestPublishedRoadmapVersion)) {
    throw new Error("Roadmap must contain the latest published version.");
  }
  const nextPlannedIndex = requiredVersions.indexOf(nextPlannedRoadmapVersion);
  if (nextPlannedIndex === -1) {
    throw new Error("Roadmap must contain the next planned version.");
  }
  const followingPlannedRoadmapVersion = requiredVersions[nextPlannedIndex + 1];
  if (!followingPlannedRoadmapVersion) {
    throw new Error("Roadmap must contain a version after the next planned version.");
  }
  const followingPlannedVersion = followingPlannedRoadmapVersion.slice(1);

  return {
    packageVersion,
    latestPublishedVersion,
    nextPlannedVersion,
    latestPublishedRoadmapVersion,
    nextPlannedRoadmapVersion,
    followingPlannedVersion,
    followingPlannedRoadmapVersion,
  };
}

const lifecycle = deriveDocumentationLifecycleFacts(manifest, packageMetadata);

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
  it("LIFECYCLE-001 rejects changing the current published package version to planned", () => expectFailure(
    (root) => edit(root, "docs/ROADMAP.md", (body) => {
      const mutated = replaceRoadmapVersionStatus(body, lifecycle.latestPublishedRoadmapVersion, "Status: **planned**.");
      expect(mutated).not.toBe(body);
      return mutated;
    }),
    `current package v${lifecycle.packageVersion} lifecycle`,
  ));
  it("LIFECYCLE-002 rejects marking the manifest next planned version published", () => expectFailure(
    (root) => edit(root, "docs/ROADMAP.md", (body) => {
      const mutated = replaceRoadmapVersionStatus(body, lifecycle.nextPlannedRoadmapVersion, "Status: **published.**");
      expect(mutated).not.toBe(body);
      return mutated;
    }),
    `next planned v${lifecycle.nextPlannedVersion} lifecycle`,
  ));
  it("LIFECYCLE-003 rejects describing the latest published version as future", () => expectFailure(
    (root) => edit(root, "README.md", (body) => `${body}\nv${lifecycle.latestPublishedVersion} is not yet published.\n`),
    `v${lifecycle.latestPublishedVersion} publication claim`,
  ));
  it("LIFECYCLE-004 rejects a positive publication claim for the next planned version", () => expectFailure(
    (root) => edit(root, "README.md", (body) => `${body}\nv${lifecycle.nextPlannedVersion} is published.\n`),
    `v${lifecycle.nextPlannedVersion} publication claim`,
  ));
  it("LIFECYCLE-005 accepts negated publication wording for the next planned version", () => withDocs(
    (root) => edit(root, "README.md", (body) => `${body}\nv${lifecycle.nextPlannedVersion} is not published.\n`),
    (run) => expect(run()).toContain("passed"),
  ));
  it("LIFECYCLE-006 accepts release-neutral final wording", () => withDocs(
    (root) => edit(root, "README.md", (body) => `${body}\nThe documentation set is internally consistent.\n`),
    (run) => expect(run()).toContain("passed"),
  ));
});

describe("capability, family, and boundary preservation", () => {
  const currentStateVersionTopics = (manifest.documents["docs/CURRENT_STATE.md"]?.requiredTopics ?? []).filter(
    (topic) => /^v\d+\.\d+\.\d+$/.test(topic),
  );
  if (currentStateVersionTopics.length === 0) {
    throw new Error("docs/CURRENT_STATE.md requiredTopics must include at least one version topic.");
  }
  const currentStateVersionTopic = currentStateVersionTopics[currentStateVersionTopics.length - 1];

  it.each([
    ["Android unimplemented", "docs/COMMANDS.md", (body: string) => `${body}\nAndroid is not implemented.\n`, "Android implementation state"],
    ["android-compose current", "docs/COMMANDS.md", (body: string) => `${body}\nRun with --profile android-compose.\n`, "unsupported current surface android-compose"],
    ["security:pentest current", "docs/COMMANDS.md", (body: string) => `${body}\nRun npm run security:pentest.\n`, "unsupported current surface security:pentest"],
    ["README pillar", "README.md", (body: string) => body.replace(/experiment/gi, "study"), "preserved topic \"experiment\""],
    ["architecture subsystem", "docs/ARCHITECTURE.md", (body: string) => body.replace(/src\/mobile\/android/g, "mobile-subsystem"), "src/mobile/android"],
    ["command family", "docs/COMMANDS.md", (body: string) => body.replace(/experiment:list/g, "list-experiments"), "experiment:list"],
    ["workflow family", "docs/WORKFLOWS.md", (body: string) => body.replace(/## Fake-agent final demo/, "## Removed demo"), "Fake-agent final demo"],
    ["published changelog release", "CHANGELOG.md", (body: string) => body.replace(/^## \[0\.3\.4\][\s\S]*?(?=^## )/m, ""), "published release 0.3.4"],
    ["current/planned distinction", "docs/CURRENT_STATE.md", (body: string) => body.split(currentStateVersionTopic).join("next patch").replace(/not implemented/g, "later"), currentStateVersionTopic],
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

  it("DOCFIX-002 the next planned section is found even though its heading includes a title", () => {
    const mutated = replaceRoadmapVersionStatus(roadmapBody, lifecycle.nextPlannedRoadmapVersion, "Status: **docfix-002-marker**.");
    expect(mutated).toContain("Status: **docfix-002-marker**.");
    const escapedNextPlanned = lifecycle.nextPlannedRoadmapVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(mutated).toMatch(new RegExp(`^### ${escapedNextPlanned}\\b`, "m"));
  });

  it("DOCFIX-003 only the next planned Status line is replaced", () => {
    const mutated = replaceRoadmapVersionStatus(roadmapBody, lifecycle.nextPlannedRoadmapVersion, "Status: **docfix-003-marker**.");
    const originalLines = roadmapBody.split("\n");
    const mutatedLines = mutated.split("\n");
    expect(mutatedLines.length).toBe(originalLines.length);
    const differingLines = originalLines.filter((line, index) => line !== mutatedLines[index]);
    expect(differingLines).toHaveLength(1);
  });

  it("DOCFIX-004 the latest published section remains unchanged", () => {
    const mutated = replaceRoadmapVersionStatus(roadmapBody, lifecycle.nextPlannedRoadmapVersion, "Status: **docfix-004-marker**.");
    const extractSection = (body: string, version: string) => {
      const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const headingMatch = new RegExp(`^### ${escaped}\\b.*$`, "m").exec(body);
      if (!headingMatch) throw new Error(`section ${version} missing in test fixture`);
      const afterHeading = headingMatch.index + headingMatch[0].length;
      const nextHeadingMatch = /^(?:### |## )/m.exec(body.slice(afterHeading));
      const end = nextHeadingMatch ? afterHeading + nextHeadingMatch.index : body.length;
      return body.slice(headingMatch.index, end);
    };
    expect(extractSection(mutated, lifecycle.latestPublishedRoadmapVersion)).toBe(extractSection(roadmapBody, lifecycle.latestPublishedRoadmapVersion));
  });

  it("DOCFIX-005 content after the next planned section remains unchanged", () => {
    const mutated = replaceRoadmapVersionStatus(roadmapBody, lifecycle.nextPlannedRoadmapVersion, "Status: **docfix-005-marker**.");
    const escapedFollowing = lifecycle.followingPlannedRoadmapVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const followingHeadingPattern = new RegExp(`^### ${escapedFollowing}\\b.*$`, "m");
    const originalMatch = followingHeadingPattern.exec(roadmapBody);
    const mutatedMatch = followingHeadingPattern.exec(mutated);
    expect(originalMatch).not.toBeNull();
    expect(mutatedMatch).not.toBeNull();
    expect(roadmapBody.slice(originalMatch!.index)).toBe(mutated.slice(mutatedMatch!.index));
  });

  it("DOCFIX-006 the mutation produces different text", () => {
    const mutated = replaceRoadmapVersionStatus(roadmapBody, lifecycle.nextPlannedRoadmapVersion, "Status: **docfix-006-marker**.");
    expect(mutated).not.toBe(roadmapBody);
  });

  it("DOCFIX-007 a missing version section throws the exact helper error", () => {
    expect(() => replaceRoadmapVersionStatus(roadmapBody, "v9.9.9", "Status: **x**.")).toThrow(
      "Roadmap section v9.9.9 was not found."
    );
  });

  it("DOCFIX-008 a section with no Status line throws the exact helper error", () => {
    const body = "### v7.7.7 — test\n\nNo status line here.\n\n### v7.7.8\n\nStatus: **x**.\n";
    expect(() => replaceRoadmapVersionStatus(body, "v7.7.7", "Status: **y**.")).toThrow(
      "Roadmap section v7.7.7 must contain exactly one Status line."
    );
  });

  it("DOCFIX-009 a section with two Status lines throws the exact helper error", () => {
    const body = "### v7.7.7 — test\n\nStatus: **a**.\n\nStatus: **b**.\n\n### v7.7.8\n\nStatus: **x**.\n";
    expect(() => replaceRoadmapVersionStatus(body, "v7.7.7", "Status: **y**.")).toThrow(
      "Roadmap section v7.7.7 must contain exactly one Status line."
    );
  });

  it("DOCFIX-010 the false published next-planned state is rejected by check-docs", () => expectFailure(
    (root) => edit(root, "docs/ROADMAP.md", (body) => replaceRoadmapVersionStatus(body, lifecycle.nextPlannedRoadmapVersion, "Status: **published.**")),
    `next planned v${lifecycle.nextPlannedVersion} lifecycle`,
  ));

  it("DOCFIX-011 the obsolete complete planned-status literal is absent from the test source", () => {
    // Built at runtime (not as one literal) so this assertion's own search
    // argument does not itself reintroduce the obsolete text into the file.
    const obsoleteStatusLine = ["Status: **planned,", " unreleased, and not implemented**."].join("");
    const selfSource = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(selfSource).not.toContain(obsoleteStatusLine);
  });

  it("DOCFIX-012 the current complete valid next-planned status wording is not copied into the test", () => {
    const escapedNextPlanned = lifecycle.nextPlannedRoadmapVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sectionMatch = new RegExp(`^### ${escapedNextPlanned}\\b[\\s\\S]*?(?=^### |^## )`, "m").exec(roadmapBody);
    expect(sectionMatch).not.toBeNull();
    const currentStatusLine = sectionMatch![0].match(/^Status:.*$/m)?.[0];
    expect(currentStatusLine).toBeDefined();
    const selfSource = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(selfSource).not.toContain(currentStatusLine!);
  });
});

describe("documentation lifecycle transition derivation", () => {
  it("TRANSITION-001 current repository lifecycle facts derive successfully", () => {
    expect(lifecycle.packageVersion).toBe(manifest.currentFacts.latestPublishedVersion);
  });

  it("TRANSITION-002 a synthetic release transition derives the next lifecycle without changing test source", () => {
    const syntheticManifest: DocumentationManifest = {
      ...manifest,
      currentFacts: {
        ...manifest.currentFacts,
        latestPublishedVersion: lifecycle.nextPlannedVersion,
        nextPlannedVersion: lifecycle.followingPlannedVersion,
      },
    };
    const syntheticPackage: PackageMetadata = { version: lifecycle.nextPlannedVersion };
    const syntheticFacts = deriveDocumentationLifecycleFacts(syntheticManifest, syntheticPackage);

    expect(syntheticFacts.packageVersion).toBe(lifecycle.nextPlannedVersion);
    expect(syntheticFacts.latestPublishedVersion).toBe(lifecycle.nextPlannedVersion);
    expect(syntheticFacts.nextPlannedVersion).toBe(lifecycle.followingPlannedVersion);
  });

  it("TRANSITION-003 the synthetic transition chooses the version after the new next planned version from roadmap order", () => {
    const syntheticManifest: DocumentationManifest = {
      ...manifest,
      currentFacts: {
        ...manifest.currentFacts,
        latestPublishedVersion: lifecycle.nextPlannedVersion,
        nextPlannedVersion: lifecycle.followingPlannedVersion,
      },
    };
    const syntheticPackage: PackageMetadata = { version: lifecycle.nextPlannedVersion };
    const syntheticFacts = deriveDocumentationLifecycleFacts(syntheticManifest, syntheticPackage);

    const requiredVersions = manifest.roadmap.requiredVersions;
    const newNextPlannedIndex = requiredVersions.indexOf(syntheticFacts.nextPlannedRoadmapVersion);
    const expectedFollowing = requiredVersions[newNextPlannedIndex + 1];

    expect(syntheticFacts.followingPlannedRoadmapVersion).toBe(expectedFollowing);
  });

  it("TRANSITION-004 an invalid package/latest mismatch throws the exact setup error", () => {
    const mismatchedPackage: PackageMetadata = { version: lifecycle.nextPlannedVersion };
    expect(() => deriveDocumentationLifecycleFacts(manifest, mismatchedPackage)).toThrow(
      "Package version must equal manifest latestPublishedVersion for documentation lifecycle tests."
    );
  });

  it("TRANSITION-005 a missing next planned roadmap section throws the exact setup error", () => {
    const syntheticManifest: DocumentationManifest = {
      ...manifest,
      currentFacts: {
        ...manifest.currentFacts,
        nextPlannedVersion: "9.9.9",
      },
    };
    expect(() => deriveDocumentationLifecycleFacts(syntheticManifest, packageMetadata)).toThrow(
      "Roadmap must contain the next planned version."
    );
  });

  it("TRANSITION-006 a missing following version throws the exact setup error", () => {
    const requiredVersions = manifest.roadmap.requiredVersions;
    const lastRoadmapVersion = requiredVersions[requiredVersions.length - 1].slice(1);
    const syntheticManifest: DocumentationManifest = {
      ...manifest,
      currentFacts: {
        ...manifest.currentFacts,
        nextPlannedVersion: lastRoadmapVersion,
      },
    };
    expect(() => deriveDocumentationLifecycleFacts(syntheticManifest, packageMetadata)).toThrow(
      "Roadmap must contain a version after the next planned version."
    );
  });

  function extractDescribeBlock(source: string, describeName: string): string {
    const marker = `describe("${describeName}"`;
    const start = source.indexOf(marker);
    if (start === -1) {
      throw new Error(`describe block "${describeName}" not found in test source.`);
    }
    const nextDescribe = source.indexOf("\ndescribe(", start + marker.length);
    return nextDescribe === -1 ? source.slice(start) : source.slice(start, nextDescribe);
  }

  it("TRANSITION-007 lifecycle-sensitive tests do not hardcode active version values", () => {
    const selfSource = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
    const lifecycleSensitiveSource = [
      extractDescribeBlock(selfSource, "release and current/planned state"),
      extractDescribeBlock(selfSource, "replaceRoadmapVersionStatus helper"),
      extractDescribeBlock(selfSource, "documentation lifecycle transition derivation"),
    ].join("\n");

    const activeLifecycleLiterals = [
      lifecycle.latestPublishedVersion,
      lifecycle.nextPlannedVersion,
      lifecycle.latestPublishedRoadmapVersion,
      lifecycle.nextPlannedRoadmapVersion,
    ];

    for (const literal of activeLifecycleLiterals) {
      expect(lifecycleSensitiveSource).not.toContain(literal);
    }
  });
});
