import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EcosystemFixtureManifestV1 } from "../../../src/evaluation/ecosystemFixtures/manifestTypes.js";
import { isSafeFixtureRelativePath, validateEcosystemFixtureManifest } from "../../../src/evaluation/ecosystemFixtures/validateManifest.js";

const FIXTURE_ROOT = "tests/fixtures/ecosystem/context-integrity/v0.4.5";
const CASES = [
  { fixtureDirectory: "failed-run", manifestPath: `${FIXTURE_ROOT}/manifests/failed-run-manifest.json` },
  { fixtureDirectory: "corrected-replay", manifestPath: `${FIXTURE_ROOT}/manifests/corrected-replay-manifest.json` }
] as const;

interface ManifestArtifactReference {
  manifest: EcosystemFixtureManifestV1;
  fixtureDirectory: string;
  repositoryRelativePath: string;
  artifact: EcosystemFixtureManifestV1["artifacts"][number];
}

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function runGitBuffer(args: string[]): Buffer {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: null, maxBuffer: 100 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString("utf8").trim()}`);
  }
  return result.stdout;
}

async function artifactReferences(): Promise<ManifestArtifactReference[]> {
  const references: ManifestArtifactReference[] = [];
  for (const fixtureCase of CASES) {
    const manifestValue: unknown = JSON.parse(await readFile(fixtureCase.manifestPath, "utf8"));
    const validation = validateEcosystemFixtureManifest(manifestValue);
    expect(validation.ok, `${fixtureCase.manifestPath} must remain a valid fixture manifest`).toBe(true);
    if (!validation.ok) continue;

    for (const artifact of validation.manifest.artifacts) {
      references.push({
        manifest: validation.manifest,
        fixtureDirectory: fixtureCase.fixtureDirectory,
        repositoryRelativePath: `${FIXTURE_ROOT}/${fixtureCase.fixtureDirectory}/${artifact.fixtureRelativePath}`,
        artifact
      });
    }
  }
  return references.sort((a, b) => a.repositoryRelativePath.localeCompare(b.repositoryRelativePath));
}

function attributesFor(repositoryRelativePath: string): Map<string, string> {
  const output = runGitBuffer(["check-attr", "-z", "text", "eol", "whitespace", "--", repositoryRelativePath]).toString("utf8");
  const fields = output.split("\0");
  const attributes = new Map<string, string>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    attributes.set(fields[index + 1], fields[index + 2]);
  }
  return attributes;
}

describe("v0.4.5 fixture checkout portability", () => {
  it("protects every safe manifest-referenced path from Git text and EOL conversion", async () => {
    const errors: string[] = [];
    const references = await artifactReferences();
    expect(references).toHaveLength(29);

    for (const reference of references) {
      const { artifact, repositoryRelativePath } = reference;
      if (!isSafeFixtureRelativePath(artifact.fixtureRelativePath)) {
        errors.push(`${repositoryRelativePath}: manifest path is unsafe`);
        continue;
      }

      const relativeToRoot = path.relative(path.resolve(FIXTURE_ROOT), path.resolve(repositoryRelativePath));
      if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
        errors.push(`${repositoryRelativePath}: resolved path escapes ${FIXTURE_ROOT}`);
        continue;
      }

      try {
        const file = await stat(repositoryRelativePath);
        if (!file.isFile()) errors.push(`${repositoryRelativePath}: referenced path is not a file`);
      } catch (error) {
        errors.push(`${repositoryRelativePath}: referenced file is unavailable (${(error as Error).message})`);
        continue;
      }

      const attributes = attributesFor(repositoryRelativePath);
      if (attributes.get("text") !== "unset") {
        errors.push(`${repositoryRelativePath}: expected Git attribute text=unset, received ${attributes.get("text") ?? "missing"}`);
      }
      if (attributes.get("eol") !== "unspecified") {
        errors.push(`${repositoryRelativePath}: expected no Git eol override, received ${attributes.get("eol") ?? "missing"}`);
      }
      if (attributes.get("whitespace") !== "cr-at-eol") {
        errors.push(`${repositoryRelativePath}: expected Git attribute whitespace=cr-at-eol, received ${attributes.get("whitespace") ?? "missing"}`);
      }
    }

    expect(errors).toEqual([]);
  });

  it("matches every working-tree and staged Git blob to its manifest hash", async () => {
    const errors: string[] = [];
    const references = await artifactReferences();

    for (const { artifact, repositoryRelativePath } of references) {
      const workingTreeSha256 = sha256(await readFile(repositoryRelativePath));
      const stagedBlobSha256 = sha256(runGitBuffer(["show", `:${repositoryRelativePath}`]));

      if (workingTreeSha256 !== artifact.copiedSha256) {
        errors.push(`${repositoryRelativePath}: working-tree SHA-256 ${workingTreeSha256} does not match manifest ${artifact.copiedSha256}`);
      }
      if (stagedBlobSha256 !== artifact.copiedSha256) {
        errors.push(`${repositoryRelativePath}: staged/committed blob SHA-256 ${stagedBlobSha256} does not match manifest ${artifact.copiedSha256}`);
      }
      if (artifact.byteExact && artifact.originalSha256 !== artifact.copiedSha256) {
        errors.push(`${repositoryRelativePath}: byte-exact provenance hash ${artifact.originalSha256} does not match copied hash ${artifact.copiedSha256}`);
      }
    }

    expect(errors).toEqual([]);
  });
});
