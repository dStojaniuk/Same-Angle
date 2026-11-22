import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("restores shared geometry and both camera fits from a downloaded scene", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview a bed" }).click();
  const fieldOfView = page.getByRole("slider", { name: "Horizontal field of view" });
  await fieldOfView.press("Home");
  await page
    .getByLabel("Second room photo", { exact: true })
    .setInputFiles("tests/fixtures/rotated-room.jpg");
  await expect(page.getByRole("img", { name: "rotated-room.jpg" })).toBeVisible();
  await fieldOfView.press("End");

  await page.getByRole("button", { name: "Floor plan" }).click();
  const width = page.getByRole("spinbutton", { name: "Bed width (m)" });
  await width.fill("1.8");
  await width.press("Enter");
  const downloadScene = page.getByRole("button", { name: "Download scene" });
  await expect(downloadScene).toBeVisible({ timeout: 2_000 });
  const pending = page.waitForEvent("download");
  await downloadScene.click();
  const file = await pending;
  expect(file.suggestedFilename()).toBe("same-angle-scene.json");
  const path = await file.path();
  if (!path) throw new Error("Missing scene download");
  const scene = JSON.parse(await readFile(path, "utf8"));
  expect(scene).toMatchObject({ format: "same-angle-scene", version: 1 });
  expect(scene.views.map((view: { photo: unknown }) => view.photo)).toMatchObject([
    {
      name: "Sample room",
      width: 1440,
      height: 960,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
    {
      name: "rotated-room.jpg",
      width: 140,
      height: 240,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
  ]);

  await width.fill("1.1");
  await width.press("Enter");
  await page.getByRole("button", { name: "Second view", exact: true }).click();
  await fieldOfView.press("Home");

  const input = page.getByLabel("Room scene file", { exact: true });
  const mismatched = structuredClone(scene);
  mismatched.views[1].photo.name = "not-the-loaded-photo.jpg";
  await input.setInputFiles({
    name: "wrong-scene.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(mismatched)),
  });
  await expect(
    page.getByText("Open the scene’s photos in the same order before loading it."),
  ).toBeVisible();
  await expect(fieldOfView).toHaveValue("35");

  const sameSizePhoto = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 140;
    canvas.height = 240;
    canvas.getContext("2d")?.fillRect(0, 0, 140, 240);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const secondFile = page.getByLabel("Second room photo", { exact: true });
  const oldSource = await page
    .getByRole("img", { name: "rotated-room.jpg", exact: true })
    .getAttribute("src");
  await secondFile.setInputFiles({
    name: "rotated-room.jpg",
    mimeType: "image/png",
    buffer: Buffer.from(sameSizePhoto, "base64"),
  });
  const secondPhoto = page.getByRole("img", { name: "rotated-room.jpg", exact: true });
  await expect(secondPhoto).not.toHaveAttribute("src", oldSource!);
  await input.setInputFiles(path);
  await expect(
    page.getByText("Open the scene’s photos in the same order before loading it."),
  ).toBeVisible({ timeout: 2_000 });
  await expect(fieldOfView).toHaveValue("72");

  const replacementSource = await secondPhoto.getAttribute("src");
  await secondFile.setInputFiles("tests/fixtures/rotated-room.jpg");
  await expect(secondPhoto).not.toHaveAttribute("src", replacementSource!);
  await page.getByRole("button", { name: "First view", exact: true }).click();
  await fieldOfView.press("End");
  await page.getByRole("button", { name: "Second view", exact: true }).click();
  const fractional = structuredClone(scene);
  fractional.views[1].camera.fieldOfView = 90.5;
  await input.setInputFiles({
    name: "fractional-scene.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fractional)),
  });
  await expect(page.getByText(/scene contains .*camera settings/)).toBeVisible({ timeout: 2_000 });
  await expect(fieldOfView).toHaveValue("72");
  await input.setInputFiles(path);
  await expect(fieldOfView).toHaveValue("110");
  await page.getByRole("button", { name: "First view", exact: true }).click();
  await expect(fieldOfView).toHaveValue("35");
  await page.getByRole("button", { name: "Floor plan" }).click();
  await expect(width).toHaveValue("1.8");
});

test("rejects a scene read when the second photo is being replaced", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview a bed" }).click();
  const secondFile = page.getByLabel("Second room photo", { exact: true });
  const secondPhoto = page.getByRole("img", { name: "rotated-room.jpg", exact: true });
  await secondFile.setInputFiles("tests/fixtures/rotated-room.jpg");
  await expect(secondPhoto).toBeVisible();

  const fieldOfView = page.getByRole("slider", { name: "Horizontal field of view" });
  await fieldOfView.press("End");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download scene" }).click();
  const path = await (await pending).path();
  if (!path) throw new Error("Missing scene download");
  const scene = await readFile(path);
  await fieldOfView.press("Home");

  await page.evaluate(() => {
    const hooks = window as Window & { finishScene?: () => void; finishPhoto?: () => void };
    const encode = HTMLCanvasElement.prototype.toBlob;
    const read = Blob.prototype.text;
    Blob.prototype.text = function () {
      const result = read.call(this);
      if (!(this instanceof File) || this.name !== "held-scene.json") return result;
      return new Promise((resolve) => {
        hooks.finishScene = () => resolve(result);
      });
    };
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      HTMLCanvasElement.prototype.toBlob = encode;
      encode.call(
        this,
        (blob) => {
          hooks.finishPhoto = () => callback(blob);
        },
        type,
        quality,
      );
    };
  });

  await page.getByLabel("Room scene file", { exact: true }).setInputFiles({
    name: "held-scene.json",
    mimeType: "application/json",
    buffer: scene,
  });
  await page.waitForFunction(() => "finishScene" in window);
  await secondFile.setInputFiles("tests/fixtures/rotated-room.jpg");
  await page.waitForFunction(() => "finishPhoto" in window);

  await page.evaluate(() => (window as Window & { finishScene: () => void }).finishScene());
  await expect(page.getByText(/photo to finish opening/)).toBeVisible({ timeout: 2_000 });
  await expect(fieldOfView).toHaveValue("35");

  const oldSource = await secondPhoto.getAttribute("src");
  await page.evaluate(() => (window as Window & { finishPhoto: () => void }).finishPhoto());
  await expect(secondPhoto).not.toHaveAttribute("src", oldSource!);
  await expect(fieldOfView).toHaveValue("72");
});
