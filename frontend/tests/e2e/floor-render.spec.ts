import { expect, test } from "@playwright/test";

test("opens an adjustable perspective grid before sending the photo", async ({ page }) => {
  const renders: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/floor-render")) renders.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("img", { name: "Sample room" })).toBeVisible();
  await page.getByRole("button", { name: "Adjust perspective grid" }).click();
  await expect(page.getByRole("heading", { name: "Align the floor grid" })).toBeVisible();
  const corner = page.getByRole("button", { name: "Grid corner 1" });
  await expect(corner).toBeVisible();
  const line = page.locator(".grid-lines line").first();
  const start = await line.getAttribute("x1");
  await corner.press("Shift+ArrowRight");
  await expect(line).not.toHaveAttribute("x1", start!);
  expect(renders).toEqual([]);
});

test("renders the approved outline and grid for an uploaded photo through Python", async ({
  page,
}) => {
  const submittedPlans: string[] = [];
  await page.exposeFunction("recordFloorPlan", (plan: string) => submittedPlans.push(plan));
  await page.addInitScript(() => {
    const browser = window as Window & { recordFloorPlan: (plan: string) => Promise<void> };
    const fetchPhoto = window.fetch;
    window.fetch = (input, init) => {
      if (input === "/api/floor-render" && init?.body instanceof FormData) {
        void browser.recordFloorPlan(String(init.body.get("plan")));
      }
      return fetchPhoto(input, init);
    };
  });
  await page.goto("/");
  await page.getByLabel("Room photo").setInputFiles("tests/fixtures/rotated-room.jpg");
  await expect(page.getByText("140 × 240 px")).toBeVisible();

  const adjust = page.getByRole("button", { name: "Adjust perspective grid" });
  await expect(adjust).toBeDisabled();
  const photo = page.getByRole("button", { name: "Add floor point" });
  const bounds = await photo.boundingBox();
  if (!bounds) throw new Error("Expected an editable photo");
  for (const [x, y] of [
    [0.08, 0.46],
    [0.92, 0.46],
    [0.92, 0.9],
    [0.08, 0.9],
  ]) {
    await photo.click({ position: { x: bounds.width * x, y: bounds.height * y } });
  }
  await adjust.click();
  const corner = page.getByRole("button", { name: "Grid corner 1" });
  await corner.press("Shift+ArrowRight");
  const x = await corner.evaluate((element) =>
    Math.round((Number.parseFloat(element.style.left) / 100) * 140),
  );

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/floor-render") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Render floor" }).click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(await response.text());
  expect(response.headers()["content-type"]).toBe("image/png");
  await expect.poll(() => submittedPlans.length).toBe(1);
  const plan = JSON.parse(submittedPlans[0]);
  expect(plan.width).toBe(140);
  expect(plan.height).toBe(240);
  expect(plan.outline).toHaveLength(4);
  expect(plan.corners[0][0]).toBe(x);

  const slider = page.getByRole("slider", { name: "Before and after" });
  await expect(slider).toBeFocused();
  const decoded = await page
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
          return {
            outside: Array.from(context.getImageData(0, 0, 140, 105).data),
            inside: Array.from(context.getImageData(50, 140, 5, 5).data),
            size: [canvas.width, canvas.height],
          };
        }),
      );
    });
  expect(decoded[1].size).toEqual(decoded[0].size);
  expect(decoded[1].outside).toEqual(decoded[0].outside);
  expect(decoded[1].inside).not.toEqual(decoded[0].inside);
  await slider.press("End");
  await expect(slider).toHaveValue("100");
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await page.getByRole("button", { name: "Adjust grid", exact: true }).click();
  await expect(corner).toBeVisible();
  expect(
    await corner.evaluate((element) =>
      Math.round((Number.parseFloat(element.style.left) / 100) * 140),
    ),
  ).toBe(x);
});

test("keeps the approved grid available when the renderer fails and can retry", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Adjust perspective grid" }).click();
  const corner = page.getByRole("button", { name: "Grid corner 2" });
  const left = await corner.evaluate((element) => element.style.left);
  await page.route("**/api/floor-render", (route) =>
    route.fulfill({ status: 503, json: { detail: "The local renderer is unavailable." } }),
  );
  await page.getByRole("button", { name: "Render floor" }).click();
  await expect(page.getByRole("alert")).toHaveText("The local renderer is unavailable.");
  await expect(corner).toBeEnabled();
  expect(await corner.evaluate((element) => element.style.left)).toBe(left);
  await page.unroute("**/api/floor-render");
  await page.getByRole("button", { name: "Render floor" }).click();
  await expect(page.getByRole("slider", { name: "Before and after" })).toBeVisible();
});

test("the comparison preserves the appearance of protected translucent PNG pixels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 100;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgb(211 81 49 / 50%)";
    context.fillRect(0, 0, 160, 100);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Room photo").setInputFiles({
    name: "translucent.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.getByRole("img", { name: "translucent.png" })).toBeVisible();
  const addPoint = page.getByRole("button", { name: "Add floor point" });
  const image = await addPoint.boundingBox();
  if (!image) throw new Error("Expected an editable photo");
  for (const [x, y] of [
    [0.08, 0.5],
    [0.92, 0.5],
    [0.92, 0.9],
    [0.08, 0.9],
  ]) {
    await addPoint.click({ position: { x: image.width * x, y: image.height * y } });
  }
  await page.getByRole("button", { name: "Adjust perspective grid" }).click();
  await page.getByRole("button", { name: "Render floor" }).click();
  const slider = page.getByRole("slider", { name: "Before and after" });
  await expect(slider).toBeVisible();
  await page
    .locator(".photo-layer")
    .last()
    .evaluate((element: HTMLImageElement) => element.decode());
  const frame = await page.locator(".photo-frame").boundingBox();
  if (!frame) throw new Error("Expected a visible comparison");
  const clip = { x: Math.ceil(frame.x) + 10, y: Math.ceil(frame.y) + 10, width: 100, height: 30 };
  await slider.press("End");
  const original = await page.screenshot({ clip });
  await slider.press("Home");
  const rendered = await page.screenshot({ clip });
  expect(rendered.equals(original)).toBe(true);
});

test("waits for the visible grid gesture to finish before accepting a render", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Adjust perspective grid" }).click();
  const corner = page.getByRole("button", { name: "Grid corner 1" });
  const box = await corner.boundingBox();
  if (!box) throw new Error("Expected a visible grid corner");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const render = page.getByRole("button", { name: "Render floor" });
  await expect(render).toBeEnabled();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y, { steps: 3 });
  await expect(render).toBeDisabled({ timeout: 1_000 });
  await page.mouse.up();
  await expect(render).toBeEnabled();
});

test("stopping an upload keeps the edit and permits a fresh render", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Adjust perspective grid" }).click();
  const render = page.getByRole("button", { name: "Render floor" });
  const held = Promise.withResolvers<void>();
  const received = Promise.withResolvers<void>();
  await page.route("**/api/floor-render", async (route) => {
    received.resolve();
    await held.promise;
    await route.abort().catch(() => undefined);
  });

  try {
    await render.click();
    await received.promise;
    const corner = page.getByRole("button", { name: "Grid corner 1" });
    await expect(corner).toBeDisabled();
    await page.getByRole("button", { name: "Stop waiting" }).click();
    await expect(corner).toBeEnabled();
    await expect(page.getByRole("slider")).toHaveCount(0);
    await expect(render).toBeFocused();
  } finally {
    held.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }

  await render.click();
  await expect(page.getByRole("slider", { name: "Before and after" })).toBeVisible();
});
