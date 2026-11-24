import { readPhotoFormat } from "./photo";

function isCompletePng(bytes: DataView): boolean {
  const header = 0x49484452; // IHDR
  const imageData = 0x49444154; // IDAT
  const end = 0x49454e44; // IEND
  const firstChunk = 8;
  let hasImageData = false;

  for (let offset = firstChunk; offset + 12 <= bytes.byteLength;) {
    const length = bytes.getUint32(offset);
    const type = bytes.getUint32(offset + 4);
    const next = offset + 12 + length;
    if (next > bytes.byteLength) return false;
    if (offset === firstChunk && (type !== header || length !== 13)) return false;

    if (type === end) {
      return (
        hasImageData &&
        length === 0 &&
        next === bytes.byteLength &&
        bytes.getUint32(offset + 8) === 0xae426082
      );
    }

    if (type === imageData) hasImageData = true;
    offset = next;
  }

  return false;
}

export async function assertRenderResponse(response: Response) {
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null);

    if (
      error &&
      typeof error === "object" &&
      "detail" in error &&
      typeof error.detail === "string"
    ) {
      throw new Error(error.detail);
    }

    throw new Error(
      "The local renderer could not complete the request. Check that Same Angle is running.",
    );
  }
}

export async function readRenderedPng(response: Response): Promise<Blob> {
  await assertRenderResponse(response);
  if (response.headers.get("content-type") !== "image/png") {
    throw new Error("The local renderer did not return a PNG.");
  }

  const result = await response.blob();
  if ((await readPhotoFormat(result)) !== "png") {
    throw new Error("The local renderer did not return a PNG.");
  }
  if (!isCompletePng(new DataView(await result.arrayBuffer()))) {
    throw new Error("The renderer returned a PNG that could not be opened.");
  }

  return result;
}
