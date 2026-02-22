import { defineConfig } from "@playwright/test";
import path from "node:path";

// UI tests require a stable API key for route revalidation. Relying on a local
// `.env.local` is brittle in git-worktree setups (multiple `.env.local` files).
// Prefer an explicit default unless the caller provides one.
const DEFAULT_PLAYWRIGHT_BLOG_API_KEY = "playwright-blog-api-key";
if (!process.env.BLOG_API_KEY && !process.env.API_KEY) {
  process.env.BLOG_API_KEY = DEFAULT_PLAYWRIGHT_BLOG_API_KEY;
}

const PROJECT_ROOT = __dirname;
const PROJECT_ROOT_SHELL = PROJECT_ROOT.replace(/'/g, "'\"'\"'");
const PLAYWRIGHT_DB_PATH = path.join(PROJECT_ROOT, "data", "playwright-ui.db");
if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = PLAYWRIGHT_DB_PATH;
}
const DEFAULT_PLAYWRIGHT_PORT = process.env.CI ? 3000 : 3400;
const PLAYWRIGHT_PORT_RAW = process.env.PLAYWRIGHT_PORT?.trim();
const PLAYWRIGHT_PORT = PLAYWRIGHT_PORT_RAW
  ? Number.parseInt(PLAYWRIGHT_PORT_RAW, 10)
  : DEFAULT_PLAYWRIGHT_PORT;
const PLAYWRIGHT_PORT_NORMALIZED =
  Number.isFinite(PLAYWRIGHT_PORT) && PLAYWRIGHT_PORT > 0
    ? PLAYWRIGHT_PORT
    : DEFAULT_PLAYWRIGHT_PORT;
const PLAYWRIGHT_BASE_URL = `http://127.0.0.1:${PLAYWRIGHT_PORT_NORMALIZED}`;
const PLAYWRIGHT_WEB_SERVER_COMMAND = `set -eu;
cd '${PROJECT_ROOT_SHELL}';
set -a;
[ -z "\${BLOG_API_KEY:-}" ] && [ -f ./.env.local ] && . ./.env.local;
set +a;
ADMIN_USERNAME=\${ADMIN_USERNAME:-admin}
ADMIN_PASSWORD_HASH=\${ADMIN_PASSWORD_HASH:-'$argon2id$v=19$m=19456,t=2,p=1$IKB9DtSF0qPG5/YP8Iv25A$Ia5kZtdBS0EpKzo9eFpjq2zBlBWSayktEzMrUI81WHM'}
ADMIN_SESSION_SECRET=\${ADMIN_SESSION_SECRET:-playwright-admin-session-secret}
ADMIN_TOTP_SECRET_ENCRYPTION_KEY=\${ADMIN_TOTP_SECRET_ENCRYPTION_KEY:-playwright-admin-totp-encryption-secret}
ADMIN_CSRF_SECRET=\${ADMIN_CSRF_SECRET:-playwright-admin-csrf-secret}
ADMIN_TOTP_SECRET=\${ADMIN_TOTP_SECRET:-JBSWY3DPEHPK3PXP}
ADMIN_RECOVERY_CODES=\${ADMIN_RECOVERY_CODES:-RECOVERY-ONE,RECOVERY-TWO}
ADMIN_LOGIN_RATE_LIMIT_MAX=\${ADMIN_LOGIN_RATE_LIMIT_MAX:-200}
ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS=\${ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS:-60000}
ADMIN_VERIFY_RATE_LIMIT_MAX=\${ADMIN_VERIFY_RATE_LIMIT_MAX:-200}
ADMIN_VERIFY_RATE_LIMIT_WINDOW_MS=\${ADMIN_VERIFY_RATE_LIMIT_WINDOW_MS:-60000}
if [ -n "\${PLAYWRIGHT_SKIP_BUILD:-}" ] && [ "\${PLAYWRIGHT_SKIP_BUILD:-}" != "0" ]; then
  echo "[playwright:webServer] skip build (PLAYWRIGHT_SKIP_BUILD=\${PLAYWRIGHT_SKIP_BUILD})" >&2;
else
  echo "[playwright:webServer] running build" >&2;
DATABASE_PATH=${PLAYWRIGHT_DB_PATH} NEXT_PUBLIC_SITE_URL=${PLAYWRIGHT_BASE_URL} \\
ADMIN_USERNAME="$ADMIN_USERNAME" \\
ADMIN_PASSWORD_HASH="$ADMIN_PASSWORD_HASH" \\
ADMIN_SESSION_SECRET="$ADMIN_SESSION_SECRET" \\
ADMIN_TOTP_SECRET_ENCRYPTION_KEY="$ADMIN_TOTP_SECRET_ENCRYPTION_KEY" \\
ADMIN_CSRF_SECRET="$ADMIN_CSRF_SECRET" \\
ADMIN_TOTP_SECRET="$ADMIN_TOTP_SECRET" \\
ADMIN_RECOVERY_CODES="$ADMIN_RECOVERY_CODES" \\
ADMIN_LOGIN_RATE_LIMIT_MAX="$ADMIN_LOGIN_RATE_LIMIT_MAX" \\
ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS="$ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS" \\
ADMIN_VERIFY_RATE_LIMIT_MAX="$ADMIN_VERIFY_RATE_LIMIT_MAX" \\
ADMIN_VERIFY_RATE_LIMIT_WINDOW_MS="$ADMIN_VERIFY_RATE_LIMIT_WINDOW_MS" \\
npm run build;
fi;
STANDALONE_DIR=.next/standalone;
if [ ! -f "$STANDALONE_DIR/server.js" ]; then
  SERVER_PATH="";
  if [ -d "$STANDALONE_DIR/.worktrees" ]; then
    SERVER_PATH=$(find "$STANDALONE_DIR/.worktrees" -mindepth 2 -maxdepth 4 -type f -name server.js | head -n 1);
  fi;
  if [ -z "$SERVER_PATH" ]; then
    echo "standalone server.js not found" >&2;
    exit 1;
  fi;
  STANDALONE_DIR=$(dirname "$SERVER_PATH");
fi;
mkdir -p "$STANDALONE_DIR/.next";
if [ -d .next/static ]; then
  rm -rf "$STANDALONE_DIR/.next/static";
  cp -R .next/static "$STANDALONE_DIR/.next/static";
fi;
if [ -d public ]; then
  rm -rf "$STANDALONE_DIR/public";
  cp -R public "$STANDALONE_DIR/public";
fi;
if [ ! -d "$STANDALONE_DIR/.next/static" ]; then
  echo "standalone .next/static not found (run without PLAYWRIGHT_SKIP_BUILD or prepare the artifact)." >&2;
  exit 1;
fi;
cd "$STANDALONE_DIR";
DATABASE_PATH=${PLAYWRIGHT_DB_PATH} NEXT_PUBLIC_SITE_URL=${PLAYWRIGHT_BASE_URL} PORT=${PLAYWRIGHT_PORT_NORMALIZED} \\
ADMIN_USERNAME="$ADMIN_USERNAME" \\
ADMIN_PASSWORD_HASH="$ADMIN_PASSWORD_HASH" \\
ADMIN_SESSION_SECRET="$ADMIN_SESSION_SECRET" \\
ADMIN_TOTP_SECRET_ENCRYPTION_KEY="$ADMIN_TOTP_SECRET_ENCRYPTION_KEY" \\
ADMIN_CSRF_SECRET="$ADMIN_CSRF_SECRET" \\
ADMIN_TOTP_SECRET="$ADMIN_TOTP_SECRET" \\
ADMIN_RECOVERY_CODES="$ADMIN_RECOVERY_CODES" \\
ADMIN_LOGIN_RATE_LIMIT_MAX="$ADMIN_LOGIN_RATE_LIMIT_MAX" \\
ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS="$ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS" \\
ADMIN_VERIFY_RATE_LIMIT_MAX="$ADMIN_VERIFY_RATE_LIMIT_MAX" \\
ADMIN_VERIFY_RATE_LIMIT_WINDOW_MS="$ADMIN_VERIFY_RATE_LIMIT_WINDOW_MS" \\
node server.js`;

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
    baseURL: PLAYWRIGHT_BASE_URL,
    colorScheme: "light",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  webServer: {
    command: PLAYWRIGHT_WEB_SERVER_COMMAND,
    url: `${PLAYWRIGHT_BASE_URL}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
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
