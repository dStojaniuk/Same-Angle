import type { createCameraProjection, FloorBounds, FloorPoint } from "./camera";
import type { PhotoSize, Point } from "./outline";

type Camera = ReturnType<typeof createCameraProjection>;

export type BedSize = { width: number; length: number; height: number };
export type Bed = { center: FloorPoint; size: BedSize; crosswise: boolean };
export type ProjectedBedFace = { kind: "top" | "side"; points: Point[] };

export const bedPaint = { top: "#fff0cfe8", side: "#c4a878ed", outline: "#382f22" };

export const bedSize: BedSize = { width: 1.6, length: 2, height: 0.55 };

export function bedBounds(center: FloorPoint, crosswise: boolean, size: BedSize): FloorBounds {
  const width = crosswise ? size.length : size.width;
  const length = crosswise ? size.width : size.length;
  return { x: center.x - width / 2, z: center.z - length / 2, width, length };
}

function bedFootprint(center: FloorPoint, crosswise: boolean, size: BedSize): FloorPoint[] {
  const { x, z, width, length } = bedBounds(center, crosswise, size);
  return [
    { x, z },
    { x: x + width, z },
    { x: x + width, z: z + length },
    { x, z: z + length },
  ];
}

export function projectBed(
  camera: Camera,
  photo: PhotoSize,
  center: FloorPoint,
  crosswise: boolean,
  size = bedSize,
): ProjectedBedFace[] {
  const footprint = bedFootprint(center, crosswise, size);
  const base = footprint.map((point) => ({ ...point, y: 0 }));
  const top = footprint.map((point) => ({ ...point, y: size.height }));
  const faces: ProjectedBedFace[] = [{ kind: "top", points: camera.projectFace(top) }];

  for (const [index, start] of footprint.entries()) {
    const next = (index + 1) % footprint.length;
    const end = footprint[next];
    const outwardX = end.z - start.z;
    const outwardZ = start.x - end.x;

    if (outwardX * (camera.position.x - start.x) + outwardZ * (camera.position.z - start.z) > 0) {
      faces.push({
        kind: "side",
        points: camera.projectFace([base[index], base[next], top[next], top[index]]),
      });
    }
  }

  const drawable = faces.filter(({ points }) => points.length >= 3);
  return drawable.some(({ points }) => intersectsPhoto(points, photo)) ? drawable : [];
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
  size = bedSize,
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
    if (!projectBed(camera, photo, center, crosswise, size).length)
      return { message: "Choose a point where the bed fits in front of the camera." };

    return { center };
  }
}

function gridCoordinates(start: number, end: number): number[] {
  const values = [start];
  for (let meter = Math.floor(start) + 1; meter < end - 1e-8; meter++) {
    values.push(meter);
  }
  values.push(end);
  return values;
}

export function projectFloorGuides(camera: Camera, room: FloorBounds): [Point, Point][] {
  const guides: [Point, Point][] = [];
  const farX = room.x + room.width;
  const farZ = room.z + room.length;

  for (const x of gridCoordinates(room.x, farX)) {
    const line = camera.projectLine({ x, y: 0, z: room.z }, { x, y: 0, z: farZ });
    if (line) guides.push(line);
  }

  for (const z of gridCoordinates(room.z, farZ)) {
    const line = camera.projectLine({ x: room.x, y: 0, z }, { x: farX, y: 0, z });
    if (line) guides.push(line);
  }

  return guides;
}
