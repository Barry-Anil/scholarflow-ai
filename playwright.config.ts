import path from "node:path";
import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    browserName: "chromium",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.CHROME_EXECUTABLE_PATH ??
        (process.platform === "win32"
          ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
          : undefined),
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      process.env.PLAYWRIGHT_USE_PRODUCTION === "1"
        ? "npm run start:standalone"
        : `npm run dev -- --port ${port}`,
    url: baseURL,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    reuseExistingServer: true,
    timeout: 120_000,
  },
  snapshotPathTemplate: path.join(
    "{testDir}",
    "__screenshots__",
    "{testFilePath}",
    "{arg}{ext}",
  ),
});
