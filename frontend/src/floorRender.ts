import type { FloorProjection } from "./camera";
import type { FloorDraft } from "./floorDraft";
import type { Point } from "./outline";
import type { RoomPhoto } from "./photo";
import { assertRenderResponse, readRenderedPng } from "./renderedPhoto";

export class FloorGeometryError extends Error {
  constructor(
    public readonly adjust: "outline" | "grid",
    message: string,
  ) {
    super(message);
  }
}

async function floorPhotoForm(photo: RoomPhoto, signal: AbortSignal) {
  const workingPhoto = await fetch(photo.url, { signal });
  if (!workingPhoto.ok) throw new Error("The photo for rendering could not be read.");
  const form = new FormData();
  form.set("photo", await workingPhoto.blob(), "room");
  return form;
}

export async function suggestFloor(
  photo: RoomPhoto,
  prompt: string,
  signal: AbortSignal,
): Promise<FloorDraft> {
  const form = await floorPhotoForm(photo, signal);
  form.set("prompt", prompt);
  const response = await fetch("/api/floor-suggestion", { method: "POST", body: form, signal });
  await assertRenderResponse(response);
  const result = (await response.json()) as {
    outline: [number, number][];
    corners: [number, number][] | null;
  };
  return {
    outline: result.outline.map(([x, y]) => ({ x, y })),
    corners: result.corners?.map(([x, y]) => ({ x, y })) ?? null,
  };
}

export async function renderFloor(
  photo: RoomPhoto,
  outline: Point[],
  surface: Point[] | { projection: FloorProjection },
  signal: AbortSignal,
  prompt?: string,
): Promise<Blob> {
  const form = await floorPhotoForm(photo, signal);
  if (prompt !== undefined) form.set("prompt", prompt);
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

  try {
    return await readRenderedPng(response);
  } catch (error) {
    const adjust = response.headers.get("X-Same-Angle-Floor-Adjust");
    if (
      response.status === 422 &&
      (adjust === "outline" || adjust === "grid") &&
      error instanceof Error
    ) {
      throw new FloorGeometryError(adjust, error.message);
    }
    throw error;
  }
}
