import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EcosystemFixtureManifestV1 } from "./manifestTypes.js";
import { isSafeFixtureRelativePath } from "./validateManifest.js";

export type FixtureHashIssueCode = "PATH_ESCAPES_FIXTURE_ROOT" | "MISSING_FILE" | "HASH_MISMATCH" | "UNREADABLE_FILE";

export interface FixtureHashIssue {
  code: FixtureHashIssueCode;
  fixtureRelativePath: string;
  message: string;
}

export interface FixtureHashVerificationResult {
  ok: boolean;
  checkedCount: number;
  issues: FixtureHashIssue[];
}

async function sha256OfFile(absolutePath: string): Promise<string> {
  const contents = await readFile(absolutePath);
  return createHash("sha256").update(contents).digest("hex");
}

// Section 21: reads the manifest, hashes each tracked fixture file, and reports missing
// files, hash mismatches, and path-traversal attempts with deterministic (manifest) order.
// Never rewrites the manifest or the fixture; a mismatch is reported, not repaired.
export async function verifyFixtureHashes(manifest: EcosystemFixtureManifestV1, fixtureRoot: string): Promise<FixtureHashVerificationResult> {
  const issues: FixtureHashIssue[] = [];
  let checkedCount = 0;

  for (const artifact of manifest.artifacts) {
    const relPath = artifact.fixtureRelativePath;
    if (!isSafeFixtureRelativePath(relPath)) {
      issues.push({ code: "PATH_ESCAPES_FIXTURE_ROOT", fixtureRelativePath: relPath, message: `Manifest entry references an unsafe path: "${relPath}".` });
      continue;
    }
    const absolutePath = path.resolve(fixtureRoot, relPath);
    let actualSha256: string;
    try {
      actualSha256 = await sha256OfFile(absolutePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      issues.push({
        code: code === "ENOENT" ? "MISSING_FILE" : "UNREADABLE_FILE",
        fixtureRelativePath: relPath,
        message: code === "ENOENT" ? `Fixture file is missing: "${relPath}".` : `Fixture file could not be read: "${relPath}" (${(error as Error).message}).`
      });
      continue;
    }
    checkedCount += 1;
    if (actualSha256 !== artifact.copiedSha256) {
      issues.push({
        code: "HASH_MISMATCH",
        fixtureRelativePath: relPath,
        message: `Fixture file "${relPath}" hash does not match the manifest's recorded copiedSha256 (expected ${artifact.copiedSha256}, got ${actualSha256}).`
      });
    }
  }

  return { ok: issues.length === 0, checkedCount, issues };
}
