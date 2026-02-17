import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");

export const PLAYWRIGHT_DATABASE_PATH = path.join(
  ROOT,
  "data",
  "playwright-ui.db",
);

const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin-password-1234";
const DEFAULT_ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

export type SeededPost = {
  title: string;
  content: string;
  tags: string[];
  status: "draft" | "published";
  sourceUrl: string;
};

function parseEnvValueFromEnvFile(targetKey: string): string | null {
  if (!existsSync(ENV_PATH)) {
    return null;
  }

  const envRaw = readFileSync(ENV_PATH, "utf8");

  for (const line of envRaw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const [key, ...rest] = trimmed.split("=");
    if (key === targetKey) {
      const value = rest.join("=").trim();
      const normalized = value.replace(/^['\"]|['\"]$/g, "");
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  return null;
}

function parseApiKeyFromEnvFile(): string {
  const apiKey = parseEnvValueFromEnvFile("BLOG_API_KEY");
  if (apiKey) {
    return apiKey;
  }
  throw new Error("BLOG_API_KEY is missing in .env.local");
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[\s-]/g, "");
  let bits = 0;
  let current = 0;
  const output: number[] = [];

  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) {
      throw new Error("Invalid ADMIN_TOTP_SECRET value.");
    }

    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

function generateTotpCode(secret: string, now = Date.now()): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(now / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function resolveAdminUsername(): string {
  const fromProcess = process.env.ADMIN_USERNAME?.trim();
  if (fromProcess) {
    return fromProcess;
  }

  const fromEnv = parseEnvValueFromEnvFile("ADMIN_USERNAME");
  return fromEnv ?? DEFAULT_ADMIN_USERNAME;
}

export function resolveAdminPassword(): string {
  const fromProcess = process.env.ADMIN_PASSWORD?.trim();
  if (fromProcess) {
    return fromProcess;
  }

  const fromEnv = parseEnvValueFromEnvFile("ADMIN_PASSWORD");
  return fromEnv ?? DEFAULT_ADMIN_PASSWORD;
}

export function resolveAdminTotpSecret(): string {
  const fromProcess = process.env.ADMIN_TOTP_SECRET?.trim();
  if (fromProcess) {
    return fromProcess;
  }

  const fromEnv = parseEnvValueFromEnvFile("ADMIN_TOTP_SECRET");
  return fromEnv ?? DEFAULT_ADMIN_TOTP_SECRET;
}

function normalizeSlug(value: string): string {
  const stripped = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  return stripped.length > 0 ? stripped : "post";
}

function openDb(): Database.Database {
  return new Database(PLAYWRIGHT_DATABASE_PATH);
}

async function ensureDbReady(request: APIRequestContext): Promise<void> {
  const response = await request.get("/api/health");
  if (!response.ok()) {
    throw new Error(
      `failed to initialize db: ${response.status()} ${await response.text()}`,
    );
  }
}

export function resolveApiKey(): string {
  const fromProcess = process.env.API_KEY ?? process.env.BLOG_API_KEY;
  if (fromProcess && fromProcess.trim().length > 0) {
    return fromProcess.trim();
  }

  if (process.env.CI) {
    throw new Error("BLOG_API_KEY (or API_KEY) must be set in CI for UI tests");
  }

  return parseApiKeyFromEnvFile();
}

export async function authenticateWriteEditor(
  page: Page,
  apiKey = resolveApiKey(),
): Promise<void> {
  await page
    .locator('main[data-hydrated="true"]')
    .waitFor({ state: "visible" });
  await page.getByLabel("API Key").fill(apiKey);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole("button", { name: "인증 후 편집기 열기" }).click();
    try {
      await expect(
        page.getByRole("heading", { name: /새 글 작성|글 수정 #\d+/ }),
      ).toBeVisible({ timeout: 4_000 });
      return;
    } catch {
      await page.waitForTimeout(300);
    }
  }

  throw new Error("API Key authentication did not transition to editor mode");
}

export async function assertNoHorizontalPageScroll(
  page: Page,
  message: string,
): Promise<void> {
  const { documentElement, body, offenders } = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const elements = Array.from(document.querySelectorAll("body *"));

    const candidates = elements
      .map((node) => {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        const rightOverflow = rect.right - clientWidth;
        const scrollOverflow = element.scrollWidth - clientWidth;
        const tag = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : "";
        const className =
          typeof element.className === "string" && element.className.trim()
            ? `.${element.className.trim().split(/\\s+/).slice(0, 4).join(".")}`
            : "";
        const label = `${tag}${id}${className}`;
        return {
          label,
          right: rect.right,
          width: rect.width,
          left: rect.left,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          rightOverflow,
          scrollOverflow,
        };
      })
      .filter((item) => {
        return (
          item.rightOverflow > 1 &&
          item.width > clientWidth + 1 &&
          item.left > -1
        );
      })
      .sort((a, b) => b.rightOverflow - a.rightOverflow)
      .slice(0, 5);

    return {
      documentElement: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
      body: {
        scrollWidth: document.body.scrollWidth,
        clientWidth: document.body.clientWidth,
      },
      offenders: candidates,
    };
  });

  const offenderHint =
    offenders.length > 0
      ? ` offenders=${JSON.stringify(offenders)}`
      : "";

  expect(
    Math.ceil(documentElement.scrollWidth),
    `${message} (documentElement scrollWidth=${documentElement.scrollWidth} clientWidth=${documentElement.clientWidth})${offenderHint}`,
  ).toBeLessThanOrEqual(documentElement.clientWidth + 1);

  expect(
    Math.ceil(body.scrollWidth),
    `${message} (body scrollWidth=${body.scrollWidth} clientWidth=${body.clientWidth})${offenderHint}`,
  ).toBeLessThanOrEqual(body.clientWidth + 1);
}

export async function authenticateAdminSession(
  page: Page,
  options: { nextPath?: string } = {},
): Promise<void> {
  const nextPath = options.nextPath ?? "/admin/write";
  const username = resolveAdminUsername();
  const password = resolveAdminPassword();
  const totpSecret = resolveAdminTotpSecret();
  const encodedNext = encodeURIComponent(nextPath);

  await page.goto(`/admin/login?next=${encodedNext}`, {
    waitUntil: "networkidle",
  });
  await page.getByLabel("아이디").fill(username);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "1차 인증" }).click();
  await expect(page.getByLabel("인증 코드")).toBeVisible({ timeout: 8_000 });

  let authenticated = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateTotpCode(totpSecret);
    await page.getByLabel("인증 코드").fill(code);
    await page.getByRole("button", { name: "2차 인증 완료" }).click();

    try {
      await expect(page).toHaveURL(
        new RegExp(nextPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        {
          timeout: 10_000,
        },
      );
      authenticated = true;
      break;
    } catch {
      await page.waitForTimeout(500);
      if (attempt === 2) {
        break;
      }
    }
  }

  if (!authenticated) {
    throw new Error("admin authentication did not transition to workspace");
  }
}

export function runCleanupScript(): void {
  const result = spawnSync("node", ["scripts/cleanup-test-data.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_PATH: PLAYWRIGHT_DATABASE_PATH,
    },
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    throw new Error(`cleanup script failed with status ${result.status}`);
  }
}

export async function insertPostDirect(
  request: APIRequestContext,
  post: SeededPost,
): Promise<{ id: number; slug: string }> {
  await ensureDbReady(request);

  const db = openDb();
  db.pragma("foreign_keys = ON");

  try {
    return db.transaction(() => {
      const baseSlug = normalizeSlug(post.title);
      let slug = baseSlug;
      let suffix = 2;

      while (
        db.prepare("SELECT 1 FROM posts WHERE slug = ? LIMIT 1").get(slug)
      ) {
        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }

      const now = "2026-01-01 00:00:00";

      const postResult = db
        .prepare(
          `
          INSERT INTO posts (title, slug, content, status, source_url, created_at, updated_at, published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN ? ELSE NULL END)
          `,
        )
        .run(
          post.title,
          slug,
          post.content,
          post.status,
          post.sourceUrl,
          now,
          now,
          post.status,
          now,
        );

      const postId = Number(postResult.lastInsertRowid);

      for (const tag of Array.from(new Set(post.tags))) {
        db.prepare(
          "INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
        ).run(tag);
        const tagRow = db
          .prepare("SELECT id FROM tags WHERE name = ?")
          .get(tag) as { id: number } | undefined;

        if (!tagRow) {
          throw new Error(`missing tag id for ${tag}`);
        }

        db.prepare(
          "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
        ).run(postId, tagRow.id);
      }

      db.prepare(
        "INSERT OR IGNORE INTO sources (url, post_id) VALUES (?, ?)",
      ).run(post.sourceUrl, postId);

      return { id: postId, slug };
    })();
  } finally {
    db.close();
  }
}

async function triggerRevalidationForSeededPost(
  request: APIRequestContext,
  post: SeededPost & { id: number },
): Promise<void> {
  const apiKey = resolveApiKey();
  const response = await request.patch(`/api/posts/${post.id}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    data: {
      title: post.title,
      content: post.content,
      status: post.status,
      tags: post.tags,
    },
  });

  if (!response.ok()) {
    throw new Error(
      `failed to trigger route revalidation: ${response.status()} ${await response.text()}`,
    );
  }
}

export async function seedVisualPosts(
  request: APIRequestContext,
): Promise<{ detailSlug: string }> {
  runCleanupScript();
  const seededPosts: Array<SeededPost & { id: number; slug: string }> = [];

  const longToken = "a".repeat(180);
  const homeSeed: SeededPost = {
    title: "PW-SEED-홈 화면 글",
    content: `![thumbnail](/uploads/pw-seed-thumbnail.svg)

# PW Seed Detail

시각 회귀 테스트용 홈 콘텐츠 (오버플로우 케이스 포함)

## Long Code

\`\`\`js
const reallyLongLine = "${longToken}";
console.log(reallyLongLine);
\`\`\`

## Long URL

https://example.com/${longToken}

## Wide Table

| A | B | C | D | E | F |
| --- | --- | --- | --- | --- | --- |
| cell-${longToken} | cell-${longToken} | cell-${longToken} | cell-${longToken} | cell-${longToken} | cell-${longToken} |

$$E=mc^2$$
`,
    tags: ["sample", "visual"],
    status: "published",
    sourceUrl: "https://playwright.seed/home",
  };
  const postA = await insertPostDirect(request, homeSeed);
  seededPosts.push({ ...homeSeed, ...postA });

  const listSeed: SeededPost = {
    title: "PW-SEED-목록 화면 글",
    content: "시각 회귀 테스트용 목록 콘텐츠",
    tags: ["sample"],
    status: "published",
    sourceUrl: "https://playwright.seed/list",
  };
  const postB = await insertPostDirect(request, listSeed);
  seededPosts.push({ ...listSeed, ...postB });

  const tagSeed: SeededPost = {
    title: "PW-SEED-태그 화면 글",
    content:
      "![missing](/uploads/pw-seed-missing.svg)\n\nsample 태그를 가진 글",
    tags: ["sample", "react"],
    status: "published",
    sourceUrl: "https://playwright.seed/tag",
  };
  const postC = await insertPostDirect(request, tagSeed);
  seededPosts.push({ ...tagSeed, ...postC });

  const draftSeed: SeededPost = {
    title: "PW-SEED-비공개 초안",
    content: "보이면 안 됩니다",
    tags: ["sample"],
    status: "draft",
    sourceUrl: "https://playwright.seed/draft",
  };
  const draftPost = await insertPostDirect(request, draftSeed);
  seededPosts.push({ ...draftSeed, ...draftPost });

  for (const seededPost of seededPosts) {
    if (seededPost.status !== "published") {
      continue;
    }

    await triggerRevalidationForSeededPost(request, seededPost);
  }

  return { detailSlug: postA.slug };
}
