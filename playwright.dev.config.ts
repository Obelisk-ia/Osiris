import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.OSIRIS_TEST_PORT ?? "3001");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("OSIRIS_TEST_PORT must be a valid local port.");
}
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/dev",
  outputDir: "./test-results/development",
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "dev-chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
