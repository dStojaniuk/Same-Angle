import type { PhotoSize, Point } from "./outline";

export type CameraSettings = {
  fieldOfView: number;
  yaw: number;
  tilt: number;
  roll: number;
  heightMeters: number;
};

export const initialCameraSettings: CameraSettings = {
  fieldOfView: 72,
  yaw: 0,
  tilt: 9,
  roll: 0,
  heightMeters: 1.45,
};

export type FloorPoint = { x: number; z: number };
type WorldPoint = FloorPoint & { y: number };

const radians = Math.PI / 180;
const nearMeters = 0.1;

// The floor is y = 0. An unrotated camera faces +z and has its right axis along +x.
export function createCameraProjection(photo: PhotoSize, settings: CameraSettings) {
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
    const offsetY = point.y - settings.heightMeters;
    const horizontal = point.x * right.x + point.z * right.z;
    const vertical = point.x * up.x + offsetY * up.y + point.z * up.z;

    return {
      x: horizontal * cosRoll + vertical * sinRoll,
      y: vertical * cosRoll - horizontal * sinRoll,
      z: point.x * forward.x + offsetY * forward.y + point.z * forward.z,
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

  function projectLine(start: WorldPoint, end: WorldPoint): [Point, Point] | null {
    let from = toCamera(start);
    let to = toCamera(end);
    if (from.z < nearMeters && to.z < nearMeters) return null;

    // Clip the guide to the camera's near plane before dividing by depth.
    function atNear(behind: WorldPoint, ahead: WorldPoint): WorldPoint {
      const t = (nearMeters - behind.z) / (ahead.z - behind.z);
      return {
        x: behind.x + (ahead.x - behind.x) * t,
        y: behind.y + (ahead.y - behind.y) * t,
        z: nearMeters,
      };
    }

    if (from.z < nearMeters) from = atNear(from, to);
    if (to.z < nearMeters) to = atNear(to, from);
    return [toPhoto(from), toPhoto(to)];
  }

  function pointOnFloor(point: Point): FloorPoint | null {
    const imageX = (point.x - centerX) / focalPixels;
    const imageY = (centerY - point.y) / focalPixels;
    const alongRight = imageX * cosRoll - imageY * sinRoll;
    const alongUp = imageX * sinRoll + imageY * cosRoll;
    const rayY = forward.y + alongUp * up.y;
    if (rayY >= 0) return null;

    const depth = -settings.heightMeters / rayY;
    if (depth < nearMeters) return null;

    return {
      x: depth * (forward.x + alongRight * right.x + alongUp * up.x),
      z: depth * (forward.z + alongRight * right.z + alongUp * up.z),
    };
  }

  return { project, projectLine, pointOnFloor };
}
