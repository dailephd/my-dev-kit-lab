import { describe, expect, it } from "vitest";
import { resolveTutorialFractionPoint } from "../../src/tutorial/tutorialPointerGeometry.js";

const BOX = { x: 100, y: 50, width: 400, height: 200 };

describe("resolveTutorialFractionPoint", () => {
  it("resolves the top-left boundary", () => {
    expect(resolveTutorialFractionPoint(BOX, { x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
  });

  it("resolves the bottom-right boundary", () => {
    expect(resolveTutorialFractionPoint(BOX, { x: 1, y: 1 })).toEqual({ x: 500, y: 250 });
  });

  it("resolves a deterministic interior point", () => {
    expect(resolveTutorialFractionPoint(BOX, { x: 0.25, y: 0.5 })).toEqual({ x: 200, y: 150 });
  });

  it.each([
    [{ ...BOX, width: 0 }, "zero-width"],
    [{ ...BOX, height: 0 }, "zero-height"],
    [{ ...BOX, width: -1 }, "negative-width"]
  ])("rejects a %s box", (box) => {
    expect(() => resolveTutorialFractionPoint(box, { x: 0.5, y: 0.5 })).toThrow(/positive width and height/);
  });

  it.each([
    { ...BOX, x: Number.NaN },
    { ...BOX, y: Number.POSITIVE_INFINITY },
    { ...BOX, width: Number.NEGATIVE_INFINITY },
    { ...BOX, height: Number.NaN }
  ])("rejects non-finite box values", (box) => {
    expect(() => resolveTutorialFractionPoint(box, { x: 0.5, y: 0.5 })).toThrow(/finite/);
  });
});
