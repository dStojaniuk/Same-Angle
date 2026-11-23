import { createCameraProjection, type CameraSettings, type FloorBounds } from "./camera";
import type { PhotoSize, Point } from "./outline";

export type RoomShell = FloorBounds & { height: number };
export const roomEdgeLabels = {
  farFloor: "Far wall · floor seam",
  farCeiling: "Far wall · ceiling seam",
  farLeft: "Far wall · left corner",
  farRight: "Far wall · right corner",
  leftFloor: "Left wall · floor seam",
  rightFloor: "Right wall · floor seam",
} as const;
export type EdgeId = keyof typeof roomEdgeLabels;
export type EdgeMark = { edge: EdgeId; points: [Point, Point] };
type Camera = ReturnType<typeof createCameraProjection>;

const fields = [
  ["yaw", 20],
  ["tilt", 20],
  ["roll", 20],
  ["xMeters", 1],
  ["heightMeters", 1],
  ["zMeters", 1],
  ["fieldOfView", 20],
] as const;

export function projectRoomEdge(camera: Camera, room: RoomShell, edge: EdgeId) {
  const { x, z, width, length, height } = room;
  const left = { x, y: 0, z: z + length };
  const right = { ...left, x: x + width };
  const topLeft = { ...left, y: height };
  const topRight = { ...right, y: height };
  const ends = {
    farFloor: [left, right],
    farCeiling: [topLeft, topRight],
    farLeft: [left, topLeft],
    farRight: [right, topRight],
    leftFloor: [left, { ...left, z }],
    rightFloor: [right, { ...right, z }],
  } as const;

  const [start, end] = ends[edge];
  return camera.projectLine(start, end);
}

export function hasEdgeLength(photo: PhotoSize, { points: [a, b] }: EdgeMark): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) >= Math.hypot(photo.width, photo.height) * 0.015;
}

export function overlapsEdgeSpan(mark: EdgeMark, fit: EdgeMark): boolean {
  const [a, b] = fit.points;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const offsets = mark.points.map(({ x, y }) => (x - a.x) * dx + (y - a.y) * dy);
  if (Math.max(...offsets) < 0 || Math.min(...offsets) > lengthSquared) return false;
  if (mark.edge === fit.edge) return true;

  // A repeated segment supplies the same pixels even under a different edge label.
  return mark.points.every(
    ({ x, y }) => Math.abs((x - a.x) * dy - (y - a.y) * dx) <= Math.sqrt(lengthSquared),
  );
}

function edgeDistances(camera: Camera, room: RoomShell, mark: EdgeMark): number[] | null {
  const projected = projectRoomEdge(camera, room, mark.edge);
  if (!projected) return null;

  const [start, end] = projected;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-5) return null;

  return mark.points.map(({ x, y }) => ((x - start.x) * -dy + (y - start.y) * dx) / length);
}

export function measureEdge(camera: Camera, room: RoomShell, mark: EdgeMark) {
  const projected = projectRoomEdge(camera, room, mark.edge);
  if (!projected) return null;

  const [start, end] = projected;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-10) return null;

  const distances = mark.points.map(({ x, y }) => {
    const along = ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared;
    const t = Math.max(0, Math.min(1, along));
    return Math.hypot(x - start.x - t * dx, y - start.y - t * dy);
  });
  return {
    rmsPixels: Math.hypot(...distances) / Math.sqrt(distances.length),
    maxPixels: Math.max(...distances),
  };
}

function solve(matrix: number[][], target: number[]): number[] | null {
  const rows = matrix.map((row, i) => [...row, target[i]]);

  for (let column = 0; column < rows.length; column++) {
    let pivot = column;
    for (let row = column + 1; row < rows.length; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    const value = rows[pivot][column];
    if (Math.abs(value) < 1e-8) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    rows[column] = rows[column].map((cell) => cell / value);

    for (let row = 0; row < rows.length; row++) {
      if (row === column) continue;
      const weight = rows[row][column];
      rows[row] = rows[row].map((cell, index) => cell - rows[column][index] * weight);
    }
  }

  return rows.map((row) => row[rows.length]);
}

function adjust(camera: CameraSettings, step: number[]): CameraSettings {
  const next = { ...camera };
  fields.forEach(([key, scale], index) => (next[key] += step[index] * scale));
  return next;
}

export function fitRoomCamera(photo: PhotoSize, room: RoomShell, marks: EdgeMark[]) {
  const edges = new Set(marks.map(({ edge }) => edge));
  // Four edges can admit two distinct poses with the same reprojection error.
  if (edges.size < 5) return null;

  const diagonal = Math.hypot(photo.width, photo.height);
  if (marks.some((mark) => !hasEdgeLength(photo, mark))) return null;

  function residual(settings: CameraSettings): number[] | null {
    if (
      settings.fieldOfView < 30 ||
      settings.fieldOfView > 115 ||
      settings.heightMeters < 0.3 ||
      settings.heightMeters > room.height + 0.3 ||
      settings.zMeters > room.z + room.length - 0.2 ||
      settings.zMeters < room.z - room.length ||
      Math.abs(settings.xMeters - room.x - room.width / 2) > room.width * 1.5 ||
      Math.abs(settings.yaw) > 85 ||
      Math.abs(settings.tilt) > 55 ||
      Math.abs(settings.roll) > 35
    )
      return null;

    const projector = createCameraProjection(photo, settings);
    const distances: number[] = [];
    for (const mark of marks) {
      const pair = edgeDistances(projector, room, mark);
      if (!pair) return null;
      distances.push(...pair.map((distance) => distance / diagonal));
    }
    return distances;
  }

  function normalEquations(camera: CameraSettings, errors: number[]) {
    const epsilon = 1e-4;
    const columns = fields.map((_, column) => {
      const step: number[] = fields.map((_, index) => (index === column ? epsilon : 0));
      const forward = residual(adjust(camera, step));
      if (forward) return forward.map((value, row) => (value - errors[row]) / epsilon);

      step[column] = -epsilon;
      const backward = residual(adjust(camera, step));
      return backward?.map((value, row) => (errors[row] - value) / epsilon);
    });
    if (columns.some((column) => column === undefined)) return null;

    const vectors = columns as number[][];
    const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
    return {
      gram: vectors.map((a) => vectors.map((b) => dot(a, b))),
      target: vectors.map((a) => -dot(a, errors)),
    };
  }

  function fitFrom(seed: CameraSettings) {
    let camera = seed;
    let errors = residual(camera);
    if (!errors) return null;

    let cost = Math.hypot(...errors);
    let damping = 0.001;
    for (let iteration = 0; iteration < 70 && damping < 1e7; iteration++) {
      const equations = normalEquations(camera, errors);
      if (!equations) break;

      const matrix = equations.gram.map((row, i) =>
        row.map((value, j) => (i === j ? value + damping : value)),
      );
      const step = solve(matrix, equations.target);
      if (!step || Math.hypot(...step) < 1e-7) break;

      const candidate = adjust(camera, step);
      const nextErrors = residual(candidate);
      const nextCost = nextErrors ? Math.hypot(...nextErrors) : Infinity;
      if (nextErrors && nextCost < cost) {
        camera = candidate;
        errors = nextErrors;
        cost = nextCost;
        damping *= 0.4;
      } else {
        damping *= 4;
      }
    }

    const equations = normalEquations(camera, errors);
    if (!equations || !solve(equations.gram, equations.target)) return null;

    return { camera, rmsPixels: (diagonal * cost) / Math.sqrt(errors.length) };
  }

  const fits = [12, 26].flatMap((tilt) =>
    [-30, 0, 30].map((yaw) =>
      fitFrom({
        yaw,
        tilt,
        roll: 0,
        fieldOfView: 66,
        xMeters: room.x + room.width / 2,
        heightMeters: room.height * 0.55,
        zMeters: room.z + room.length * 0.15,
      }),
    ),
  );
  return fits.reduce<NonNullable<(typeof fits)[number]> | null>(
    (best, fit) => (fit && (!best || fit.rmsPixels < best.rmsPixels) ? fit : best),
    null,
  );
}
