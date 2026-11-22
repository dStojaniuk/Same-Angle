import { expect, test } from "@playwright/test";

test("undoes and redoes changes to the perspective grid", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Adjust perspective grid" }).click();
  const corner = page.getByRole("button", { name: "Grid corner 1" });
  const position = () => corner.evaluate((element) => element.style.left);
  const original = await position();
  await corner.press("Shift+ArrowRight");
  const moved = await position();
  expect(moved).not.toBe(original);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeEnabled({ timeout: 1_000 });
  await undo.click();
  expect(await position()).toBe(original);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect(await position()).toBe(moved);
  await page.getByRole("button", { name: "Reset grid" }).click();
  expect(await position()).toBe(original);
  await page.keyboard.press("Control+z");
  expect(await position()).toBe(moved);
  await page.keyboard.press("Control+Shift+z");
  expect(await position()).toBe(original);
  await corner.press("Shift+ArrowRight");
  await page.getByRole("button", { name: "Back to outline" }).click();
  await page.getByRole("button", { name: "Add floor point" }).press("Enter");
  await page.getByRole("button", { name: "Reset outline" }).click();
  await expect(page.getByRole("button", { name: "Floor point 7" })).toHaveCount(0);
  await page.getByRole("button", { name: "Adjust perspective grid" }).click();
  expect(await position()).toBe(moved);
});

test("restores a local project with its original photo and authored floor plan after reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Room photo").setInputFiles("tests/fixtures/rotated-room.jpg");
  const photo = page.getByRole("img", { name: "rotated-room.jpg" });
  await expect(photo).toBeVisible();

  const add = page.getByRole("button", { name: "Add floor point" });
  const size = await add.boundingBox();
  if (!size) throw new Error("Expected an editable photo");
  for (const [x, y] of [
    [0.08, 0.46],
    [0.92, 0.46],
    [0.92, 0.9],
    [0.08, 0.9],
  ]) {
    await add.click({ position: { x: size.width * x, y: size.height * y } });
  }
  await page.getByRole("button", { name: "Adjust perspective grid" }).click();
  const corner = page.getByRole("button", { name: "Grid corner 1" });
  await corner.press("Shift+ArrowRight");
  const x = await corner.evaluate((element) => element.style.left);
  await expect(page.getByText("Saved in this browser")).toBeVisible({ timeout: 1_000 });

  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Room photo").setInputFiles({
    name: "another-room.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.getByRole("img", { name: "another-room.png" })).toBeVisible();
  await expect(page.getByText("Saved in this browser")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Saved projects" }).click();
  await expect(page.getByRole("button", { name: /^another-room.png/ })).toBeVisible();
  await page.getByRole("button", { name: /^rotated-room.jpg/ }).click();
  await expect(photo).toBeVisible();
  await expect(page.getByText("140 × 240 px")).toBeVisible();
  await expect(page.getByRole("button", { name: "Floor point 4" })).toBeVisible();
  await page.getByRole("button", { name: "Adjust perspective grid" }).click();
  expect(await corner.evaluate((element) => element.style.left)).toBe(x);
});

test("pans a zoomed photo without moving its outline and restores deleted points", async ({
  page,
}) => {
  await page.goto("/");
  const point = page.getByRole("button", { name: "Floor point 2" });
  const position = await point.evaluate((element) => element.style.left);
  const pan = page.getByRole("button", { name: "Pan photo" });
  await expect(pan).toBeDisabled();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await pan.click();

  const surface = page.getByRole("button", { name: "Move the photo view" });
  const frame = await surface.boundingBox();
  if (!frame) throw new Error("Expected a visible photo");
  const x = frame.x + Math.min(frame.width / 2, 240);
  const y = frame.y + Math.min(frame.height / 2, 240);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 160, y - 120, { steps: 4 });
  await page.mouse.up();
  const offset = await page
    .locator(".photo-scroll")
    .evaluate((element) => [element.scrollLeft, element.scrollTop]);
  expect(offset.some((distance) => distance > 0)).toBe(true);
  await pan.click();
  expect(await point.evaluate((element) => element.style.left)).toBe(position);
  await page.getByRole("button", { name: "Floor point 6" }).press("Delete");
  await expect(page.getByRole("button", { name: "Floor point 6" })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Floor point 6" })).toBeVisible();
});

test("downloads the Python render and keeps the editor on a failed PNG decode", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Adjust perspective grid" }).click();
  const render = page.getByRole("button", { name: "Render floor" });
  await page.route("**/api/floor-render", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    }),
  );
  await render.click();
  await expect(page.getByRole("alert")).toHaveText(
    "The renderer returned a PNG that could not be opened.",
  );
  await page.unroute("**/api/floor-render");
  await render.click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Sample room-floor.png");
  const stream = await download.createReadStream();
  let signature = Buffer.alloc(0);
  for await (const chunk of stream) {
    signature = Buffer.concat([signature, chunk]);
    if (signature.length >= 8) break;
  }
  expect(signature.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});

test("refuses a decodable WebP labeled as PNG", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Adjust perspective grid" }).click();
  await page.route("**/api/floor-render", (route) =>
    route.fulfill({ contentType: "image/png", path: "src/assets/room-oak.webp" }),
  );
  await page.getByRole("button", { name: "Render floor" }).click();
  await expect(page.getByRole("alert")).toHaveText("The local renderer did not return a PNG.", {
    timeout: 2_000,
  });
  await expect(page.getByRole("link", { name: "Download PNG" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Render floor" })).toBeEnabled();
});

test("refuses a render whose PNG is missing the final chunk", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Adjust perspective grid" }).click();
  await page.route("**/api/floor-render", async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const png = await response.body();
    expect(png.subarray(-8, -4).toString("ascii")).toBe("IEND");

    await route.fulfill({ contentType: "image/png", body: png.subarray(0, -12) });
  });

  await page.getByRole("button", { name: "Render floor" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The renderer returned a PNG that could not be opened.",
    { timeout: 3_000 },
  );
  await expect(page.getByRole("link", { name: "Download PNG" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Render floor" })).toBeEnabled();
});

test("moves a whole outline as one reversible edit", async ({ page }) => {
  await page.goto("/");
  const markers = page.getByRole("button", { name: /^Floor point [0-9]+$/ });
  async function positions() {
    return markers.evaluateAll((elements) =>
      elements.map((element) => Number.parseFloat(element.style.top)),
    );
  }
  const original = await positions();
  const move = page.getByRole("button", { name: "Move outline", exact: true });
  await move.click();
  const surface = page.getByRole("button", { name: "Move the entire outline" });
  const frame = await surface.boundingBox();
  if (!frame) throw new Error("Expected a visible photo");
  const x = frame.x + frame.width / 2;
  const y = frame.y + frame.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 28, { steps: 4 });
  await page.mouse.up();
  await move.click();
  const moved = await positions();
  expect(moved).toHaveLength(original.length);
  const displacement = original[0] - moved[0];
  expect(displacement).toBeGreaterThan(0);
  for (const [index, top] of moved.entries()) {
    expect(original[index] - top).toBeCloseTo(displacement, 4);
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await positions()).toEqual(original);
});

test("reopens the latest saved outline after a conflict and keeps the local draft copy", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByLabel("Room photo").setInputFiles("tests/fixtures/rotated-room.jpg");
  await expect(page.getByText("Saved in this browser")).toBeVisible();

  const stale = await context.newPage();
  await stale.addInitScript(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      const request = add.apply(this, args);
      if (this.name === "photos" && sessionStorage.getItem("test-fail-draft-copy")) {
        this.transaction.abort();
      }

      return request;
    };
  });
  await stale.goto("/");
  await stale.getByRole("button", { name: "Saved projects" }).click();
  const project = stale.getByRole("button", { name: /^rotated-room.jpg/ });
  await expect(project).toBeVisible();

  await page.bringToFront();
  await page.getByRole("button", { name: "Add floor point" }).press("Enter");
  await expect(page.getByRole("button", { name: "Floor point 1" })).toBeVisible();
  await expect(page.getByText("Saved in this browser")).toBeVisible();

  await stale.bringToFront();
  await project.click();
  await expect(stale.getByRole("img", { name: "rotated-room.jpg" })).toBeVisible();
  await expect(stale.getByRole("button", { name: "Floor point 1" })).toBeVisible({
    timeout: 1_000,
  });

  await page.bringToFront();
  const pointX = (element: HTMLElement) => Number.parseFloat(element.style.left);
  const originalPoint = page.getByRole("button", { name: "Floor point 1" });
  await originalPoint.press("Shift+ArrowLeft");
  await expect.poll(() => originalPoint.evaluate(pointX)).toBeLessThan(50);
  const savedX = await originalPoint.evaluate(pointX);
  await expect(page.getByText("Saved in this browser")).toBeVisible();
  await stale.bringToFront();
  await stale.getByRole("button", { name: "Floor point 1" }).press("Shift+ArrowRight");
  await expect(stale.getByText("Unsaved: a newer version was saved in another tab.")).toBeVisible();
  const draftPoint = stale.getByRole("button", { name: "Floor point 1" });
  const localX = await draftPoint.evaluate(pointX);
  expect(localX).toBeGreaterThan(50);

  const openSaved = stale.getByRole("button", { name: "Save draft copy and open saved version" });
  await expect(openSaved).toBeEnabled({ timeout: 3_000 });
  const bounds = await draftPoint.boundingBox();
  if (!bounds) throw new Error("Expected a visible floor point");
  await stale.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await stale.mouse.down();
  await expect(openSaved).toBeDisabled();
  await stale.mouse.up();

  await stale.evaluate(() => sessionStorage.setItem("test-fail-draft-copy", "yes"));
  await openSaved.click();
  await expect(stale.getByRole("alert")).toHaveText(
    "The draft copy could not be saved. Your draft is still here.",
  );
  expect(await draftPoint.evaluate(pointX)).toBe(localX);
  const staleProjects = stale.getByRole("button", { name: "Saved projects" });
  await staleProjects.click();
  await expect(stale.getByRole("button", { name: /\(local draft\)/ })).toHaveCount(0);
  await staleProjects.click();

  await stale.evaluate(() => sessionStorage.removeItem("test-fail-draft-copy"));
  await openSaved.click();
  await expect(stale.getByText("Saved in this browser")).toBeVisible();
  await expect(stale.getByRole("heading", { name: "Room editor" })).toBeFocused();
  expect(await draftPoint.evaluate(pointX)).toBe(savedX);

  // The opened version can save its edits under the original project.
  await draftPoint.press("Shift+ArrowLeft");
  await expect.poll(() => draftPoint.evaluate(pointX)).toBeLessThan(savedX);
  const updatedX = await draftPoint.evaluate(pointX);
  await expect(async () => {
    await page.reload();
    await page.getByRole("button", { name: "Saved projects" }).click();
    await page.getByRole("button", { name: /^rotated-room\.jpg(?! \()/ }).click();
    await expect(page.getByRole("img", { name: "rotated-room.jpg" })).toBeVisible();
    const point = page.getByRole("button", { name: "Floor point 1" });
    expect(await point.evaluate(pointX)).toBe(updatedX);
  }).toPass({ timeout: 5_000 });

  await stale.reload();
  await staleProjects.click();
  await stale.getByRole("button", { name: /^rotated-room.jpg \(local draft\)/ }).click();
  await expect(stale.getByRole("img", { name: "rotated-room.jpg (local draft)" })).toBeVisible();
  expect(await draftPoint.evaluate(pointX)).toBe(localX);
});

test("keeps a failed draft accessible after the project list refreshes", async ({
  page,
  context,
}) => {
  const first = await context.newPage();
  await first.goto("/");
  await first.getByLabel("Room photo").setInputFiles("tests/fixtures/linear-gamma.png");
  await expect(first.getByText("Saved in this browser")).toBeVisible();
  await first.close();

  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    let unavailable = true;
    const browser = window as Window & { enableProjectStorage: () => void };
    browser.enableProjectStorage = () => {
      unavailable = false;
    };
    indexedDB.open = (name, version) => {
      if (unavailable) throw new DOMException("Storage unavailable", "QuotaExceededError");
      return open(name, version);
    };
  });
  await page.goto("/");
  await page.getByLabel("Room photo").setInputFiles("tests/fixtures/rotated-room.jpg");
  await expect(
    page.getByText("Project could not be saved in this browser", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add floor point" }).press("Enter");
  await expect(page.getByRole("button", { name: "Floor point 1" })).toBeVisible();
  await page.getByRole("button", { name: "Open sample room" }).click();
  const projects = page.getByRole("button", { name: "Saved projects" });
  const pending = page.getByRole("button", { name: /^rotated-room.jpg/ });
  await projects.click();
  await expect(page.getByText("Local project storage is unavailable.")).toBeVisible();
  await expect(pending).toContainText("Unsaved in this tab");
  await page.evaluate(() =>
    (window as Window & { enableProjectStorage: () => void }).enableProjectStorage(),
  );
  await projects.click();
  await projects.click();
  await expect(page.getByRole("button", { name: /^linear-gamma.png/ })).toBeVisible();
  await expect(pending).toContainText("Unsaved in this tab");
  await pending.click();
  await expect(page.getByRole("button", { name: "Floor point 1" })).toBeVisible();
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByText("Saved in this browser")).toBeVisible();
});

test("rejects a photo above the render limit before making a project", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Room photo").evaluate((picker: HTMLInputElement) => {
    const selection = new DataTransfer();
    const oversized = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "oversized.png", {
      type: "image/png",
    });
    selection.items.add(oversized);
    picker.files = selection.files;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.getByRole("alert")).toHaveText("Choose a photo of 25 MiB or less.");
  await expect(page.getByRole("img", { name: "Sample room" })).toBeVisible();
  await page.getByRole("button", { name: "Saved projects" }).click();
  await expect(page.getByRole("button", { name: /^oversized.png/ })).toHaveCount(0);
});
