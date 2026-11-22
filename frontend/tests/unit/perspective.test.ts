import { expect, test } from "@playwright/test";

import { floorGridLines, projectFloor } from "../../src/perspective";

const corners = [
  { x: 2, y: 1 },
  { x: 8, y: 1 },
  { x: 10, y: 9 },
  { x: 0, y: 9 },
];

test("equal floor coordinates project closer together at the back", () => {
  const project = projectFloor(corners)!;
  const midpoint = project(0.5, 0.5);
  expect(midpoint.x).toBeCloseTo(5);
  expect(midpoint.y).toBeCloseTo(4);
  expect(project(1, 1)).toEqual({ x: 10, y: 9 });
  expect(floorGridLines(corners)).toHaveLength(12);
});

test("crossing corners do not produce a grid", () => {
  expect(floorGridLines([corners[0], corners[1], corners[3], corners[2]])).toEqual([]);
});
