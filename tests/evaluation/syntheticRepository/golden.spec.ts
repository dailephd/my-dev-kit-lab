import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { materializeSyntheticRepository, planSyntheticRepositoryCase } from "../../../src/evaluation/syntheticRepository/index.js";
import { makeTempRoot, readTree, removeTempRoot } from "./repositoryInspector.js";

/**
 * Cross-platform byte goldens. Generated text is UTF-8, LF, no BOM, so these values hold on Windows, Linux and
 * macOS regardless of git autocrlf. A change to any literal means rendered bytes (or the plan) changed.
 */
type Golden = {
  language: "typescript" | "python";
  generationIdentity: string;
  repositoryContentIdentity: string;
  files: Array<[string, number, string]>;
  aggregate: { fileCount: number; sourceFileCount: number; testFileCount: number; supportFileCount: number; totalBytes: number; totalChars: number; estimatedContentTokens: number };
};

const GOLDENS: Golden[] = [
  {
    language: "typescript",
    generationIdentity: "e445d9a9236d3ee311bfa0af2bcc17c71a385e15648409e11440000192daed01",
    repositoryContentIdentity: "55057dffe1189160228b2e4269463b696005d8f6a42cddeb438e2d91cef32740",
    files: [
      ["package.json", 143, "42c145991b8027ff293cfdf01d50d22ade78b357f64d8f692cd3e4f242964dc3"],
      ["src/group_001/mod_00001.ts", 706, "955a9f0cedade8aad2948e7bfe6fb43b71dd8826524e3c090dd59a2c94e951f3"],
      ["src/group_001/mod_00002.ts", 305, "3fe623d0b897a99cd9f89921aff3c5d6ef49a649e198ee0557f381144dee8b26"],
      ["src/group_001/mod_00003.ts", 403, "11bb43c707b28c0d91a5b8e2c2422fd429aa8315e16ffbb243d9d0b6c3edc2de"],
      ["src/group_001/mod_00004.ts", 371, "e15b3393035c4d21f434ed6faf75e92a5e083588bfee54ead699b3ed6a85c3c8"],
      ["tests/test_00001.test.ts", 234, "bd3d1023468e23be3e07ce5ace19daf757721258801d83e73d1f3c678c67eaa1"],
      ["tests/test_00002.test.ts", 234, "7b224742fc4390bfb54a2eb7ad8ac2b773c9e894c205b3809e4eac2a68ba2c76"],
      ["tsconfig.json", 213, "49110ba99d39b67277fa04b3ad6096dc4937a1639b8bfb42bf241268df398476"],
    ],
    aggregate: { fileCount: 8, sourceFileCount: 4, testFileCount: 2, supportFileCount: 2, totalBytes: 2609, totalChars: 2609, estimatedContentTokens: 653 },
  },
  {
    language: "python",
    generationIdentity: "b31470dccca892a6741dfa5056f488baf89d406346835560baa28c81c04186fb",
    repositoryContentIdentity: "0b5b3f2df8035a09bc08e65e4b7e67d4adf36891e07bb24d154575ea297e7b77",
    files: [
      ["pyproject.toml", 128, "1b4639327e79275ae0a20eea0953e0ee6b574908b6a1255701ad057d7d38d6fe"],
      ["src/group_001/mod_00001.py", 302, "11ddb161696b983eeb65b330543c1bfe9bcff750b7fd0fd0d5b10e7203a7f8e1"],
      ["src/group_001/mod_00002.py", 616, "1f827f10bf35e06e3532f553a7dbd46463d9a4be8957ca802e39399aaf7bef62"],
      ["src/group_001/mod_00003.py", 476, "ffd15f344950431abcde55107ecffbb127deb91224414269646394f1f0ca9f6e"],
      ["src/group_001/mod_00004.py", 364, "6e77c18aa0ff0664b928724c443e94cf6ec572d7e1b9e3b2b8f24f13d2ee6f7d"],
      ["tests/test_00001.py", 164, "ec599c8d08f5c18f2e7e335722da1947e37f402e9fcf22f70049c572e5c13bfa"],
      ["tests/test_00002.py", 110, "8dd5175d7b54a82327a3515960729ff41771a3195fe9227a82973c78d5f04c46"],
    ],
    aggregate: { fileCount: 7, sourceFileCount: 4, testFileCount: 2, supportFileCount: 1, totalBytes: 2160, totalChars: 2160, estimatedContentTokens: 540 },
  },
];

let root: string;
beforeEach(() => {
  root = makeTempRoot();
});
afterEach(() => {
  removeTempRoot(root);
});

describe("synthetic repository byte goldens", () => {
  for (const golden of GOLDENS) {
    it(`pins the ${golden.language} materialization`, () => {
      const plan = planSyntheticRepositoryCase({
        id: `golden-${golden.language}`,
        language: golden.language,
        seed: "golden",
        sourceFileCount: 4,
        moduleDepth: 2,
        internalImportCount: 3,
        symbolCount: 6,
        testFileCount: 2,
        taskLocality: "cross-module",
        repeatedPatternCount: 2,
      });
      const result = materializeSyntheticRepository(plan, root);
      expect(result.manifest.generationIdentity).toBe(golden.generationIdentity);
      expect(result.manifest.repositoryContentIdentity).toBe(golden.repositoryContentIdentity);
      expect(result.manifest.files.map((file) => [file.path, file.byteLength, file.sha256])).toEqual(golden.files);
      expect(result.manifest.aggregate).toEqual({ ...golden.aggregate, tokenCountMethod: "estimated_chars_div_4" });

      // Independent confirmation from the bytes on disk (not the manifest).
      const tree = readTree(result.repositoryRoot);
      expect(tree.map((file) => file.path)).toEqual(golden.files.map((file) => file[0]));
      for (const [index, file] of tree.entries()) {
        expect(createHash("sha256").update(Buffer.from(file.content, "utf8")).digest("hex")).toBe(golden.files[index][2]);
        expect(file.content).not.toContain("\r");
      }
      const identity = createHash("sha256")
        .update(
          JSON.stringify(
            tree.map((file, index) => ({ path: file.path, role: result.manifest.files[index].role, byteLength: golden.files[index][1], sha256: golden.files[index][2] }))
          )
        )
        .digest("hex");
      expect(identity).toBe(golden.repositoryContentIdentity);
      expect(tree.reduce((total, file) => total + file.content.length, 0)).toBe(golden.aggregate.totalChars);
    });
  }
});
