import { expect, test } from "@playwright/test";

test("moves and resizes one bed on the plan and updates both photo views", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview a bed" }).click();
  const top = page.getByRole("img", { name: "Projected bed" }).locator("polygon").first();
  const initialFirst = await top.getAttribute("points");
  await page
    .getByLabel("Second room photo", { exact: true })
    .setInputFiles("tests/fixtures/rotated-room.jpg");
  await expect(page.getByRole("img", { name: "rotated-room.jpg" })).toBeVisible();
  const initialSecond = await top.getAttribute("points");

  const openPlan = page.getByRole("button", { name: "Floor plan" });
  await expect(openPlan).toBeVisible({ timeout: 2_000 });
  await openPlan.click();
  const move = page.getByRole("button", { name: "Position bed on the plan" });
  await expect(move).toBeFocused();
  const bed = page.getByRole("img", { name: "Top-down room plan" }).locator(".plan-bed");
  await expect(bed).toHaveAttribute("width", "1.6");
  const width = page.getByRole("spinbutton", { name: "Bed width (m)" });
  await width.fill("1.8");
  await width.press("Enter");
  await expect(bed).toHaveAttribute("width", "1.8");

  await page.getByRole("button", { name: "Second view", exact: true }).click();
  await expect(top).not.toHaveAttribute("points", initialSecond!);
  await page.getByRole("button", { name: "First view", exact: true }).click();
  await expect(top).not.toHaveAttribute("points", initialFirst!);
  await openPlan.click();

  const start = await bed.getAttribute("x");
  await move.press("ArrowRight");
  await expect(bed).not.toHaveAttribute("x", start!);
  await page.getByRole("button", { name: "Undo layout change" }).click();
  await expect(bed).toHaveAttribute("x", start!);
  await page.getByRole("button", { name: "Redo layout change" }).click();
  await expect(bed).not.toHaveAttribute("x", start!);
  await page.getByRole("button", { name: "Undo layout change" }).click();

  const plan = page.getByRole("img", { name: "Top-down room plan" });
  await plan.scrollIntoViewIfNeeded();
  const screen = await plan.evaluate((svg: SVGSVGElement) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error("Missing plan transform");
    const result = new DOMPoint(0.25, 4.5).matrixTransform(matrix);
    return { x: result.x, y: result.y };
  });
  await page.mouse.click(screen.x, screen.y);
  const x = page.getByRole("spinbutton", { name: "Bed center X (m)" });
  const z = page.getByRole("spinbutton", { name: "Bed center Z (m)" });
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(0.25, 1);
  await expect.poll(async () => Number(await z.inputValue())).toBeCloseTo(4.5, 1);

  const roomWidth = page.getByRole("spinbutton", { name: "Room width (m)" });
  await roomWidth.fill("1.5");
  await roomWidth.press("Enter");
  await expect(page.getByText("The bed crosses the room boundary.")).toBeVisible();
  await page.getByRole("button", { name: "Undo layout change" }).click();
  await expect(page.getByText("The bed crosses the room boundary.")).toHaveCount(0);

  await page.getByRole("button", { name: "Second view", exact: true }).click();
  await expect(top).not.toHaveAttribute("points", initialSecond!);
  await page.getByRole("button", { name: "First view", exact: true }).click();
  await expect(top).not.toHaveAttribute("points", initialFirst!);
});

test("keeps the bed visible in the plan even after it moves past a wall", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview a bed" }).click();
  await page.getByRole("button", { name: "Floor plan" }).click();
  const depth = page.getByRole("spinbutton", { name: "Bed center Z (m)" });
  await depth.fill("12");
  await depth.press("Enter");
  await expect(page.getByText("The bed crosses the room boundary.")).toBeVisible();

  const plan = page.getByRole("img", { name: "Top-down room plan" });
  const diagram = await plan.boundingBox();
  const bed = await plan.locator(".plan-bed").boundingBox();
  if (!diagram || !bed) throw new Error("Missing room or bed geometry");
  expect(bed.y + bed.height).toBeLessThanOrEqual(diagram.y + diagram.height);

  await page.getByRole("button", { name: "Undo layout change" }).click();
  await expect(depth).toHaveValue("3.8");
});

test("keeps layout redo after resetting a camera with the default bed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview a bed" }).click();
  const openPlan = page.getByRole("button", { name: "Floor plan" });
  await openPlan.click();

  const width = page.getByRole("spinbutton", { name: "Room width (m)" });
  await width.fill("3.4");
  await width.press("Enter");
  await page.getByRole("button", { name: "Undo layout change" }).click();
  await expect(width).toHaveValue("3.2");

  await page.getByRole("button", { name: "First view", exact: true }).click();
  await page.getByRole("slider", { name: "Horizontal field of view" }).press("Home");
  await page.getByRole("button", { name: "Reset preview" }).click();
  await openPlan.click();

  await page.getByRole("button", { name: "Redo layout change" }).click();
  await expect(width).toHaveValue("3.4");
});
