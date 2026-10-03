import { describe, expect, it } from "vitest";
import { LocalSubjectExecutionError } from "../../../src/experiments/plugins/contextWindowScaling/localSubjectErrors.js";
import {
  GUIDED_EXCLUSION_MAX_CHARACTERS,
  GUIDED_EXCLUSION_MAX_ENTRIES,
  deriveGuidedIndexExclusions,
} from "../../../src/experiments/plugins/contextWindowScaling/localSubjectExclusions.js";

const derive = (eligibleFiles: string[], excludedFiles: string[]) => deriveGuidedIndexExclusions({ eligibleFiles, excludedFiles });

describe("RSP-005 guided exclusion derivation", () => {
  it("returns nothing when there is nothing to exclude", () => {
    expect(derive(["src/a.ts"], [])).toEqual([]);
  });

  it("collapses a directory that contains no eligible file and keeps individual files elsewhere", () => {
    const exclusions = derive(
      ["src/main.ts", "src/util/helper.ts"],
      ["src/gen/a.ts", "src/gen/deep/b.ts", "src/ignored.ts", "src/huge.ts"]
    );
    expect(exclusions).toEqual(["src/gen", "src/huge.ts", "src/ignored.ts"]);
  });

  it("never collapses a directory that still holds eligible files", () => {
    expect(derive(["src/keep/a.ts", "src/keep/nested/b.ts"], ["src/keep/secret.ts", "src/keep/nested/skip.ts"])).toEqual([
      "src/keep/nested/skip.ts",
      "src/keep/secret.ts",
    ]);
  });

  it("collapses an excluded sibling without touching an eligible directory of the same parent", () => {
    expect(derive(["src/keep/a.ts"], ["src/drop/x.ts", "src/drop/y/z.ts"])).toEqual(["src/drop"]);
  });

  it("drops entries covered by another entry and sorts by code unit", () => {
    expect(derive(["a/ok.ts"], ["a/z/1.ts", "a/z/2.ts", "a/Z/1.ts", "a/b.ts"])).toEqual(["a/Z", "a/b.ts", "a/z"]);
  });

  it("uses a single-segment directory name only when no eligible path shares that name", () => {
    expect(derive(["src/a.ts"], ["gen/t.ts"])).toEqual(["gen"]);
  });

  it("descends to a multi-segment path when a top-level directory name collides with an eligible name", () => {
    // my-dev-kit treats a bare "gen" as a name match at any depth, which would drop src/gen/ok.ts.
    expect(derive(["src/gen/ok.ts"], ["gen/deep/t.ts"])).toEqual(["gen/deep"]);
    expect(derive(["src/gen/ok.ts"], ["gen/t.ts"])).toEqual(["gen/t.ts"]);
  });

  it("fails closed for a top-level file whose name collides with an eligible name", () => {
    expect.assertions(2);
    try {
      derive(["keep/secret.ts"], ["secret.ts"]);
    } catch (error) {
      expect(error).toBeInstanceOf(LocalSubjectExecutionError);
      expect((error as LocalSubjectExecutionError).code).toBe("GUIDED_EXCLUSION_UNREPRESENTABLE");
    }
  });

  it("emits a bare top-level file name only when it is unambiguous", () => {
    expect(derive(["src/a.ts"], ["secret.env"])).toEqual(["secret.env"]);
  });

  it("never emits a bare name that equals an eligible name", () => {
    const eligible = ["src/a.ts", "src/b/c.ts", "lib/gen/d.ts"];
    const excluded = ["gen/x.ts", "b/y.ts", "src/gen/z.ts"];
    const exclusions = derive(eligible, excluded);
    const eligibleNames = new Set(eligible.flatMap((file) => file.split("/")));
    for (const entry of exclusions) {
      if (!entry.includes("/")) expect(eligibleNames.has(entry)).toBe(false);
    }
  });

  it("is deterministic for the same input in any order", () => {
    const forward = derive(["src/a.ts"], ["src/x/1.ts", "src/y.ts", "src/x/2.ts"]);
    const backward = derive(["src/a.ts"], ["src/x/2.ts", "src/y.ts", "src/x/1.ts"]);
    expect(backward).toEqual(forward);
  });

  it("fails closed above the entry cap instead of truncating", () => {
    const excluded = Array.from({ length: GUIDED_EXCLUSION_MAX_ENTRIES + 1 }, (_, index) => `src/f${String(index).padStart(4, "0")}.ts`);
    expect.assertions(3);
    try {
      derive(["src/keep.ts"], excluded);
    } catch (error) {
      expect(error).toBeInstanceOf(LocalSubjectExecutionError);
      expect((error as LocalSubjectExecutionError).code).toBe("GUIDED_EXCLUSION_LIMIT");
      expect((error as LocalSubjectExecutionError).message).toContain(`${GUIDED_EXCLUSION_MAX_ENTRIES + 1} entries`);
    }
  });

  it("fails closed above the character cap", () => {
    const long = "a".repeat(200);
    const excluded = Array.from({ length: Math.ceil(GUIDED_EXCLUSION_MAX_CHARACTERS / 200) + 5 }, (_, index) => `src/${long}${index}.ts`);
    expect(() => derive(["src/keep.ts"], excluded)).toThrow(LocalSubjectExecutionError);
  });
});
