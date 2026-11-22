import type { Point } from "./outline";

function turn(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function projectFloor(corners: Point[]): ((u: number, v: number) => Point) | null {
  if (
    corners.length !== 4 ||
    corners.some(
      (point, index) => turn(point, corners[(index + 1) % 4], corners[(index + 2) % 4]) <= 0,
    )
  ) {
    return null;
  }

  const [a, b, c, d] = corners;
  const dx1 = b.x - c.x;
  const dx2 = d.x - c.x;
  const dy1 = b.y - c.y;
  const dy2 = d.y - c.y;
  const sx = a.x - b.x + c.x - d.x;
  const sy = a.y - b.y + c.y - d.y;

  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - sy * dx2) / denominator;
  const h = (dx1 * sy - dy1 * sx) / denominator;

  return (u, v) => {
    const w = 1 + g * u + h * v;

    return {
      x: (a.x + (b.x * (1 + g) - a.x) * u + (d.x * (1 + h) - a.x) * v) / w,
      y: (a.y + (b.y * (1 + g) - a.y) * u + (d.y * (1 + h) - a.y) * v) / w,
    };
  };
}

export function floorGridLines(corners: Point[]): [Point, Point][] {
  const project = projectFloor(corners);
  if (!project) return [];

  const lines: [Point, Point][] = [];

  for (let column = 0; column <= 6; column += 1) {
    lines.push([project(column / 6, 0), project(column / 6, 1)]);
  }

  for (let row = 0; row <= 4; row += 1) {
    lines.push([project(0, row / 4), project(1, row / 4)]);
  }

  return lines;
}

export function initialGrid(outline: Point[]): Point[] {
  const xs = outline.map(({ x }) => x);
  const ys = outline.map(({ y }) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const inset = Math.round((right - left) * 0.19);

  return [
    { x: left + inset, y: top },
    { x: right - inset, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}
