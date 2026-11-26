import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function uploadRoom(page: Page, floor: "trapezoid" | "rectangle" | "none") {
  const png = await page.evaluate((shape) => {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 144;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ddd0ba";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (shape === "rectangle") {
      context.fillStyle = "#793345";
      context.fillRect(22, 84, 150, 60);
    } else if (shape === "trapezoid") {
      context.fillStyle = "#793345";
      context.beginPath();
      context.moveTo(62, 84);
      context.lineTo(132, 84);
      context.lineTo(185, 143);
      context.lineTo(12, 143);
      context.fill();
    }
    return canvas.toDataURL("image/png").split(",")[1];
  }, floor);
  await page.getByLabel("Room photo").setInputFiles({
    name: "test-room.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
}

async function applyOak(page: Page) {
  await page.getByRole("button", { name: "Quick floor edit" }).click();
  await page.getByLabel("Floor prompt").fill("Zmień podłogę na jasny dąb.");
  await page.getByRole("button", { name: "Apply floor edit" }).click();
}

test("includes only approved depth suggestions and manual protection in the PNG", async ({
  page,
}) => {
  await page.goto("/");
  await uploadRoom(page, "trapezoid");
  await page.route("**/api/floor-suggestion", (route) =>
    route.fulfill({
      json: {
        outline: [
          [62, 85],
          [132, 85],
          [185, 143],
          [12, 143],
        ],
        corners: [
          [62, 85],
          [132, 85],
          [185, 143],
          [12, 143],
        ],
      },
    }),
  );
  const mask = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 144;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ff8b26";
    context.fillRect(85, 100, 8, 8);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.route("**/api/floor-depth-hint", (route) =>
    route.fulfill({ contentType: "image/png", body: Buffer.from(mask, "base64") }),
  );
  await applyOak(page);
  await expect(page.getByRole("link", { name: "Download PNG" })).toBeVisible();
  await page.getByRole("button", { name: "Review floor mask" }).click();
  await page.getByRole("button", { name: "Suggest protection with depth" }).click();
  const hint = page.getByRole("checkbox", { name: "Protect the suggested areas" });
  await expect(hint).not.toBeChecked();
  await hint.check();

  const photo = page.getByRole("button", { name: "Add mask point" });
  const frame = (await photo.boundingBox())!;
  for (const [x, y] of [
    [121, 106],
    [130, 106],
    [130, 116],
    [121, 116],
  ]) {
    await photo.click({ position: { x: (x * frame.width) / 192, y: (y * frame.height) / 144 } });
  }
  await page.getByRole("button", { name: "Add protected area" }).click();
  await page.getByRole("button", { name: "Use mask" }).click();
  await page.getByRole("button", { name: "Apply floor edit" }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PNG" }).click();
  const png = await readFile(await (await downloadEvent).path());
  const colors = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return [
      [88, 104],
      [125, 111],
      [100, 124],
    ].map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
  }, png.toString("base64"));
  const floor = [121, 51, 69, 255];
  expect(colors[0]).toEqual(floor);
  expect(colors[1]).toEqual(floor);
  expect(colors[2]).not.toEqual(floor);
});

test("renders a clear floor from the photo and prompt and can mark the result as a sketch", async ({
  page,
}) => {
  await page.goto("/");
  await uploadRoom(page, "trapezoid");
  await applyOak(page);
  await expect(page.getByRole("slider", { name: "Before and after" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download PNG" })).toBeVisible();

  const mark = page.getByRole("button", { name: "Mark an edge" });
  await page.getByRole("button", { name: "Zoom in" }).click();
  const pan = page.getByRole("button", { name: "Pan photo" });
  await pan.click();
  await expect(pan).toHaveAttribute("aria-pressed", "true");
  await mark.focus();
  await page.keyboard.press("Enter");
  await expect(pan).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Mark edge endpoint on photo" })).toBeFocused();
  await page.getByRole("button", { name: "Cancel marking" }).click();
  await expect(mark).toBeFocused();

  await page.getByRole("button", { name: "Zoom out" }).click();
  await mark.click();
  const surface = page.getByRole("button", { name: "Mark edge endpoint on photo" });
  const { width, height } = (await surface.boundingBox())!;
  await surface.click({ position: { x: width / 4, y: height / 3 } });
  await surface.click({ position: { x: width / 2, y: height / 3 } });
  await surface.click({ position: { x: width * 0.75, y: height / 3 } });
  await surface.click({ position: { x: width / 4, y: height / 3 } });
  await surface.click({ position: { x: width / 2, y: height * 0.45 } });
  await surface.click({ position: { x: width * 0.75, y: height / 3 } });
  await expect(mark).toBeFocused();
  await expect(page.getByText("Sketch. A marked edge shifted.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download sketch PNG" })).toBeVisible();
});

test("asks for the floor outline when there is too little evidence", async ({ page }) => {
  await page.goto("/");
  await uploadRoom(page, "none");
  await applyOak(page);
  await expect(page.getByRole("heading", { name: "Outline the floor" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Outline the visible floor around the threshold",
  );
});

test("keeps the outline available for a render when the grid needs manual alignment", async ({
  page,
}) => {
  await page.goto("/");
  await uploadRoom(page, "rectangle");
  await applyOak(page);
  await expect(page.getByRole("heading", { name: "Align the floor grid" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Check the suggested floor");
  await page.getByRole("button", { name: "Render floor", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download PNG" })).toBeVisible();
});

test("keeps an unsupported request in the editor without rendering a different material", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick floor edit" }).click();
  await page.getByLabel("Floor prompt").fill("Paint the walls green");
  await page.getByRole("button", { name: "Apply floor edit" }).click();
  await expect(page.getByRole("alert")).toContainText("Quick floor currently supports light oak");
  await expect(page.getByLabel("Floor prompt")).toHaveValue("Paint the walls green");
  await expect(page.getByRole("slider", { name: "Before and after" })).toHaveCount(0);
});

test("recovers an existing grid that passes the editor check but crosses the horizon", async ({
  page,
  browserName,
}) => {
  await page.goto("/");
  await page.getByLabel("Room photo").setInputFiles("tests/fixtures/rotated-room.jpg");
  await expect(page.getByRole("img", { name: "rotated-room.jpg" })).toBeVisible();
  const photo = page.getByRole("button", { name: "Add floor point" });
  const frame = await photo.boundingBox();
  if (!frame) throw new Error("Expected an editable photo");
  for (const [x, y] of [
    [0.05, 0.1],
    [0.94, 0.1],
    [0.94, 0.97],
    [0.05, 0.97],
  ]) {
    await photo.click({ position: { x: x * frame.width, y: y * frame.height } });
  }
  await expect(page.getByRole("button", { name: "Floor point 4" })).toBeVisible();

  const suggestions: string[] = [];
  await page.route("**/api/floor-suggestion", (route) => {
    suggestions.push(route.request().url());
    return route.fulfill({
      status: 422,
      json: { detail: "The configured Fast-SCNN model could not be opened." },
    });
  });
  await applyOak(page);
  const alignment = page.getByRole("heading", { name: "Align the floor grid" });
  await expect(alignment).toBeFocused();
  await expect(page.getByRole("alert")).toContainText("within your existing outline");

  for (const [index, [x, y]] of [
    [0.36, 0.56],
    [0.62, 0.56],
    [0.89, 0.9],
    [0.1, 0.9],
  ].entries()) {
    const corner = (await page
      .getByRole("button", { name: `Grid corner ${index + 1}` })
      .boundingBox())!;
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down();
    await page.mouse.move(frame.x + x * frame.width, frame.y + y * frame.height, {
      steps: 4,
    });
    await page.mouse.up();
  }
  const render = page.getByRole("button", { name: "Render floor", exact: true });
  await expect(render).toBeEnabled();
  // Chromium also exercises the IndexedDB round trip before the render.
  if (browserName === "chromium") {
    await expect(page.getByText("Saved in this browser")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Saved projects" }).click();
    await page.getByRole("button", { name: /^rotated-room\.jpg/ }).click();
    await expect(page.getByRole("img", { name: "rotated-room.jpg" })).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Back to outline" }).click();
  }
  const rejected = page.waitForResponse(
    (response) => response.url().endsWith("/api/floor-render") && response.status() === 422,
  );
  await applyOak(page);
  const response = await rejected;
  expect(response.headers()["x-same-angle-floor-adjust"]).toBe("grid");
  await expect(alignment).toBeFocused();
  await expect(page.getByRole("alert")).toContainText("horizon stays outside");

  await page.getByRole("button", { name: "Reset grid" }).click();
  await expect(render).toBeEnabled();
  await render.click();
  await expect(page.getByRole("link", { name: "Download PNG" })).toBeVisible();
  expect(suggestions).toEqual([]);
});

test("quick floor reuses the sample geometry while detection is unavailable", async ({ page }) => {
  await page.route("**/api/floor-suggestion", (route) =>
    route.fulfill({
      status: 422,
      json: { detail: "The configured Fast-SCNN model could not be opened." },
    }),
  );
  await page.goto("/");
  await applyOak(page);

  await expect(page.getByRole("link", { name: "Download PNG" })).toBeVisible();
});
