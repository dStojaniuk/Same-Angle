import { cameraFields, cameraRange, type CameraSettings } from "./camera";
import { photoSha256, type RoomPhoto } from "./photo";
import {
  bedHeightLimits,
  bedSizeLimits,
  positionLimits,
  roomOriginLimits,
  roomSizeLimits,
  type RoomLayout,
} from "./roomLayout";

type PhotoReference = Pick<RoomPhoto, "name" | "width" | "height"> & { sha256: string };
type SavedView = { photo: PhotoReference; camera: CameraSettings };
export type OpenRoomView = { photo: RoomPhoto; camera: CameraSettings };
export type RoomScene = {
  format: "same-angle-scene";
  version: 1;
  layout: RoomLayout;
  views: SavedView[];
};

const maxSceneBytes = 64 * 1024;

const referenceCache = new WeakMap<RoomPhoto, Promise<PhotoReference>>();

function referenceFor(photo: RoomPhoto): Promise<PhotoReference> {
  const cached = referenceCache.get(photo);
  if (cached) return cached;

  const reference = fingerprint(photo).catch((error: unknown) => {
    referenceCache.delete(photo);
    throw error;
  });
  referenceCache.set(photo, reference);
  return reference;
}

async function fingerprint(photo: RoomPhoto): Promise<PhotoReference> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Scene files require localhost or a secure connection.");
  }

  let source = photo.source;
  if (!source) {
    const response = await fetch(photo.url);
    if (!response.ok) throw new Error("The sample photo could not be opened.");
    source = await response.blob();
  }

  const sha256 = await photoSha256(source);
  return { name: photo.name, width: photo.width, height: photo.height, sha256 };
}

export async function createScene(layout: RoomLayout, views: OpenRoomView[]): Promise<RoomScene> {
  const savedViews: SavedView[] = [];
  for (const { photo, camera } of views) {
    savedViews.push({ photo: await referenceFor(photo), camera });
  }

  return { format: "same-angle-scene", version: 1, layout, views: savedViews };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function within(value: unknown, { min, max }: { min: number; max: number }): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isLayout(value: unknown): value is RoomLayout {
  if (!isRecord(value) || !isRecord(value.room) || !isRecord(value.bed)) return false;
  const { room, bed } = value;
  const { center, size } = bed;

  return (
    within(room.x, roomOriginLimits) &&
    within(room.z, roomOriginLimits) &&
    within(room.width, roomSizeLimits) &&
    within(room.length, roomSizeLimits) &&
    isRecord(center) &&
    within(center.x, positionLimits) &&
    within(center.z, positionLimits) &&
    isRecord(size) &&
    within(size.width, bedSizeLimits) &&
    within(size.length, bedSizeLimits) &&
    within(size.height, bedHeightLimits) &&
    typeof bed.crosswise === "boolean"
  );
}

function isCamera(value: unknown, paired: boolean): value is CameraSettings {
  if (!isRecord(value)) return false;

  return cameraFields.every((key) => {
    const range = cameraRange(key, paired);
    const setting = value[key];
    if (!within(setting, range)) return false;

    const steps = (setting - range.min) / range.step;
    return Math.abs(steps - Math.round(steps)) < 1e-8;
  });
}

export async function readScene(file: Blob, photos: RoomPhoto[]): Promise<RoomScene> {
  if (file.size > maxSceneBytes) throw new Error("Choose a scene file of 64 KiB or less.");

  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("This file is not valid scene JSON.");
  }

  if (!isRecord(data) || data.format !== "same-angle-scene" || data.version !== 1) {
    throw new Error("Choose a Same Angle scene exported by this editor.");
  }
  if (
    !isLayout(data.layout) ||
    !Array.isArray(data.views) ||
    data.views.length < 1 ||
    data.views.length > 2
  ) {
    throw new Error("The scene contains invalid room or bed dimensions.");
  }
  if (data.views.length !== photos.length) {
    throw new Error("Open the scene’s photos in the same order before loading it.");
  }

  const savedViews: unknown[] = data.views;
  const views: SavedView[] = [];
  for (const [index, photo] of photos.entries()) {
    const view = savedViews[index];
    if (
      !isRecord(view) ||
      !isRecord(view.photo) ||
      view.photo.name !== photo.name ||
      view.photo.width !== photo.width ||
      view.photo.height !== photo.height ||
      typeof view.photo.sha256 !== "string" ||
      view.photo.sha256 !== (await referenceFor(photo)).sha256
    ) {
      throw new Error("Open the scene’s photos in the same order before loading it.");
    }
    if (!isCamera(view.camera, photos.length === 2)) {
      throw new Error("The scene contains unsupported camera settings.");
    }

    const camera = view.camera;
    views.push({
      photo: await referenceFor(photo),
      camera: Object.fromEntries(cameraFields.map((key) => [key, camera[key]])) as CameraSettings,
    });
  }

  const { room, bed } = data.layout;
  const layout = {
    room: { x: room.x, z: room.z, width: room.width, length: room.length },
    bed: {
      center: { x: bed.center.x, z: bed.center.z },
      crosswise: bed.crosswise,
      size: { width: bed.size.width, length: bed.size.length, height: bed.size.height },
    },
  };
  return { format: "same-angle-scene", version: 1, layout, views };
}
