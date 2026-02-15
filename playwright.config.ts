import { defineConfig } from "@playwright/test";

const PLAYWRIGHT_DB_PATH = `${process.cwd()}/data/playwright-ui.db`;

export default defineConfig({
  testDir: "./tests/ui",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01,
    },
  },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    colorScheme: "light",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  webServer: {
    command: `set -a && . ./.env.local && set +a && DATABASE_PATH=${PLAYWRIGHT_DB_PATH} NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 npm run build && mkdir -p .next/standalone/.next && cp -R .next/static .next/standalone/.next/static && cp -R public .next/standalone/public && DATABASE_PATH=${PLAYWRIGHT_DB_PATH} NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 PORT=3000 node .next/standalone/server.js`,
    url: "http://127.0.0.1:3000",
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "mobile-360",
      use: {
        browserName: "chromium",
        viewport: { width: 360, height: 740 },
      },
    },
    {
      name: "tablet-768",
      use: {
        browserName: "chromium",
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "desktop-1440",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
