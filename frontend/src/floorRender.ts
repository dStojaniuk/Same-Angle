import type { FloorProjection } from "./camera";
import type { Point } from "./outline";
import type { RoomPhoto } from "./photo";
import { readRenderedPng } from "./renderedPhoto";

export async function renderFloor(
  photo: RoomPhoto,
  outline: Point[],
  surface: Point[] | { projection: FloorProjection },
  signal: AbortSignal,
): Promise<Blob> {
  const workingPhoto = await fetch(photo.url, { signal });
  if (!workingPhoto.ok) throw new Error("The photo for rendering could not be read.");

  const form = new FormData();
  form.set("photo", await workingPhoto.blob(), "room");
  form.set(
    "plan",
    JSON.stringify({
      width: photo.width,
      height: photo.height,
      outline: outline.map(({ x, y }) => [x, y]),
      ...(Array.isArray(surface) ? { corners: surface.map(({ x, y }) => [x, y]) } : surface),
    }),
  );

  const response = await fetch("/api/floor-render", { method: "POST", body: form, signal });

  return readRenderedPng(response);
}
