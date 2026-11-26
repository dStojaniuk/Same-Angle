import type { FloorProjection } from "./camera";
import type { FloorDraft } from "./floorDraft";
import type { Point } from "./outline";
import type { RoomPhoto } from "./photo";
import { assertRenderResponse, readRenderedPng } from "./renderedPhoto";

export class FloorGeometryError extends Error {
  constructor(
    public readonly adjust: "outline" | "grid" | "protection",
    message: string,
  ) {
    super(message);
  }
}

export type FloorProtection = {
  regions: Point[][];
  depthMask: Blob | null;
};

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

export async function suggestFloorProtection(
  photo: RoomPhoto,
  outline: Point[],
  signal: AbortSignal,
): Promise<Blob | null> {
  const form = await floorPhotoForm(photo, signal);
  form.set("plan", JSON.stringify({ outline: outline.map(({ x, y }) => [x, y]) }));
  const response = await fetch("/api/floor-depth-hint", { method: "POST", body: form, signal });
  if (response.status === 204) return null;
  return readRenderedPng(response);
}

export async function renderFloor(
  photo: RoomPhoto,
  outline: Point[],
  surface: Point[] | { projection: FloorProjection },
  signal: AbortSignal,
  prompt?: string,
  protection?: FloorProtection,
): Promise<Blob> {
  const form = await floorPhotoForm(photo, signal);
  if (prompt !== undefined) form.set("prompt", prompt);
  if (protection?.depthMask) form.set("protection", protection.depthMask, "protection.png");
  form.set(
    "plan",
    JSON.stringify({
      width: photo.width,
      height: photo.height,
      outline: outline.map(({ x, y }) => [x, y]),
      ...(protection && {
        protected: protection.regions.map((region) => region.map(({ x, y }) => [x, y])),
      }),
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
      (adjust === "outline" || adjust === "grid" || adjust === "protection") &&
      error instanceof Error
    ) {
      throw new FloorGeometryError(adjust, error.message);
    }
    throw error;
  }
}
