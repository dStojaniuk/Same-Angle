import { expect, test } from "@playwright/test";

test("finds a project saved in another tab when reopening the list", async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto("/");
  const projects = other.getByRole("button", { name: "Saved projects" });
  await projects.click();
  await expect(other.getByText("Open a photo to start a project.")).toBeVisible();
  await projects.click();

  await page.goto("/");
  await page.getByLabel("Room photo").setInputFiles("tests/fixtures/rotated-room.jpg");
  await expect(page.getByText("Saved in this browser")).toBeVisible();

  await projects.click();
  await other.getByRole("button", { name: /^rotated-room.jpg/ }).click({ timeout: 2_000 });
  await expect(other.getByRole("img", { name: "rotated-room.jpg" })).toBeVisible();
});

test("keeps the warning until the project list can be read again", async ({ page, context }) => {
  const first = await context.newPage();
  await first.goto("/");
  await first.getByLabel("Room photo").setInputFiles("tests/fixtures/rotated-room.jpg");
  await expect(first.getByText("Saved in this browser")).toBeVisible();
  await first.close();

  await page.addInitScript(() => {
    const getAll = IDBObjectStore.prototype.getAll;
    let unavailable = true;
    const browser = window as Window & { enableProjectList: () => void };
    browser.enableProjectList = () => {
      unavailable = false;
    };
    IDBObjectStore.prototype.getAll = function (...args) {
      if (unavailable) throw new DOMException("Project list unavailable", "UnknownError");
      return getAll.apply(this, args);
    };
  });
  await page.goto("/");
  const projects = page.getByRole("button", { name: "Saved projects" });
  const warning = page.getByText("Local project storage is unavailable.");
  await projects.click();
  await expect(warning).toBeVisible();

  await page.getByLabel("Room photo").setInputFiles("tests/fixtures/linear-gamma.png");
  await expect(page.getByText("Saved in this browser")).toBeVisible();
  await projects.click();
  await expect(page.getByRole("button", { name: /^linear-gamma.png/ })).toBeVisible();
  await expect(warning).toBeVisible({ timeout: 2_000 });

  await page.evaluate(() =>
    (window as Window & { enableProjectList: () => void }).enableProjectList(),
  );
  await page.getByRole("button", { name: "Add floor point" }).press("Enter");
  await expect(page.getByRole("button", { name: "Floor point 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^rotated-room.jpg/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^linear-gamma.png/ })).toBeVisible();
  await expect(warning).toBeHidden();
});
