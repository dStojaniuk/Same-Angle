import { bedPaint, type ProjectedBedFace } from "./bed";
import type { PhotoSize } from "./outline";
import type { RoomPhoto } from "./photo";

const scaleLabel = "Skala orientacyjna";

export function supportsSnapshotSize({ width, height }: PhotoSize): boolean {
  return width >= 128 && height >= 40;
}

export async function renderRoomSnapshot(
  photo: RoomPhoto,
  faces: ProjectedBedFace[],
  { markScale = true } = {},
): Promise<Blob> {
  const image = new Image();
  image.src = photo.url;
  await image.decode().catch(() => {
    throw new Error("The photo could not be opened for export.");
  });

  if (image.naturalWidth !== photo.width || image.naturalHeight !== photo.height) {
    throw new Error("The source photo changed before export.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = photo.width;
  canvas.height = photo.height;

  try {
    const context = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!context) throw new Error("The browser could not draw the view.");
    context.drawImage(image, 0, 0);

    const pixelScale = Math.min(photo.width, photo.height);
    context.strokeStyle = bedPaint.outline;
    context.lineWidth = Math.max(1, pixelScale / 600);
    context.lineJoin = "round";
    for (const {
      kind,
      points: [first, ...rest],
    } of faces) {
      context.beginPath();
      context.moveTo(first.x, first.y);
      for (const point of rest) context.lineTo(point.x, point.y);
      context.closePath();
      context.fillStyle = bedPaint[kind];
      context.fill();
      context.stroke();
    }

    if (markScale) {
      const fontSize = Math.max(12, pixelScale / 36);
      const padding = fontSize * 0.6;
      context.font = `600 ${fontSize}px system-ui, sans-serif`;
      context.textBaseline = "top";
      const textWidth = Math.min(context.measureText(scaleLabel).width, photo.width - 4 * padding);
      context.fillStyle = "#172a2ce8";
      context.fillRect(padding, padding, textWidth + 2 * padding, fontSize + 2 * padding);
      context.fillStyle = "#fcfdf9";
      context.fillText(scaleLabel, 2 * padding, 2 * padding, textWidth);
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The browser could not encode the view as PNG.");
    return blob;
  } finally {
    canvas.width = canvas.height = 0;
  }
}
