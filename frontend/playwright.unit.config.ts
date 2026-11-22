import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/unit",
  outputDir: "./node_modules/.cache/playwright-unit-results",
});
