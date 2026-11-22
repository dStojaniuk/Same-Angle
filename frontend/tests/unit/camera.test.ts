import { expect, test } from "@playwright/test";

import { projectBed } from "../../src/bed";
import { createCameraProjection, initialCameraSettings } from "../../src/camera";

const photo = { width: 1000, height: 600 };
const level = { fieldOfView: 90, yaw: 0, tilt: 0, roll: 0, heightMeters: 1.5 };

test("projects a known floor point and a point half a meter above it", () => {
  const camera = createCameraProjection(photo, level);
  expect(camera.project({ x: 1, y: 0, z: 5 })).toEqual({ x: 600, y: 450 });
  expect(camera.project({ x: 1, y: 0.5, z: 5 })).toEqual({ x: 600, y: 400 });

  const wide = createCameraProjection(photo, { ...level, fieldOfView: 110 });
  const point = wide.project({ x: 1, y: 0, z: 5 })!;
  expect(point.x).toBeCloseTo(570.02, 2);
  expect(point.y).toBeCloseTo(405.03, 2);
});

test("uses a single camera pose for the preview and placement on a portrait photo", () => {
  const camera = createCameraProjection(
    { width: 600, height: 1000 },
    { ...level, yaw: 45, tilt: 30, roll: 15 },
  );
  const opticalAxis = 1.5 * Math.sqrt(3 / 2);
  const center = camera.project({ x: opticalAxis, y: 0, z: opticalAxis })!;
  expect(center.x).toBeCloseTo(300);
  expect(center.y).toBeCloseTo(500);

  const pixel = camera.project({ x: 2, y: 0, z: 3 })!;
  const floor = camera.pointOnFloor(pixel)!;
  expect(floor.x).toBeCloseTo(2);
  expect(floor.z).toBeCloseTo(3);
});

test("rejects points in the sky and clips guides that cross the camera", () => {
  const camera = createCameraProjection(photo, level);
  expect(camera.pointOnFloor({ x: 500, y: 299 })).toBeNull();
  expect(camera.pointOnFloor({ x: 500, y: 300 })).toBeNull();
  expect(camera.project({ x: 0, y: 0, z: -1 })).toBeNull();

  const guide = camera.projectLine({ x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 5 })!;
  expect(guide[0].x).toBeCloseTo(500);
  expect(guide[0].y).toBeCloseTo(7800);
  expect(guide[1]).toEqual({ x: 500, y: 450 });
});

test("draws the near side and top of the bed with its width on the floor", () => {
  const camera = createCameraProjection(photo, level);
  const center = { x: 0, z: 5 };
  const [top, near] = projectBed(camera, photo, center, false);
  expect(near[0].x).toBeCloseTo(400);
  expect(near[1].x).toBeCloseTo(600);
  expect(near[0].y).toBeCloseTo(487.5);
  expect(top[0].y).toBeCloseTo(418.75);

  const [rotated] = projectBed(camera, photo, center, true);
  expect(rotated[1].x - rotated[0].x).toBeGreaterThan(top[1].x - top[0].x);
  expect(projectBed(camera, photo, { x: 0, z: 0.6 }, false)).toEqual([]);
});

test("projects the horizon below center for a camera pitched upward", () => {
  const camera = createCameraProjection(photo, { ...level, tilt: -15 });
  expect(camera.pointOnFloor({ x: 500, y: 430 })).toBeNull();
  const floor = camera.pointOnFloor({ x: 500, y: 550 })!;
  expect(floor.z).toBeCloseTo(7.33, 2);
});

test("roll rotates an off-axis point by the requested angle", () => {
  const camera = createCameraProjection(photo, { ...level, roll: 30 });
  const point = camera.project({ x: 2, y: 0.5, z: 5 })!;
  expect(point.x).toBeCloseTo(623.205);
  expect(point.y).toBeCloseTo(486.603);
});

test("treats a bed beyond a frame corner as out of view", () => {
  const photo = { width: 1440, height: 960 };
  const initial = createCameraProjection(photo, initialCameraSettings);
  const center = initial.pointOnFloor({ x: 547.2, y: 902.4 })!;
  const camera = createCameraProjection(photo, {
    ...initialCameraSettings,
    yaw: 35,
    fieldOfView: 35,
  });

  expect(projectBed(camera, photo, center, false)).toEqual([]);
});
