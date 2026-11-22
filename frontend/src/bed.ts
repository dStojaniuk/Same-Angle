import type { createCameraProjection, FloorPoint } from "./camera";
import type { PhotoSize, Point } from "./outline";

type Camera = ReturnType<typeof createCameraProjection>;

export const bedSize = { width: 1.6, length: 2, height: 0.55 };

export function projectBed(
  camera: Camera,
  photo: PhotoSize,
  center: FloorPoint,
  crosswise: boolean,
): Point[][] {
  const halfWidth = (crosswise ? bedSize.length : bedSize.width) / 2;
  const halfLength = (crosswise ? bedSize.width : bedSize.length) / 2;
  const footprint = [
    { x: center.x - halfWidth, z: center.z - halfLength },
    { x: center.x + halfWidth, z: center.z - halfLength },
    { x: center.x + halfWidth, z: center.z + halfLength },
    { x: center.x - halfWidth, z: center.z + halfLength },
  ];
  const base = footprint.map((point) => ({ ...point, y: 0 }));
  const top = footprint.map((point) => ({ ...point, y: bedSize.height }));
  const faces = [camera.projectFace(top)];

  for (const [index, start] of footprint.entries()) {
    const next = (index + 1) % footprint.length;
    const end = footprint[next];
    const outwardX = end.z - start.z;
    const outwardZ = start.x - end.x;

    if (outwardX * (camera.position.x - start.x) + outwardZ * (camera.position.z - start.z) > 0) {
      faces.push(camera.projectFace([base[index], base[next], top[next], top[index]]));
    }
  }

  const drawable = faces.filter((face) => face.length >= 3);
  return drawable.some((face) => intersectsPhoto(face, photo)) ? drawable : [];
}

function intersectsPhoto(face: Point[], photo: PhotoSize): boolean {
  const edgeNormals = face.map((start, index) => {
    const end = face[(index + 1) % face.length];
    return { x: end.y - start.y, y: start.x - end.x };
  });
  const axes = [{ x: 1, y: 0 }, { x: 0, y: 1 }, ...edgeNormals];

  // Convex polygons overlap only if their intervals overlap along every edge normal.
  return axes.every(({ x, y }) => {
    const projection = face.map((point) => point.x * x + point.y * y);
    const photoX = photo.width * x;
    const photoY = photo.height * y;
    const photoMin = Math.min(0, photoX) + Math.min(0, photoY);
    const photoMax = Math.max(0, photoX) + Math.max(0, photoY);

    return Math.max(...projection) > photoMin && Math.min(...projection) < photoMax;
  });
}

const maxPlacementDistanceMeters = 25;
type BedPlacement = { center: FloorPoint } | { message: string };

export function placeBedOnPhoto(
  camera: Camera,
  photo: PhotoSize,
  crosswise: boolean,
  point?: Point,
): BedPlacement {
  if (point) return placementAt(point);

  // Keyboard activation tries the center first, then other parts of the visible photo.
  for (const y of [0.8, 0.6, 0.5, 0.7, 0.9, 0.4, 0.3, 0.2, 0.1]) {
    for (const x of [0.5, 0.35, 0.65, 0.2, 0.8, 0.05, 0.95]) {
      const candidate = placementAt({ x: x * photo.width, y: y * photo.height });
      if ("center" in candidate) return candidate;
    }
  }

  return { message: "Adjust the camera so the floor is visible, then try placing the bed again." };

  function placementAt(pixel: Point): BedPlacement {
    const center = camera.pointOnFloor(pixel);
    if (!center) return { message: "Choose a point on the floor below the horizon." };
    if (
      Math.hypot(center.x - camera.position.x, center.z - camera.position.z) >
      maxPlacementDistanceMeters
    )
      return { message: "Choose a point closer to the camera." };
    if (!projectBed(camera, photo, center, crosswise).length)
      return { message: "Choose a point where the bed fits in front of the camera." };

    return { center };
  }
}

export function projectFloorGuides(camera: Camera): [Point, Point][] {
  const guides: [Point, Point][] = [];

  for (let meter = -4; meter <= 4; meter++) {
    const line = camera.projectLine({ x: meter, y: 0, z: 0 }, { x: meter, y: 0, z: 10 });
    if (line) guides.push(line);
  }

  for (let meter = 1; meter <= 10; meter++) {
    const line = camera.projectLine({ x: -4, y: 0, z: meter }, { x: 4, y: 0, z: meter });
    if (line) guides.push(line);
  }

  return guides;
}
