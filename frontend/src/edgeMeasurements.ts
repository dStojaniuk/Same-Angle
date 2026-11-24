import type { Point } from "./outline";

type Edge = [Point, Point];
export type EdgeTrace = { edge: Edge; checkpoint: Point };
export type EdgePair = { original: EdgeTrace; edited: EdgeTrace };

export const offsetTolerance = 2;
export const angleTolerance = 2;

function distance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function usableTrace({ edge: [start, end], checkpoint }: EdgeTrace, scale: number) {
  const projection =
    (checkpoint.x - start.x) * (end.x - start.x) + (checkpoint.y - start.y) * (end.y - start.y);
  return (
    projection > 0 &&
    projection < distance(start, end) ** 2 &&
    Math.min(distance(start, checkpoint), distance(checkpoint, end)) * scale >= 4
  );
}

function edgeAngle([start, end]: Edge) {
  return (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
}

function angleDistance(first: Edge, second: Edge) {
  const difference = Math.abs(edgeAngle(first) - edgeAngle(second)) % 180;
  return Math.min(difference, 180 - difference);
}

export function assessPerspective(pairs: EdgePair[], displayScale: number) {
  const usable = pairs.filter(
    ({ original, edited }) =>
      usableTrace(original, displayScale) && usableTrace(edited, displayScale),
  );
  const edges = usable.map(({ original, edited }) => {
    const [a, b] = original.edge;
    const [c, d] = edited.edge;
    const forward = Math.max(distance(a, c), distance(b, d));
    const reversed = Math.max(distance(a, d), distance(b, c));
    const [start, end] = forward <= reversed ? [c, d] : [d, c];
    const offsetPixels =
      Math.max(Math.min(forward, reversed), distance(original.checkpoint, edited.checkpoint)) *
      displayScale;
    const angleDegrees = Math.max(
      angleDistance([a, original.checkpoint], [start, edited.checkpoint]),
      angleDistance([original.checkpoint, b], [edited.checkpoint, end]),
    );
    return {
      offsetPixels,
      angleDegrees,
      moved: offsetPixels >= offsetTolerance || angleDegrees >= angleTolerance,
    };
  });
  const independentDirections = usable.some(({ original }, index) =>
    usable
      .slice(index + 1)
      .some((other) => angleDistance(original.edge, other.original.edge) >= 20),
  );
  return {
    status: edges.some(({ moved }) => moved)
      ? ("mismatch" as const)
      : independentDirections
        ? ("matched" as const)
        : ("uncertain" as const),
    edges,
  };
}
