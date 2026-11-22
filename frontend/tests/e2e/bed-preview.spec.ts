import { expect, test } from "@playwright/test";

test("fits a camera and places a bed without changing the floor draft", async ({ page }) => {
  await page.goto("/");
  const floorPoint = page.getByRole("button", { name: "Floor point 2" });
  await floorPoint.press("Shift+ArrowRight");
  const floorPosition = await floorPoint.evaluate((point) => point.style.left);

  const openPreview = page.getByRole("button", { name: "Preview a bed" });
  await expect(openPreview).toBeVisible({ timeout: 2_000 });
  await openPreview.click();
  await expect(page.getByText("Skala orientacyjna", { exact: true })).toBeVisible();

  const fov = page.getByRole("slider", { name: "Horizontal field of view" });
  const bed = page.getByRole("img", { name: "Projected bed" });
  const top = bed.locator("polygon").first();
  const original = await top.getAttribute("points");
  const centerGuide = bed.locator("line[x1='720'][x2='720']");
  const guideEnd = await centerGuide.getAttribute("y2");
  await fov.press("Home");
  await expect(centerGuide).not.toHaveAttribute("y2", guideEnd!);
  await expect(top).not.toHaveAttribute("points", original!);

  const place = page.getByRole("button", { name: "Place bed on the photo" });
  const frame = await place.boundingBox();
  if (!frame) throw new Error("Expected an editable photo");
  const adjusted = await top.getAttribute("points");
  await place.click({ position: { x: frame.width * 0.6, y: frame.height * 0.8 } });
  await expect(top).not.toHaveAttribute("points", adjusted!);

  const placed = await top.getAttribute("points");
  await place.press("ArrowRight");
  await expect(top).not.toHaveAttribute("points", placed!);

  const moved = await top.getAttribute("points");
  await place.click({ position: { x: frame.width * 0.5, y: frame.height * 0.05 } });
  await expect(page.getByRole("status").filter({ hasText: /below the horizon/ })).toBeVisible();
  await expect(top).toHaveAttribute("points", moved!);

  await page.getByRole("button", { name: "Back to outline" }).click();
  await expect(openPreview).toBeFocused();
  expect(await floorPoint.evaluate((point) => point.style.left)).toBe(floorPosition);
  await openPreview.click();
  await expect(fov).toHaveValue("35");
  await expect(top).toHaveAttribute("points", moved!);

  await page.getByRole("button", { name: "Rotate bed 90°" }).click();
  await expect(top).not.toHaveAttribute("points", moved!);
  await page.getByRole("button", { name: "Reset preview" }).click();
  await expect(top).toHaveAttribute("points", original!);
});

test("opens a fresh bed preview on an uploaded portrait photo", async ({ page }) => {
  await page.goto("/");
  const openPreview = page.getByRole("button", { name: "Preview a bed" });
  await openPreview.click();
  const fov = page.getByRole("slider", { name: "Horizontal field of view" });
  const defaultFov = await fov.inputValue();
  await fov.press("End");

  await page
    .getByLabel("Room photo", { exact: true })
    .setInputFiles("tests/fixtures/rotated-room.jpg");
  await expect(page.getByRole("img", { name: "rotated-room.jpg" })).toBeVisible();
  await openPreview.click();
  await expect(fov).toHaveValue(defaultFov);
  await expect(page.getByRole("img", { name: "Projected bed" })).toBeVisible();
});

test("fits upward tilt and recovers when the bed leaves the photo", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview a bed" }).click();
  const tilt = page.getByRole("slider", { name: "Tilt" });
  const bed = page.getByRole("img", { name: "Projected bed" });

  await tilt.press("Home");
  await expect(tilt).toHaveValue("-45");
  await expect(bed).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /out of view/ })).toBeVisible();

  await page.getByRole("button", { name: "Reset preview" }).click();
  await expect(bed).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /out of view/ })).toHaveCount(0);
});

test("restores an offscreen bed with the keyboard while keeping the fitted pose", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview a bed" }).click();
  const turn = page.getByRole("slider", { name: "Turn" });
  const tilt = page.getByRole("slider", { name: "Tilt" });
  const height = page.getByRole("slider", { name: "Camera height" });
  const place = page.getByRole("button", { name: "Place bed on the photo" });
  const bed = page.getByRole("img", { name: "Projected bed" });

  await turn.press("Home");
  const frame = await place.boundingBox();
  if (!frame) throw new Error("Expected an editable photo");
  await place.click({ position: { x: frame.width * 0.1, y: frame.height * 0.7 } });
  await expect(bed).toBeVisible();

  await turn.press("End");
  for (let step = 9; step < 30; step++) {
    await tilt.press("ArrowRight");
  }
  await height.press("Home");
  await expect(bed).toHaveCount(0);

  await place.press("Enter");
  await expect(bed).toBeVisible({ timeout: 2_000 });
  await expect(turn).toHaveValue("45");
  await expect(tilt).toHaveValue("30");
  await expect(height).toHaveValue("0.8");
});

test("keeps the bed and guides in photo coordinates after zoom and pan", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto("/");
  await page.getByRole("button", { name: "Preview a bed" }).click();
  const bed = page.getByRole("img", { name: "Projected bed" });
  const guide = bed.locator("line[x1='720'][x2='720']");
  const guideEnd = await guide.getAttribute("y2");

  await page.getByRole("button", { name: "Zoom in" }).click();
  const pan = page.getByRole("button", { name: "Pan photo" });
  await pan.click();
  const panSurface = page.getByRole("button", { name: "Move the photo view" });
  await panSurface.press("ArrowRight");
  await panSurface.press("ArrowDown");
  await expect
    .poll(() => page.locator(".photo-scroll").evaluate((photo) => photo.scrollLeft))
    .toBeGreaterThan(0);
  await pan.click();

  const place = page.getByRole("button", { name: "Place bed on the photo" });
  const frame = await place.boundingBox();
  if (!frame) throw new Error("Expected an editable photo");
  const x = frame.x + frame.width * 0.5;
  const y = frame.y + frame.height * 0.68;
  await page.mouse.click(x, y);

  // The near face is symmetric about the center guide when the bed is placed on that guide.
  const near = bed.locator("polygon").nth(1);
  const midpoint = await near.evaluate((face: SVGPolygonElement) => {
    const left = face.points.getItem(0);
    const right = face.points.getItem(1);
    return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  });
  expect(midpoint.x).toBeCloseTo(720, -1);
  expect(midpoint.y).toBeCloseTo(748, -1);
  await expect(guide).toHaveAttribute("y2", guideEnd!);
});

test("moves the keyboard placement point to a thin floor strip at the image edge", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview a bed" }).click();
  const turn = page.getByRole("slider", { name: "Turn" });
  const tilt = page.getByRole("slider", { name: "Tilt" });
  const place = page.getByRole("button", { name: "Place bed on the photo" });
  const bed = page.getByRole("img", { name: "Projected bed" });

  await turn.press("Home");
  const frame = await place.boundingBox();
  if (!frame) throw new Error("Expected an editable photo");
  await place.click({ position: { x: frame.width * 0.1, y: frame.height * 0.7 } });
  await expect(bed).toBeVisible();

  await turn.press("End");
  for (let step = 9; step > -20; step--) {
    await tilt.press("ArrowLeft");
  }
  await expect(bed).toHaveCount(0);

  for (let step = 0; step < 13; step++) {
    await place.press("Shift+ArrowDown");
  }
  await expect(bed).toBeVisible({ timeout: 2_000 });
  await expect(turn).toHaveValue("45");
  await expect(tilt).toHaveValue("-20");
});
