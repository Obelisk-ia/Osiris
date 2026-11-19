import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/dev",
  outputDir: "./test-results/development",
  workers: 1,
  use: {
    baseURL: "http://localhost:3001",
    trace: "retain-on-failure",
  },
  projects: [{ name: "dev-chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev --port 3001",
    url: "http://localhost:3001",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
