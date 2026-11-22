import { expect, test, type Locator } from "@playwright/test";

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected a visible element");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function photoPosition(point: Locator, photo: Locator) {
  const box = await photo.boundingBox();
  if (!box) throw new Error("Expected a visible photo");
  const marker = await center(point);
  return { x: (marker.x - box.x) / box.width, y: (marker.y - box.y) / box.height };
}

test("opens an editable sample and undoes an entire drag", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Room editor" })).toBeVisible();
  const photo = page.getByRole("img", { name: "Sample room" });
  await expect(photo).toBeVisible();
  const point = page.getByRole("button", { name: "Floor point 2" });
  const start = await center(point);
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeDisabled();

  await page.mouse.move(start.x + 5, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 45, start.y - 20, { steps: 5 });
  await page.mouse.up();
  const moved = await center(point);
  expect(moved.x - start.x).toBeCloseTo(40, 0);
  expect(moved.y - start.y).toBeCloseTo(-20, 0);

  await undo.click();
  const restored = await center(point);
  expect(restored.x).toBeCloseTo(start.x);
  expect(restored.y).toBeCloseTo(start.y);
  await expect(undo).toBeDisabled();
});

test("opens an EXIF-rotated JPG, edits in image coordinates, and preserves work after an invalid import", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("img", { name: "Sample room" })).toBeVisible();
  const httpRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http")) httpRequests.push(request.url());
  });

  const picker = page.getByLabel("Room photo");
  const [dialog] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Open photo" }).click(),
  ]);
  await dialog.setFiles("tests/fixtures/rotated-room.jpg");
  const photo = page.getByRole("img", { name: "rotated-room.jpg" });
  await expect(photo).toBeVisible();
  await expect(page.getByText("140 × 240 px")).toBeVisible();
  const colors = await photo.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return {
      left: context.getImageData(10, 120, 1, 1).data[0],
      right: context.getImageData(130, 120, 1, 1).data[0],
    };
  });
  expect(colors.left).toBeLessThan(170);
  expect(colors.right).toBeGreaterThan(200);
  await expect(page.getByRole("button", { name: "Compare sample finishes" })).toHaveCount(0);

  const addPoint = page.getByRole("button", { name: "Add floor point" });
  const size = await addPoint.boundingBox();
  if (!size) throw new Error("Expected an editable photo");
  await addPoint.click({ position: { x: size.width * 0.3, y: size.height * 0.65 } });
  const point = page.getByRole("button", { name: "Floor point 1" });
  const added = await photoPosition(point, photo);
  expect(added.x).toBeCloseTo(0.3, 1);
  expect(added.y).toBeCloseTo(0.65, 1);

  await addPoint.press("Tab");
  await expect(point).toBeFocused();
  await expect(point).toHaveCSS("outline-style", "solid");
  await point.press("Shift+ArrowRight");
  const moved = await photoPosition(point, photo);
  expect(moved.x - added.x).toBeCloseTo(10 / 140, 2);

  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const resized = await photoPosition(point, photo);
  expect(resized.x).toBeCloseTo(moved.x, 3);
  expect(resized.y).toBeCloseTo(moved.y, 3);

  await picker.setInputFiles({
    name: "bad.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "This photo could not be opened. Try another JPG or PNG.",
  );
  await expect(photo).toBeVisible();
  await expect(point).toBeVisible();
  expect(httpRequests).toEqual([]);

  await page.getByRole("button", { name: "Undo" }).click();
  expect((await photoPosition(point, photo)).x).toBeCloseTo(added.x, 3);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(point).toHaveCount(0);

  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await picker.setInputFiles({
    name: "room.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.getByRole("img", { name: "room.png" })).toBeVisible();
  await expect(page.getByText("64 × 36 px")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Open sample room" }).press("Enter");
  await expect(page.getByRole("img", { name: "Sample room" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Room editor" })).toBeFocused();
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`compares aligned sample finishes at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const point = page.getByRole("button", { name: "Floor point 2" });
    await point.press("Shift+ArrowLeft");
    const placed = await point.evaluate((element) => element.style.left);
    await page.getByRole("button", { name: "Compare sample finishes" }).click();
    const slider = page.getByRole("slider", { name: "Before and after" });
    const layers = page.locator(".photo-layer");
    await expect(slider).toBeFocused();
    await expect(slider).toHaveValue("50");
    await expect(layers).toHaveCount(2);
    expect(await layers.nth(1).boundingBox()).toEqual(await layers.nth(0).boundingBox());

    // A known wall patch is identical. A floor patch proves the two assets differ.
    const patches = await layers.evaluateAll(async (images: HTMLImageElement[]) => {
      return Promise.all(
        images.map(async (image) => {
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          return {
            wall: Array.from(context.getImageData(700, 500, 4, 4).data),
            floor: Array.from(context.getImageData(700, 850, 4, 4).data),
          };
        }),
      );
    });
    expect(patches[0].wall).toEqual(patches[1].wall);
    expect(patches[0].floor).not.toEqual(patches[1].floor);

    await slider.press("End");
    await expect(slider).toHaveValue("100");
    await expect(layers.nth(1)).toHaveCSS("clip-path", "inset(0px 0px 0px 100%)");
    await slider.press("Home");
    await expect(slider).toHaveValue("0");
    await expect(layers.nth(1)).toHaveCSS("clip-path", "inset(0px 0px 0px 0%)");
    await slider.press("ArrowRight");
    await expect(slider).toHaveValue("1");

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    await page.getByRole("button", { name: "Back to outline" }).click();
    await expect(point).toBeVisible();
    await expect(page.getByRole("button", { name: "Compare sample finishes" })).toBeFocused();
    expect(await point.evaluate((element) => element.style.left)).toBe(placed);
    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  });
}

test("identical layers show the same image at both ends of the slider", async ({ page }) => {
  await page.route("**/room-oak.webp", (route) =>
    route.fulfill({ path: "src/assets/room-original.webp", contentType: "image/webp" }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Compare sample finishes" }).click();
  const slider = page.getByRole("slider", { name: "Before and after" });
  const image = page.locator(".photo-frame");
  await image
    .locator("img")
    .evaluateAll((layers) =>
      Promise.all(layers.map((layer) => (layer as HTMLImageElement).decode())),
    );
  await slider.press("End");
  const original = await image.screenshot();
  await slider.press("Home");
  expect(await image.screenshot()).toEqual(original);
});

test("keeps a focused point visible while moving it across a zoomed viewport edge", async ({
  page,
}) => {
  await page.goto("/");
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await zoomIn.click();
  await zoomIn.click();
  await zoomIn.click();
  const point = page.getByRole("button", { name: "Floor point 3" });
  await point.focus();
  await point.evaluate((element) => {
    const viewport = element.closest(".photo-scroll")!;
    const gap = viewport.getBoundingClientRect().right - element.getBoundingClientRect().right;
    viewport.scrollLeft -= gap - 2;
  });
  await point.press("Shift+ArrowRight");
  await expect
    .poll(
      () =>
        point.evaluate((element) => {
          const viewport = element.closest(".photo-scroll")!;
          return viewport.getBoundingClientRect().right - element.getBoundingClientRect().right;
        }),
      { timeout: 1_000 },
    )
    .toBeGreaterThanOrEqual(0);
  await expect(point).toBeFocused();
});
