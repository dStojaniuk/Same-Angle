import oak from "./assets/room-oak.webp";
import original from "./assets/room-original.webp";
import type { PhotoSize, Point } from "./outline";

export type RoomPhoto = PhotoSize & {
  name: string;
  // The editor and renderer share this image; the original upload is stored separately.
  url: string;
  comparisonUrl?: string;
  outline: Point[];
};

export const sampleRoom: RoomPhoto = {
  name: "Sample room",
  url: original,
  comparisonUrl: oak,
  width: 1440,
  height: 960,
  outline: [
    { x: 0, y: 784 },
    { x: 274, y: 651 },
    { x: 1137, y: 653 },
    { x: 1440, y: 836 },
    { x: 1440, y: 960 },
    { x: 0, y: 960 },
  ],
};

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const jpegSignature = [255, 216, 255];
const pngImageData = 0x49444154; // IDAT
const pngAnimationChunks = new Set([0x6163544c, 0x6663544c, 0x66644154]); // acTL, fcTL, fdAT

export async function readPhotoFormat(file: Blob): Promise<"png" | "jpeg" | undefined> {
  const bytes = new Uint8Array(await file.slice(0, pngSignature.length).arrayBuffer());
  if (pngSignature.every((byte, index) => bytes[index] === byte)) return "png";
  if (jpegSignature.every((byte, index) => bytes[index] === byte)) return "jpeg";
}

async function readPngDefaultImage(file: Blob): Promise<Blob> {
  const bytes = new DataView(await file.arrayBuffer());
  const parts: Blob[] = [];
  let retainedFrom = 0;
  for (let offset = pngSignature.length; offset + 12 <= bytes.byteLength;) {
    const type = bytes.getUint32(offset + 4);
    const end = offset + 12 + bytes.getUint32(offset);
    if (end > bytes.byteLength) return file;
    // APNG declares animation before IDAT. IDAT always contains the default image.
    if (type === pngImageData && retainedFrom === 0) return file;
    if (pngAnimationChunks.has(type)) {
      if (retainedFrom < offset) parts.push(file.slice(retainedFrom, offset));
      retainedFrom = end;
    }
    offset = end;
  }
  if (retainedFrom === 0) return file;
  return new Blob([...parts, file.slice(retainedFrom)], { type: "image/png" });
}

export async function openRoomPhoto(file: Blob, name: string, isNew: boolean): Promise<RoomPhoto> {
  if (isNew && file.size > 25 * 1024 * 1024) throw new Error("Choose a photo of 25 MiB or less.");
  const format = await readPhotoFormat(file);
  if (!format) throw new Error("Choose a JPG or PNG image.");

  const url = URL.createObjectURL(format === "png" ? await readPngDefaultImage(file) : file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode().catch(() => {
      throw new Error("This photo could not be opened. Try another JPG or PNG.");
    });
    const { naturalWidth: width, naturalHeight: height } = image;
    if (isNew && width * height > 24_000_000) {
      throw new Error("Choose a photo of 24 megapixels or less.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    try {
      const context = canvas.getContext("2d", { colorSpace: "srgb" });
      const encodeError = "This photo could not be prepared for rendering. Try another JPG or PNG.";
      if (!context) throw new Error(encodeError);
      // Use one oriented, static raster for the editor and Python, including for APNG.
      context.drawImage(image, 0, 0);
      const workingPhoto = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!workingPhoto) throw new Error(encodeError);
      return { name, url: URL.createObjectURL(workingPhoto), width, height, outline: [] };
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
