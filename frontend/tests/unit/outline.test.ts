import { expect, test } from "@playwright/test";

import { clientToPhoto, limitToPhoto, movePoint, translateOutline } from "../../src/outline";

test("the same feature maps to the same image point at two viewport sizes", () => {
  const photo = { width: 1200, height: 800 };
  expect(
    clientToPhoto({ x: 250, y: 240 }, { left: 100, top: 40, width: 600, height: 400 }, photo),
  ).toEqual({ x: 300, y: 400 });
  expect(
    clientToPhoto({ x: 360, y: 450 }, { left: 60, top: 50, width: 1200, height: 800 }, photo),
  ).toEqual({ x: 300, y: 400 });
});

test("a point moved past the photo lands on its nearest edge", () => {
  expect(limitToPhoto({ x: -30, y: 820 }, { width: 1200, height: 800 })).toEqual({
    x: 0,
    y: 800,
  });
});

test("an edit leaves the previous outline available for undo", () => {
  const outline = [
    { x: 10, y: 20 },
    { x: 40, y: 50 },
  ];
  expect(movePoint(outline, 0, { x: 10, y: 20 })).toBe(outline);
  expect(movePoint(outline, 0, { x: 12, y: 24 })).toEqual([
    { x: 12, y: 24 },
    { x: 40, y: 50 },
  ]);
  expect(outline[0]).toEqual({ x: 10, y: 20 });
});

test("moving an outline clips the translation and keeps its shape", () => {
  const points = [
    { x: 2, y: 1 },
    { x: 4, y: 3 },
    { x: 9, y: 7 },
  ];
  expect(translateOutline(points, { x: 8, y: -4 }, { width: 10, height: 10 })).toEqual([
    { x: 3, y: 0 },
    { x: 5, y: 2 },
    { x: 10, y: 6 },
  ]);
});
