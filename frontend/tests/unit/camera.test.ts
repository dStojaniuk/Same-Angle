import { expect, test } from "@playwright/test";

import { projectBed, projectFloorGuides } from "../../src/bed";
import { createCameraProjection, initialCameraSettings } from "../../src/camera";

const photo = { width: 1000, height: 600 };
const level = {
  fieldOfView: 90,
  yaw: 0,
  tilt: 0,
  roll: 0,
  heightMeters: 1.5,
  xMeters: 0,
  zMeters: 0,
};

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
  expect(near.points[0].x).toBeCloseTo(400);
  expect(near.points[1].x).toBeCloseTo(600);
  expect(near.points[0].y).toBeCloseTo(487.5);
  expect(top.points[0].y).toBeCloseTo(418.75);

  const [rotated] = projectBed(camera, photo, center, true);
  expect(rotated.points[1].x - rotated.points[0].x).toBeGreaterThan(
    top.points[1].x - top.points[0].x,
  );
  expect(projectBed(camera, photo, { x: 0, z: -1.2 }, false)).toEqual([]);
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

test("two opposing cameras project and recover one room position", () => {
  const first = createCameraProjection(photo, level);
  const second = createCameraProjection(photo, { ...level, xMeters: 2, zMeters: 8, yaw: 180 });
  const point = { x: 1, y: 0, z: 5 };
  expect(first.project(point)).toEqual({ x: 600, y: 450 });

  const otherPixel = second.project(point)!;
  expect(otherPixel.x).toBeCloseTo(666.667, 2);
  expect(otherPixel.y).toBeCloseTo(550);
  const floor = second.pointOnFloor(otherPixel)!;
  expect(floor.x).toBeCloseTo(1);
  expect(floor.z).toBeCloseTo(5);
});

test("clips a face with corners behind the second camera", () => {
  const camera = createCameraProjection(photo, { ...level, zMeters: 8, yaw: 180 });
  const face = camera.projectFace([
    { x: -0.5, y: 0, z: 7 },
    { x: 0.5, y: 0, z: 7 },
    { x: 0.5, y: 0, z: 9 },
    { x: -0.5, y: 0, z: 9 },
  ]);
  expect(face).toHaveLength(4);
  expect(face.map(({ y }) => Math.round(y)).sort((a, b) => a - b)).toEqual([
    1050, 1050, 7800, 7800,
  ]);
});

test("keeps the floor guides registered when the room and camera have a new origin", () => {
  const size = { width: 1440, height: 960 };
  const room = { x: -1.6, z: 0, width: 3.2, length: 7.6 };
  const settings = { ...initialCameraSettings, yaw: 0 };
  const original = projectFloorGuides(createCameraProjection(size, settings), room);
  const moved = projectFloorGuides(
    createCameraProjection(size, { ...settings, xMeters: 7, zMeters: 12 }),
    { ...room, x: room.x + 7, z: room.z + 12 },
  );

  expect(original.length).toBeGreaterThan(0);
  expect(moved).toHaveLength(original.length);
  for (const [index, [start, end]] of original.entries()) {
    expect(moved[index][0].x).toBeCloseTo(start.x);
    expect(moved[index][0].y).toBeCloseTo(start.y);
    expect(moved[index][1].x).toBeCloseTo(end.x);
    expect(moved[index][1].y).toBeCloseTo(end.y);
  }
});

test("keeps the side face identified when the near plane clips away the top", () => {
  const size = { width: 600, height: 1000 };
  const camera = createCameraProjection(size, {
    ...initialCameraSettings,
    tilt: 45,
    heightMeters: 0.8,
  });
  const faces = projectBed(camera, size, { x: 0.35, z: -0.2 }, false, {
    width: 0.5,
    length: 0.5,
    height: 0.75,
  });
  expect(faces.map((face) => face.kind)).toEqual(["side"]);
});
