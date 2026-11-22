import { expect, test } from "@playwright/test";

const photos = [
  { name: "grayscale-16bit.png", protectedPixel: [128, 128, 128, 255] },
  { name: "linear-gamma.png", protectedPixel: [188, 188, 188, 255] },
  { name: "animated-room.png", protectedPixel: [255, 0, 0, 255], animated: true },
  { name: "animated-room-poster.png", protectedPixel: [0, 144, 0, 255], animated: true },
];

for (const { name, protectedPixel, animated } of photos) {
  test(`keeps protected pixels identical when rendering ${name}`, async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Room photo").setInputFiles(`tests/fixtures/${name}`);
    await expect(page.getByRole("img", { name })).toBeVisible();
    const addPoint = page.getByRole("button", { name: "Add floor point" });
    const bounds = await addPoint.boundingBox();
    if (!bounds) throw new Error("Expected an editable photo");
    for (const [x, y] of [
      [0.08, 0.5],
      [0.92, 0.5],
      [0.92, 0.9],
      [0.08, 0.9],
    ]) {
      await addPoint.click({ position: { x: bounds.width * x, y: bounds.height * y } });
    }

    await page.getByRole("button", { name: "Adjust perspective grid" }).click();
    await page.getByRole("button", { name: "Render floor" }).click();
    await expect(page.getByRole("slider", { name: "Before and after" })).toBeVisible();

    const [before, after] = await page
      .locator(".photo-layer")
      .evaluateAll(async (layers: HTMLImageElement[]) => {
        return Promise.all(
          layers.map(async (layer) => {
            await layer.decode();
            const canvas = document.createElement("canvas");
            canvas.width = layer.naturalWidth;
            canvas.height = layer.naturalHeight;
            const context = canvas.getContext("2d")!;
            context.drawImage(layer, 0, 0);
            const outside = Array.from(context.getImageData(0, 0, canvas.width, 30).data);
            const inside = Array.from(context.getImageData(10, 40, 40, 14).data);
            const bytes = await (await fetch(layer.src)).arrayBuffer();
            const chunks = new DataView(bytes);
            let isAnimated = false;
            for (
              let offset = 8;
              offset + 12 <= bytes.byteLength;
              offset += chunks.getUint32(offset) + 12
            ) {
              if (chunks.getUint32(offset + 4) === 0x6163544c) isAnimated = true; // acTL
            }
            return { outside, inside, isAnimated };
          }),
        );
      });
    if (animated) expect(before.isAnimated).toBe(false);
    expect(before.outside.slice(0, 4)).toEqual(protectedPixel);
    expect(Buffer.from(after.outside).equals(Buffer.from(before.outside))).toBe(true);
    expect(Buffer.from(after.inside).equals(Buffer.from(before.inside))).toBe(false);
  });
}
