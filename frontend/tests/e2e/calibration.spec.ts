import { expect, test } from "@playwright/test";

test("checks held-out edges and compares one arrangement projected from the fitted camera", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const fetchPhoto = window.fetch;
    window.fetch = (input, init) => {
      if (input === "/api/floor-render" && init?.body instanceof FormData) {
        document.documentElement.dataset.renderPlan = String(init.body.get("plan"));
      }
      return fetchPhoto(input, init);
    };
  });
  await page.goto("/");
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 800;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#30404c";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Room photo").setInputFiles({
    name: "synthetic-room.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await expect(page.getByRole("img", { name: "synthetic-room.png" })).toBeVisible();

  async function clickAt(label: string, [x, y]: number[]) {
    const surface = page.getByRole("button", { name: label, exact: true });
    const frame = await surface.boundingBox();
    if (!frame) throw new Error("Missing photo surface.");
    await surface.click({ position: { x: (x * frame.width) / 1000, y: (y * frame.height) / 800 } });
  }

  for (const point of [
    [200, 530],
    [920, 530],
    [980, 780],
    [150, 780],
  ]) {
    await clickAt("Add floor point", point);
  }
  await page.getByRole("button", { name: "Calibrate and arrange" }).click();
  await expect(
    page
      .getByRole("region", { name: "Calibrated photo" })
      .getByText("Floor outline · Saved in this browser"),
  ).toBeVisible();
  await page.getByLabel("Room width (m)").fill("3.2");

  async function mark(edge: string, a: number[], b: number[]) {
    await page.getByLabel("Room edge").selectOption(edge);
    await clickAt("Mark edge endpoint on photo", a);
    await clickAt("Mark edge endpoint on photo", b);
  }

  await mark("farFloor", [468, 482], [900, 525]);
  await mark("farCeiling", [477, 148], [959, 141]);
  await mark("farLeft", [468, 482], [477, 148]);
  await mark("farRight", [900, 525], [959, 141]);
  await expect(page.getByRole("button", { name: "Fit camera from edges" })).toBeDisabled();

  await mark("leftFloor", [418, 537], [468, 482]);
  await page.getByRole("button", { name: "Fit camera from edges" }).click();
  const fit = page.getByText(/^Fit RMS:/);
  await expect(fit).toBeVisible();
  const score = await fit.textContent();

  await page.getByLabel("Use mark to").selectOption("check");
  await mark("farFloor", [468, 482], [900, 525]);
  await expect(
    page.getByText("choose a segment outside the fitted span.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear selected mark" }).click();
  await mark("rightFloor", [993, 606], [993, 606]);
  await expect(page.getByText("choose a longer check segment.", { exact: false })).toBeVisible();
  await mark("rightFloor", [993, 606], [915, 538]);
  const check = page.getByRole("list", { name: "Independent edge checks" });
  await expect(check).toContainText("Right wall · floor seam:");
  const checkError = (await check.textContent())?.match(/([0-9.]+) px RMS/);
  expect(Number(checkError?.[1])).toBeLessThan(12);
  await expect(fit).toHaveText(score!);

  await page.getByRole("button", { name: "Place the bed" }).click();
  await clickAt("Place bed on the photo", [679, 568]);
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/floor-render" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Render floor and bed" }).click();
  expect((await response).ok()).toBe(true);
  const plan = JSON.parse((await page.locator("html").getAttribute("data-render-plan"))!);
  expect(plan.corners).toBeUndefined();
  expect(plan.projection).toHaveLength(9);

  await expect(page.getByRole("slider", { name: "Before and after" })).toBeVisible();

  const png = page.getByRole("link", { name: "Download arranged PNG" });
  const result = await png.evaluate(async (link: HTMLAnchorElement) => {
    const image = new Image();
    image.src = link.href;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    return {
      size: [image.width, image.height],
      fixed: pixel(50, 100),
      floor: pixel(305, 710),
      bed: pixel(660, 500),
    };
  });
  expect(result.size).toEqual([1000, 800]);
  expect(result.fixed).toEqual([48, 64, 76, 255]);
  expect(result.floor).not.toEqual(result.fixed);
  expect(result.bed).not.toEqual(result.fixed);

  await page.getByRole("button", { name: "Back to calibration" }).click();
  await expect(check).toContainText("Right wall · floor seam:");
  await page.getByRole("button", { name: "Back to floor outline" }).click();
  await page.getByRole("button", { name: "Calibrate and arrange" }).click();
  await expect(check).toContainText("Right wall · floor seam:");
});
