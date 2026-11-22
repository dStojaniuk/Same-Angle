import { defineConfig } from "@playwright/test";

const url = "http://127.0.0.1:4182";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: url },
  webServer: [
    { command: "bun run dev", cwd: "../backend", url: "http://127.0.0.1:8765/api/health" },
    { command: "bun run dev --host 127.0.0.1 --port 4182 --strictPort", url },
  ],
});
