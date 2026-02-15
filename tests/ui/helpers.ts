import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { APIRequestContext } from "@playwright/test";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");

export const PLAYWRIGHT_DATABASE_PATH = path.join(
  ROOT,
  "data",
  "playwright-ui.db",
);

export type SeededPost = {
  title: string;
  content: string;
  tags: string[];
  status: "draft" | "published";
  sourceUrl: string;
};

function parseApiKeyFromEnvFile(): string {
  const envRaw = readFileSync(ENV_PATH, "utf8");

  for (const line of envRaw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const [key, ...rest] = trimmed.split("=");
    if (key === "BLOG_API_KEY") {
      const value = rest.join("=").trim();
      const normalized = value.replace(/^['\"]|['\"]$/g, "");
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  throw new Error("BLOG_API_KEY is missing in .env.local");
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

  return parseApiKeyFromEnvFile();
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

  const inserted = db.transaction(() => {
    const baseSlug = normalizeSlug(post.title);
    let slug = baseSlug;
    let suffix = 2;

    while (db.prepare("SELECT 1 FROM posts WHERE slug = ? LIMIT 1").get(slug)) {
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

  db.close();
  return inserted;
}

export async function seedVisualPosts(
  request: APIRequestContext,
): Promise<{ detailSlug: string }> {
  runCleanupScript();

  const postA = await insertPostDirect(request, {
    title: "PW-SEED-홈 화면 글",
    content: "시각 회귀 테스트용 홈 콘텐츠",
    tags: ["sample", "visual"],
    status: "published",
    sourceUrl: "https://playwright.seed/home",
  });

  await insertPostDirect(request, {
    title: "PW-SEED-목록 화면 글",
    content: "시각 회귀 테스트용 목록 콘텐츠",
    tags: ["sample"],
    status: "published",
    sourceUrl: "https://playwright.seed/list",
  });

  await insertPostDirect(request, {
    title: "PW-SEED-태그 화면 글",
    content: "sample 태그를 가진 글",
    tags: ["sample", "react"],
    status: "published",
    sourceUrl: "https://playwright.seed/tag",
  });

  await insertPostDirect(request, {
    title: "PW-SEED-비공개 초안",
    content: "보이면 안 됩니다",
    tags: ["sample"],
    status: "draft",
    sourceUrl: "https://playwright.seed/draft",
  });

  return { detailSlug: postA.slug };
}
