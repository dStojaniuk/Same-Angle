import { expect, test } from "@playwright/test";

test("imports a style edit, protecting a door inside the edit area and the pixels outside it", async ({
  page,
}) => {
  await page.goto("/");
  const images = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    function png(width: number, height: number, color: string) {
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      return canvas.toDataURL("image/png").split(",")[1];
    }
    return { before: png(240, 180, "#483327"), edited: png(120, 90, "#638774") };
  });
  await page.getByLabel("Room photo").setInputFiles({
    name: "synthetic-room.png",
    mimeType: "image/png",
    buffer: Buffer.from(images.before, "base64"),
  });
  await page.getByRole("button", { name: "Restyle room" }).click();
  await page.getByLabel("Style prompt").fill("Use boho materials and a light wood vanity.");
  await page.getByLabel("Import edited photo").setInputFiles({
    name: "synthetic-edit.png",
    mimeType: "image/png",
    buffer: Buffer.from(images.edited, "base64"),
  });
  const apply = page.getByRole("button", { name: "Apply masks to imported image" });
  await expect(apply).toBeDisabled();

  async function mark(points: number[][]) {
    const surface = page.getByRole("button", { name: "Add mask point", exact: true });
    const frame = await surface.boundingBox();
    if (!frame) throw new Error("Missing photo surface.");
    for (const [x, y] of points) {
      await surface.click({
        position: { x: (x * frame.width) / 240, y: (y * frame.height) / 180 },
      });
    }
    await page.getByRole("button", { name: "Add region", exact: true }).click();
  }

  await mark([
    [20, 20],
    [220, 20],
    [220, 160],
    [20, 160],
  ]);
  await expect(apply).toBeDisabled();
  await page.getByLabel("Region type").selectOption("protected");
  await mark([
    [100, 40],
    [155, 40],
    [155, 130],
    [100, 130],
  ]);
  await apply.click();
  const link = page.getByRole("link", { name: "Download styled PNG" });
  await expect(link).toBeVisible();
  await expect(page.getByRole("slider", { name: "Before and after" })).toBeFocused();

  const pixels = await link.evaluate(async (anchor: HTMLAnchorElement) => {
    const img = new Image();
    img.src = anchor.href;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    return {
      size: [canvas.width, canvas.height],
      outside: pixel(6, 6),
      door: pixel(120, 80),
      edit: pixel(66, 120),
    };
  });
  expect(pixels.size).toEqual([240, 180]);
  expect(pixels.outside).toEqual([72, 51, 39, 255]);
  expect(pixels.door).toEqual(pixels.outside);
  expect(pixels.edit).toEqual([99, 135, 116, 255]);
});
