export const MAX_OUTLINE_POINTS = 128;

export type Point = { x: number; y: number };
export type PhotoSize = { width: number; height: number };
type PhotoRect = Pick<DOMRect, "left" | "top" | "width" | "height">;

export function limitToPhoto(point: Point, photo: PhotoSize): Point {
  return {
    x: Math.round(Math.max(0, Math.min(photo.width, point.x))),
    y: Math.round(Math.max(0, Math.min(photo.height, point.y))),
  };
}

export function clientToPhoto(point: Point, rect: PhotoRect, photo: PhotoSize): Point {
  return {
    x: ((point.x - rect.left) / rect.width) * photo.width,
    y: ((point.y - rect.top) / rect.height) * photo.height,
  };
}

export function movePoint(outline: Point[], index: number, position: Point): Point[] {
  const previous = outline[index];

  if (previous.x === position.x && previous.y === position.y) return outline;

  return outline.map((point, pointIndex) => (pointIndex === index ? position : point));
}

export function translateOutline(points: Point[], offset: Point, photo: PhotoSize): Point[] {
  if (!points.length) return points;

  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const x = Math.max(
    -Math.min(...xs),
    Math.min(photo.width - Math.max(...xs), Math.round(offset.x)),
  );
  const y = Math.max(
    -Math.min(...ys),
    Math.min(photo.height - Math.max(...ys), Math.round(offset.y)),
  );

  if (!x && !y) return points;

  return points.map((point) => ({ x: point.x + x, y: point.y + y }));
}
