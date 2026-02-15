import { defineConfig } from "@playwright/test";

const PLAYWRIGHT_DB_PATH = `${process.cwd()}/data/playwright-ui.db`;
const PLAYWRIGHT_WEB_SERVER_COMMAND = `set -eu;
set -a;
[ -z "\${BLOG_API_KEY:-}" ] && [ -f ./.env.local ] && . ./.env.local;
set +a;
DATABASE_PATH=${PLAYWRIGHT_DB_PATH} NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 npm run build;
STANDALONE_DIR=.next/standalone;
if [ ! -f "$STANDALONE_DIR/server.js" ]; then
  SERVER_PATH="";
  if [ -d "$STANDALONE_DIR/.worktrees" ]; then
    SERVER_PATH=$(find "$STANDALONE_DIR/.worktrees" -mindepth 2 -maxdepth 2 -type f -name server.js | head -n 1);
  fi;
  if [ -z "$SERVER_PATH" ]; then
    echo "standalone server.js not found" >&2;
    exit 1;
  fi;
  STANDALONE_DIR=$(dirname "$SERVER_PATH");
fi;
mkdir -p "$STANDALONE_DIR/.next";
rm -rf "$STANDALONE_DIR/.next/static";
cp -R .next/static "$STANDALONE_DIR/.next/static";
if [ -d public ]; then
  rm -rf "$STANDALONE_DIR/public";
  cp -R public "$STANDALONE_DIR/public";
fi;
DATABASE_PATH=${PLAYWRIGHT_DB_PATH} NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 PORT=3000 node "$STANDALONE_DIR/server.js"`;

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
    command: PLAYWRIGHT_WEB_SERVER_COMMAND,
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
