import type { Point } from "./outline";
import type { RoomPhoto } from "./photo";
import { readRenderedPng } from "./renderedPhoto";

export const maxStyleRegions = 8;
export const maxStylePrompt = 2000;
export type StyleRegion = { points: Point[]; kind: "editable" | "protected" };

export async function styleProviderConfigured(signal: AbortSignal): Promise<boolean> {
  const response = await fetch("/api/style-status", { signal });
  if (!response.ok) throw new Error("The generation status could not be checked.");

  const status: unknown = await response.json();
  if (
    !status ||
    typeof status !== "object" ||
    !("configured" in status) ||
    typeof status.configured !== "boolean"
  ) {
    throw new Error("The renderer did not return a generation status.");
  }
  return status.configured;
}

async function readWorkingPhoto(photo: RoomPhoto, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(photo.url, { signal });
  if (!response.ok) throw new Error("The prepared photo could not be read.");

  return response.blob();
}

function createStylePlan(
  photo: RoomPhoto,
  prompt: string,
  regions: StyleRegion[],
  featherEdges: boolean,
) {
  const polygons = (kind: StyleRegion["kind"]) =>
    regions
      .filter((region) => region.kind === kind)
      .map(({ points }) => points.map(({ x, y }) => [x, y]));

  return {
    width: photo.width,
    height: photo.height,
    prompt: prompt.trim(),
    editable: polygons("editable"),
    protected: polygons("protected"),
    ...(featherEdges ? {} : { feather_edges: false }),
  };
}

export async function renderStyle(
  photo: RoomPhoto,
  prompt: string,
  regions: StyleRegion[],
  candidate: File | null,
  signal: AbortSignal,
  featherEdges: boolean,
): Promise<Blob> {
  const form = new FormData();
  form.set("photo", await readWorkingPhoto(photo, signal), "room");
  form.set("plan", JSON.stringify(createStylePlan(photo, prompt, regions, featherEdges)));
  if (candidate) form.set("candidate", candidate);

  return readRenderedPng(await fetch("/api/style-render", { method: "POST", body: form, signal }));
}
