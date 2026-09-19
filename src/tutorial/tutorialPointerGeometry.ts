import type { TutorialFractionPointV1 } from "./types.js";

export type TutorialPointerBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TutorialPointerPoint = { x: number; y: number };

/** Converts a validated locator-relative fraction into page coordinates. */
export function resolveTutorialFractionPoint(
  box: TutorialPointerBox,
  point: TutorialFractionPointV1
): TutorialPointerPoint {
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) {
    throw new Error("Tutorial pointer bounding box values must all be finite.");
  }
  if (box.width <= 0 || box.height <= 0) {
    throw new Error("Tutorial pointer bounding box must have positive width and height.");
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    throw new Error("Tutorial pointer fractions must be finite numbers within inclusive bounds [0, 1].");
  }
  return {
    x: box.x + box.width * point.x,
    y: box.y + box.height * point.y
  };
}
