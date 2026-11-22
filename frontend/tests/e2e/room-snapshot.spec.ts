import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("downloads the projected bed in each photo’s native dimensions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview a bed" }).click();
  const download = page.getByRole("button", { name: "Download view PNG" });
  await expect(download).toBeEnabled({ timeout: 2_000 });

  for (const [name, width, height, filename] of [
    ["Sample room", 1440, 960, "Sample room-first-view.png"],
    ["rotated-room.jpg", 140, 240, "rotated-room-second-view.png"],
  ] as const) {
    if (name !== "Sample room") {
      await page
        .getByLabel("Second room photo", { exact: true })
        .setInputFiles("tests/fixtures/rotated-room.jpg");
    }
    const original = page.getByRole("img", { name, exact: true });
    await expect(original).toBeVisible();

    const points = await page
      .getByRole("img", { name: "Projected bed" })
      .locator("polygon")
      .first()
      .getAttribute("points");
    if (!points) throw new Error("Missing projected bed");
    const [sumX, sumY, count] = points.split(" ").reduce(
      ([x, y, count], point) => {
        const [px, py] = point.split(",").map(Number);
        return [x + px, y + py, count + 1];
      },
      [0, 0, 0],
    );
    const pixel = { x: Math.round(sumX / count), y: Math.round(sumY / count) };

    const pending = page.waitForEvent("download");
    await download.click();
    const file = await pending;
    const path = await file.path();
    if (!path) throw new Error("Missing PNG download");
    expect(file.suggestedFilename()).toBe(filename);
    const png = await readFile(path);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    const decoded = await original.evaluate(
      async (source: HTMLImageElement, { base64, pixel }) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d")!;
        const colors = (image: CanvasImageSource) => {
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0);
          return {
            bed: [...context.getImageData(pixel.x, pixel.y, 1, 1).data],
            badge: [
              ...context.getImageData(
                bitmap.width > 1000 ? 20 : 8,
                bitmap.width > 1000 ? 20 : 8,
                1,
                1,
              ).data,
            ],
            corner: [...context.getImageData(canvas.width - 1, 0, 1, 1).data],
          };
        };
        return {
          size: [bitmap.width, bitmap.height],
          original: colors(source),
          exported: colors(bitmap),
        };
      },
      { base64: png.toString("base64"), pixel },
    );

    expect(decoded.size).toEqual([width, height]);
    expect(decoded.exported.bed).not.toEqual(decoded.original.bed);
    expect(decoded.exported.badge).not.toEqual(decoded.original.badge);
    expect(decoded.exported.corner).toEqual(decoded.original.corner);
  }
});

test("keeps a single PNG export in progress when switching to the plan", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview a bed" }).click();
  await page.evaluate(() => {
    const hooks = window as Window & { finishPng?: () => void };
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      HTMLCanvasElement.prototype.toBlob = encode;
      encode.call(
        this,
        (blob) => {
          hooks.finishPng = () => callback(blob);
        },
        type,
        quality,
      );
    };
  });

  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download view PNG" }).click();
  await page.waitForFunction(() => "finishPng" in window);
  await page.getByRole("button", { name: "Floor plan" }).click();
  await page.getByRole("button", { name: "First view", exact: true }).click();
  await expect(page.getByRole("button", { name: /Preparing PNG/ })).toBeDisabled({
    timeout: 2_000,
  });

  await page.evaluate(() => (window as Window & { finishPng: () => void }).finishPng());
  expect((await pending).suggestedFilename()).toBe("Sample room-first-view.png");
  await expect(page.getByRole("button", { name: "Download view PNG" })).toBeEnabled();
});

test("explains when a photo is too small for a readable scale label", async ({ page }) => {
  await page.goto("/");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    canvas.getContext("2d")?.fillRect(0, 0, 32, 32);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Room photo", { exact: true }).setInputFiles({
    name: "tiny-room.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.getByRole("img", { name: "tiny-room.png" })).toBeVisible();
  await page.getByRole("button", { name: "Preview a bed" }).click();
  await expect(page.getByRole("button", { name: "Download view PNG" })).toBeDisabled({
    timeout: 2_000,
  });
  await expect(page.getByText(/too small for a readable scale label/)).toBeVisible();
});
