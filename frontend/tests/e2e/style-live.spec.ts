import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

async function addStyleMasks(page: Page) {
  async function mark(points: number[][]) {
    const surface = page.getByRole("button", { name: "Add mask point", exact: true });
    const frame = await surface.boundingBox();
    if (!frame) throw new Error("Missing photo surface.");
    for (const [x, y] of points) {
      await surface.click({
        position: { x: (x * frame.width) / 240, y: (y * frame.height) / 180 },
      });
    }
    await page.getByRole("button", { name: "Add region", exact: true }).click();
  }

  await mark([
    [20, 20],
    [220, 20],
    [220, 160],
    [20, 160],
  ]);
  await page.getByLabel("Region type").selectOption("protected");
  await mark([
    [100, 40],
    [155, 40],
    [155, 130],
    [100, 130],
  ]);
}

test("generates through the local Codex choice and keeps the draft after an error", async ({
  page,
}) => {
  await page.route("**/api/style-status", (route) =>
    route.fulfill({ json: { configured: false, codex: "ready" } }),
  );
  const image = await readFile("tests/fixtures/rotated-room.jpg");
  let requests = 0;
  await page.route("**/api/style-render", async (route) => {
    expect(route.request().postData()).toContain('name="provider"\r\n\r\ncodex');
    expect(route.request().postData()).not.toContain('name="candidate"');
    requests += 1;
    await route.fulfill({ status: 504, json: { detail: "Codex generation timed out." } });
  });
  await page.goto("/");
  await page.getByLabel("Room photo").setInputFiles({
    name: "test-room.jpg",
    mimeType: "image/jpeg",
    buffer: image,
  });
  await page.getByRole("button", { name: "Restyle room" }).click();
  await page.getByLabel("Style prompt").fill("Replace the wallpaper.");
  await addStyleMasks(page);
  const generate = page.getByRole("button", { name: "Generate with Codex" });
  await generate.click();
  await expect(page.getByRole("alert")).toContainText("Codex generation timed out.");
  await expect(page.getByLabel("Style prompt")).toHaveValue("Replace the wallpaper.");
  await expect(generate).toBeEnabled();
  expect(requests).toBe(1);
});

test("starts generation from a prompt without an imported candidate", async ({ page }) => {
  await page.route("**/api/style-status", (route) => route.fulfill({ json: { configured: true } }));
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, init) => {
      if (input === "/api/style-render" && init?.body instanceof FormData) {
        document.documentElement.dataset.styleRequest = JSON.stringify({
          hasCandidate: init.body.has("candidate"),
          hasPhoto: init.body.has("photo"),
          plan: JSON.parse(String(init.body.get("plan"))),
        });
      }
      return originalFetch(input, init);
    };
  });

  await page.goto("/");
  const sample = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 180;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#b8966e";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const image = Buffer.from(sample, "base64");
  await page.getByLabel("Room photo").setInputFiles({
    name: "test-room.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page.route("**/api/style-render", (route) =>
    route.fulfill({ contentType: "image/png", body: image }),
  );
  await page.getByRole("button", { name: "Restyle room" }).click();
  await page.getByLabel("Style prompt").fill("Replace the wood panels with linen wallpaper.");
  await page.getByRole("checkbox", { name: "Feather mask edges" }).uncheck();

  await addStyleMasks(page);
  await page.getByRole("button", { name: "Generate with OpenAI" }).click();
  await expect(page.getByRole("link", { name: "Download styled PNG" })).toBeVisible();

  const captured = JSON.parse((await page.locator("html").getAttribute("data-style-request"))!);
  expect(captured).toMatchObject({
    hasCandidate: false,
    hasPhoto: true,
    plan: { prompt: "Replace the wood panels with linen wallpaper.", feather_edges: false },
  });
  expect(captured.plan.editable).toHaveLength(1);
  expect(captured.plan.protected).toHaveLength(1);
  expect(captured.plan.editable[0]).toHaveLength(4);
  expect(captured.plan.protected[0]).toHaveLength(4);
});

for (const input of [
  {
    name: "the sample room",
    width: 1440,
    height: 960,
    filename: "Sample room-prepared.webp",
    signature: [87, 69, 66, 80],
    signatureOffset: 8,
  },
  {
    name: "an uploaded JPEG with rotation metadata",
    fixture: "tests/fixtures/rotated-room.jpg",
    width: 140,
    height: 240,
    filename: "rotated-room-prepared.png",
    signature: [137, 80, 78, 71, 13, 10, 26, 10],
    signatureOffset: 0,
  },
]) {
  test(`downloads a Codex plan and prepared photo for ${input.name} without an API key`, async ({
    page,
  }) => {
    await page.route("**/api/style-status", (route) =>
      route.fulfill({ json: { configured: false } }),
    );
    await page.goto("/");
    if (input.fixture) await page.getByLabel("Room photo").setInputFiles(input.fixture);
    await page.getByRole("button", { name: "Restyle room" }).click();
    await page.getByLabel("Style prompt").fill("Replace the panels with wallpaper.");
    await page.getByRole("checkbox", { name: "Feather mask edges" }).uncheck();

    const exportPlan = page.getByRole("button", { name: "Download Codex plan" });
    await expect(exportPlan).toBeDisabled();
    await addStyleMasks(page);
    await expect(page.getByRole("button", { name: "Generate with OpenAI" })).toBeDisabled();

    const planDownload = page.waitForEvent("download");
    await exportPlan.click();
    const planFile = await planDownload;
    const plan = JSON.parse(await readFile(await planFile.path(), "utf8"));

    const photoDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download prepared photo" }).click();
    const photo = await photoDownload;
    const bytes = await readFile(await photo.path());

    expect(photo.suggestedFilename()).toBe(input.filename);
    expect(
      bytes.subarray(input.signatureOffset, input.signatureOffset + input.signature.length),
    ).toEqual(Buffer.from(input.signature));
    if (input.fixture) {
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([input.width, input.height]);
    }
    expect(plan).toMatchObject({
      width: input.width,
      height: input.height,
      prompt: "Replace the panels with wallpaper.",
      feather_edges: false,
      source_sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(plan.editable).toHaveLength(1);
    expect(plan.protected).toHaveLength(1);
    expect(plan.editable[0]).toHaveLength(4);
    expect(plan.protected[0]).toHaveLength(4);
  });
}

for (const state of ["missing", "unavailable"] as const) {
  test(`rechecks generation after ${state} setup without requiring a new draft`, async ({
    page,
  }) => {
    let calls = 0;
    await page.route("**/api/style-status", (route) => {
      calls++;
      if (calls === 1 && state === "unavailable") return route.fulfill({ status: 503 });
      return route.fulfill({ json: { configured: calls > 1 } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Restyle room" }).click();
    await page.getByLabel("Style prompt").fill("Replace the panels with wallpaper.");
    await addStyleMasks(page);
    const generate = page.getByRole("button", { name: "Generate with OpenAI" });
    await expect(generate).toBeDisabled();

    await page.getByRole("button", { name: "Check generation setup again" }).click();
    await expect(generate).toBeEnabled();
    await expect(page.getByLabel("Style prompt")).toHaveValue("Replace the panels with wallpaper.");
  });
}
