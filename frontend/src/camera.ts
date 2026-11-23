import type { PhotoSize, Point } from "./outline";

export type CameraSettings = {
  fieldOfView: number;
  yaw: number;
  tilt: number;
  roll: number;
  heightMeters: number;
  xMeters: number;
  zMeters: number;
};

const cameraRanges = {
  fieldOfView: { min: 35, max: 110, step: 1 },
  yaw: { min: -360, max: 360, step: 1 },
  tilt: { min: -45, max: 45, step: 1 },
  roll: { min: -20, max: 20, step: 1 },
  heightMeters: { min: 0.8, max: 2.4, step: 0.05 },
  xMeters: { min: -10, max: 10, step: 0.05 },
  zMeters: { min: -10, max: 15, step: 0.05 },
} satisfies Record<keyof CameraSettings, { min: number; max: number; step: number }>;

export const cameraFields = Object.keys(cameraRanges) as (keyof CameraSettings)[];

export function cameraRange(key: keyof CameraSettings, hasSecondPhoto: boolean) {
  return key === "yaw" && !hasSecondPhoto ? { min: -45, max: 45, step: 1 } : cameraRanges[key];
}

export const initialCameraSettings: CameraSettings = {
  fieldOfView: 72,
  yaw: 0,
  tilt: 9,
  roll: 0,
  heightMeters: 1.45,
  xMeters: 0,
  zMeters: 0,
};

export type FloorPoint = { x: number; z: number };
export type FloorBounds = FloorPoint & { width: number; length: number };
export type FloorProjection = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
type WorldPoint = FloorPoint & { y: number };

const radians = Math.PI / 180;
const nearMeters = 0.1;

// The floor is y = 0. An unrotated camera faces +z and has its right axis along +x.
export function createCameraProjection(photo: PhotoSize, settings: CameraSettings) {
  const position = { x: settings.xMeters, z: settings.zMeters };
  const yaw = settings.yaw * radians;
  const tilt = settings.tilt * radians;
  const roll = settings.roll * radians;
  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);
  const focalPixels = photo.width / (2 * Math.tan((settings.fieldOfView * radians) / 2));
  const centerX = photo.width / 2;
  const centerY = photo.height / 2;

  const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const up = {
    x: Math.sin(tilt) * Math.sin(yaw),
    y: Math.cos(tilt),
    z: Math.sin(tilt) * Math.cos(yaw),
  };
  const forward = {
    x: Math.cos(tilt) * Math.sin(yaw),
    y: -Math.sin(tilt),
    z: Math.cos(tilt) * Math.cos(yaw),
  };

  function toCamera(point: WorldPoint): WorldPoint {
    const offsetX = point.x - position.x;
    const offsetZ = point.z - position.z;
    const offsetY = point.y - settings.heightMeters;
    const horizontal = offsetX * right.x + offsetZ * right.z;
    const vertical = offsetX * up.x + offsetY * up.y + offsetZ * up.z;

    return {
      x: horizontal * cosRoll + vertical * sinRoll,
      y: vertical * cosRoll - horizontal * sinRoll,
      z: offsetX * forward.x + offsetY * forward.y + offsetZ * forward.z,
    };
  }

  function toPhoto(point: WorldPoint): Point {
    return {
      x: centerX + (focalPixels * point.x) / point.z,
      y: centerY - (focalPixels * point.y) / point.z,
    };
  }

  function project(point: WorldPoint): Point | null {
    const view = toCamera(point);
    return view.z >= nearMeters ? toPhoto(view) : null;
  }

  function atNear(behind: WorldPoint, ahead: WorldPoint): WorldPoint {
    const t = (nearMeters - behind.z) / (ahead.z - behind.z);
    return {
      x: behind.x + (ahead.x - behind.x) * t,
      y: behind.y + (ahead.y - behind.y) * t,
      z: nearMeters,
    };
  }

  function projectLine(start: WorldPoint, end: WorldPoint): [Point, Point] | null {
    let from = toCamera(start);
    let to = toCamera(end);
    if (from.z < nearMeters && to.z < nearMeters) return null;

    if (from.z < nearMeters) from = atNear(from, to);
    if (to.z < nearMeters) to = atNear(to, from);
    return [toPhoto(from), toPhoto(to)];
  }

  function projectFace(face: WorldPoint[]): Point[] {
    const vertices = face.map(toCamera);
    const clipped: WorldPoint[] = [];

    for (const [index, vertex] of vertices.entries()) {
      const previous = vertices[(index + vertices.length - 1) % vertices.length];
      if (previous.z < nearMeters && vertex.z > nearMeters) clipped.push(atNear(previous, vertex));
      if (previous.z > nearMeters && vertex.z < nearMeters) clipped.push(atNear(vertex, previous));
      if (vertex.z >= nearMeters) clipped.push(vertex);
    }

    return clipped.length < 3 ? [] : clipped.map(toPhoto);
  }

  function ray(point: Point): WorldPoint {
    const imageX = (point.x - centerX) / focalPixels;
    const imageY = (centerY - point.y) / focalPixels;
    const alongRight = imageX * cosRoll - imageY * sinRoll;
    const alongUp = imageX * sinRoll + imageY * cosRoll;
    return {
      x: forward.x + alongRight * right.x + alongUp * up.x,
      y: forward.y + alongUp * up.y,
      z: forward.z + alongRight * right.z + alongUp * up.z,
    };
  }

  function pointOnFloor(point: Point): FloorPoint | null {
    const direction = ray(point);
    if (direction.y >= 0) return null;

    const depth = -settings.heightMeters / direction.y;
    if (depth < nearMeters) return null;

    return {
      x: position.x + depth * direction.x,
      z: position.z + depth * direction.z,
    };
  }

  function floorProjection(tileMeters: number): FloorProjection {
    // At y = 0, the ray travels height / -ray.y. The last row is that divisor.
    const origin = ray({ x: 0, y: 0 });
    const across = ray({ x: 1, y: 0 });
    const down = ray({ x: 0, y: 1 });
    const column = (direction: WorldPoint) => {
      const w = -direction.y;
      return [
        (position.x * w + settings.heightMeters * direction.x) / tileMeters,
        (position.z * w + settings.heightMeters * direction.z) / tileMeters,
        w,
      ];
    };
    const [u, v, w] = column(origin);
    const [ux, vx, wx] = column(across);
    const [uy, vy, wy] = column(down);
    return [ux - u, uy - u, u, vx - v, vy - v, v, wx - w, wy - w, w];
  }

  return { position, project, projectLine, projectFace, pointOnFloor, floorProjection };
}
