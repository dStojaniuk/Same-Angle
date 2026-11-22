import { expect, test } from "@playwright/test";

test("changes one bed from either view and keeps each camera independent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview a bed" }).click();
  const bed = page.getByRole("img", { name: "Projected bed" }).locator("polygon").first();
  const fov = page.getByRole("slider", { name: "Horizontal field of view" });

  await fov.press("Home");
  const originalFirst = await bed.getAttribute("points");
  const secondFile = page.getByLabel("Second room photo");
  await expect(secondFile).toBeAttached({ timeout: 2_000 });
  await secondFile.setInputFiles("tests/fixtures/rotated-room.jpg");
  await expect(page.getByRole("img", { name: "rotated-room.jpg" })).toBeVisible();
  await expect(fov).toHaveValue("72");

  const firstView = page.getByRole("button", { name: "First view", exact: true });
  const secondView = page.getByRole("button", { name: "Second view", exact: true });
  const originalSecond = await bed.getAttribute("points");
  await fov.press("End");
  await expect(bed).not.toHaveAttribute("points", originalSecond!);
  const fittedSecond = await bed.getAttribute("points");

  await firstView.click();
  await expect(fov).toHaveValue("35");
  await expect(bed).toHaveAttribute("points", originalFirst!);
  await secondView.click();
  await expect(fov).toHaveValue("110");
  await expect(bed).toHaveAttribute("points", fittedSecond!);

  await page.getByRole("button", { name: "Place bed on the photo" }).press("Shift+ArrowRight");
  await expect(bed).not.toHaveAttribute("points", fittedSecond!);
  await firstView.click();
  await expect(bed).not.toHaveAttribute("points", originalFirst!);

  await page.getByRole("button", { name: "Back to outline" }).click();
  await expect(page.getByRole("img", { name: "Sample room" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Floor point 2" })).toBeVisible();
});

test("keeps the previous second photo and calibration after a rejected replacement", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview a bed" }).click();
  const secondFile = page.getByLabel("Second room photo");
  await secondFile.setInputFiles("tests/fixtures/rotated-room.jpg");
  const secondPhoto = page.getByRole("img", { name: "rotated-room.jpg" });
  await expect(secondPhoto).toBeVisible();

  const fov = page.getByRole("slider", { name: "Horizontal field of view" });
  await fov.press("Home");
  await page.getByRole("button", { name: "Zoom in" }).click();
  const zoom = page.getByRole("button", { name: "Fit photo" });
  await secondFile.setInputFiles({
    name: "invalid.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("Not an image"),
  });

  await expect(page.getByRole("alert")).toHaveText("Choose a JPG or PNG image.");
  await expect(secondPhoto).toBeVisible();
  await expect(zoom).toHaveText("125%");
  await expect(fov).toHaveValue("35");
  await page.getByRole("button", { name: "Reset camera" }).click();
  await expect(fov).toHaveValue("72");
  await page.getByRole("button", { name: "First view", exact: true }).click();
  await expect(page.getByRole("img", { name: "Sample room" })).toBeVisible();
  await expect(fov).toHaveValue("72");
});

for (const leaveView of ["First view", "Back to outline"]) {
  test(`keeps ${leaveView} active while a replacement finishes decoding`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Preview a bed" }).click();
    const secondFile = page.getByLabel("Second room photo");
    const secondPhoto = page.getByRole("img", { name: "rotated-room.jpg" });
    await secondFile.setInputFiles("tests/fixtures/rotated-room.jpg");
    await expect(secondPhoto).toBeVisible();

    const fov = page.getByRole("slider", { name: "Horizontal field of view" });
    await fov.press("Home");

    await page.evaluate(() => {
      const photoDecode = window as Window & { finishPhotoDecode?: () => void };
      const encode = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        HTMLCanvasElement.prototype.toBlob = encode;
        encode.call(
          this,
          (blob) => {
            photoDecode.finishPhotoDecode = () => callback(blob);
          },
          type,
          quality,
        );
      };
    });

    await secondFile.setInputFiles("tests/fixtures/rotated-room.jpg");
    await page.waitForFunction(() => "finishPhotoDecode" in window);
    await page.getByRole("button", { name: leaveView, exact: true }).click();
    if (leaveView === "Back to outline") {
      await page.getByRole("button", { name: "Zoom in" }).click();
    }

    await page.evaluate(async () => {
      const photoDecode = window as Window & { finishPhotoDecode: () => void };
      photoDecode.finishPhotoDecode();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });

    await expect(page.getByRole("img", { name: "Sample room" })).toBeVisible();
    if (leaveView === "Back to outline") {
      await expect(page.getByRole("button", { name: "Fit photo" })).toHaveText("125%");
      await page.getByRole("button", { name: "Preview a bed" }).click();
    }
    await page.getByRole("button", { name: "Second view", exact: true }).click();
    await expect(secondPhoto).toBeVisible();
    await expect(fov).toHaveValue("72");
  });
}
