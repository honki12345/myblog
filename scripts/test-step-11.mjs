import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import Database from "better-sqlite3";

const require = createRequire(import.meta.url);
const NEXT_BIN = require.resolve("next/dist/bin/next");

const ROOT = process.cwd();
const DEFAULT_PORT = 3360;
const DEV_SERVER_HOST = "127.0.0.1";
const TEST_DB_PATH = path.join(ROOT, "data", "test-step11.db");
const TEST_DB_WAL_PATH = `${TEST_DB_PATH}-wal`;
const TEST_DB_SHM_PATH = `${TEST_DB_PATH}-shm`;
const TEST_DB_FILES = [TEST_DB_PATH, TEST_DB_WAL_PATH, TEST_DB_SHM_PATH];

const BLOG_API_KEY = process.env.BLOG_API_KEY ?? "step11-ai-api-key";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin-password-1234";
const ADMIN_PASSWORD_HASH =
  process.env.ADMIN_PASSWORD_HASH ??
  "$argon2id$v=19$m=19456,t=2,p=1$IKB9DtSF0qPG5/YP8Iv25A$Ia5kZtdBS0EpKzo9eFpjq2zBlBWSayktEzMrUI81WHM";
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET ?? "JBSWY3DPEHPK3PXP";
const ADMIN_RECOVERY_CODES =
  process.env.ADMIN_RECOVERY_CODES ?? "RECOVERY-ONE,RECOVERY-TWO";

let apiBase = `http://${DEV_SERVER_HOST}:${DEFAULT_PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[\s-]/g, "");

  let bits = 0;
  let current = 0;
  const out = [];

  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) {
      throw new Error("Invalid base32 TOTP secret");
    }

    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

function generateTotpCode(secret, now = Date.now()) {
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

class CookieJar {
  constructor() {
    this.map = new Map();
  }

  updateFromResponse(response) {
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];

    for (const cookie of setCookies) {
      const [pair, ...attrs] = cookie.split(";");
      const [name, ...rest] = pair.trim().split("=");
      if (!name) {
        continue;
      }

      const value = rest.join("=");
      const lowerAttrs = attrs.map((item) => item.trim().toLowerCase());
      const hasExpiredAttr = lowerAttrs.some((attr) =>
        attr.startsWith("max-age=0"),
      );
      const expiresAttr = lowerAttrs.find((attr) =>
        attr.startsWith("expires="),
      );
      const expiresPast =
        typeof expiresAttr === "string"
          ? Number.isFinite(Date.parse(expiresAttr.slice("expires=".length))) &&
            Date.parse(expiresAttr.slice("expires=".length)) <= Date.now()
          : false;

      if (hasExpiredAttr || expiresPast || value.length === 0) {
        this.map.delete(name);
      } else {
        this.map.set(name, value);
      }
    }
  }

  toHeader() {
    return Array.from(this.map.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  get(name) {
    return this.map.get(name) ?? null;
  }
}

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once("error", () => resolve(false));
    server.listen({ port, host: DEV_SERVER_HOST }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort = DEFAULT_PORT, maxAttempts = 100) {
  for (let port = startPort; port < startPort + maxAttempts; port += 1) {
    if (await canBindPort(port)) {
      return port;
    }
  }

  throw new Error(`unable to find available port from ${startPort}`);
}

function attachOutput(stream, logs, output) {
  let buffer = "";

  stream.on("data", (chunk) => {
    const text = chunk.toString();
    output.write(text);

    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.length > 0) {
        logs.push(line);
      }
    }
  });

  stream.on("end", () => {
    const line = buffer.trim();
    if (line.length > 0) {
      logs.push(line);
    }
    buffer = "";
  });
}

async function cleanupTestDb() {
  for (const filePath of TEST_DB_FILES) {
    await rm(filePath, { force: true });
  }
}

async function waitForServer(url, retries = 60, delayMs = 500) {
  for (let index = 0; index < retries; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // ignore startup errors
    }
    await sleep(delayMs);
  }

  throw new Error(`Timed out waiting for server: ${url}`);
}

async function startServer(logs) {
  const port = await findAvailablePort(DEFAULT_PORT);
  apiBase = `http://${DEV_SERVER_HOST}:${port}`;

  const child = spawn(
    process.execPath,
    [
      NEXT_BIN,
      "dev",
      "--webpack",
      "--hostname",
      DEV_SERVER_HOST,
      "--port",
      String(port),
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        BLOG_API_KEY,
        DATABASE_PATH: TEST_DB_PATH,
        NEXT_PUBLIC_SITE_URL: apiBase,
        ADMIN_USERNAME,
        ADMIN_PASSWORD_HASH,
        ADMIN_SESSION_SECRET:
          process.env.ADMIN_SESSION_SECRET ??
          "step11-session-secret-0123456789",
        ADMIN_TOTP_SECRET_ENCRYPTION_KEY:
          process.env.ADMIN_TOTP_SECRET_ENCRYPTION_KEY ??
          "step11-totp-encryption-key-0123456789",
        ADMIN_CSRF_SECRET:
          process.env.ADMIN_CSRF_SECRET ?? "step11-csrf-secret-0123456789",
        ADMIN_TOTP_SECRET,
        ADMIN_RECOVERY_CODES,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.__step11Port = port;

  attachOutput(child.stdout, logs, process.stdout);
  attachOutput(child.stderr, logs, process.stderr);

  try {
    await waitForServer(`${apiBase}/api/health`);
    return child;
  } catch (error) {
    await stopServer(child);
    throw error;
  }
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const port =
    typeof child.__step11Port === "number" ? child.__step11Port : null;
  const processGroup = child.pid ? -child.pid : null;

  try {
    if (processGroup !== null) {
      process.kill(processGroup, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore shutdown races
    }
  }

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          if (processGroup !== null) {
            process.kill(processGroup, "SIGKILL");
          } else {
            child.kill("SIGKILL");
          }
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore shutdown races
          }
        }
      }
    }, 5000);
    child.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  if (port !== null) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await canBindPort(port)) {
        return;
      }
      await sleep(100);
    }
  }
}

async function requestJson(pathname, options = {}) {
  const {
    method = "GET",
    apiKey,
    body,
    headers = {},
    jar,
    expectJson = true,
  } = options;
  const requestHeaders = { ...headers };

  if (apiKey) {
    requestHeaders.Authorization = `Bearer ${apiKey}`;
  }

  if (jar) {
    const cookieHeader = jar.toHeader();
    if (cookieHeader) {
      requestHeaders.Cookie = cookieHeader;
    }
  }

  let payload;
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: requestHeaders,
    body: payload,
  });

  if (jar) {
    jar.updateFromResponse(response);
  }

  const text = await response.text();
  let data = null;

  if (expectJson && text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  } else if (!expectJson) {
    data = text;
  }

  return {
    status: response.status,
    data,
  };
}

function csrfHeaders(jar) {
  const token = jar.get("admin_csrf");
  if (!token) {
    throw new Error("admin_csrf cookie is missing");
  }

  return {
    "x-csrf-token": token,
  };
}

async function loginAdmin() {
  const jar = new CookieJar();

  const loginStart = await requestJson("/api/admin/auth/login", {
    method: "POST",
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    jar,
  });
  assert(loginStart.status === 200, "admin login primary should return 200");

  const verify = await requestJson("/api/admin/auth/verify", {
    method: "POST",
    body: { code: generateTotpCode(ADMIN_TOTP_SECRET) },
    jar,
  });
  assert(verify.status === 200, "admin login verify should return 200");
  assert(jar.get("admin_session"), "admin_session cookie should be present");
  assert(jar.get("admin_csrf"), "admin_csrf cookie should be present");

  return jar;
}

async function createPublishedAiPost(titleSuffix) {
  const created = await requestJson("/api/posts", {
    method: "POST",
    apiKey: BLOG_API_KEY,
    body: {
      title: `STEP11-WIKI-${titleSuffix}`,
      content: "step11 wiki post content",
      status: "published",
      tags: ["wiki", "step11"],
      sourceUrl: "https://step11.example/source",
    },
  });

  assert(created.status === 201, "POST /api/posts should return 201");
  assert(
    created.data && typeof created.data.id === "number",
    "created post should include id",
  );
  assert(
    created.data && typeof created.data.slug === "string",
    "created post should include slug",
  );

  return created.data;
}

async function runApiScenario() {
  const createdPost = await createPublishedAiPost(Date.now());
  const postId = createdPost.id;

  const anonymous = await requestJson(`/api/admin/posts/${postId}/comments`);
  assert(
    anonymous.status === 401,
    "anonymous admin comments request should return 401",
  );

  const adminJar = await loginAdmin();

  const missingCsrf = await requestJson(`/api/admin/posts/${postId}/comments`, {
    method: "POST",
    jar: adminJar,
    body: {
      content: "csrf fail",
      tagPath: "ai/platform/nextjs",
      isHidden: false,
    },
  });
  assert(
    missingCsrf.status === 403,
    "admin comment create without csrf should return 403",
  );

  const createdVisibleComment = await requestJson(
    `/api/admin/posts/${postId}/comments`,
    {
      method: "POST",
      jar: adminJar,
      headers: csrfHeaders(adminJar),
      body: {
        content: "위키 공개 댓글",
        tagPath: "AI/Platform/NextJS",
        isHidden: false,
      },
    },
  );
  assert(
    createdVisibleComment.status === 201,
    "admin comment create should return 201",
  );
  assert(
    createdVisibleComment.data?.tagPath === "ai/platform/nextjs",
    "tagPath should be normalized to lowercase",
  );
  const visibleCommentId = createdVisibleComment.data?.id;
  assert(
    typeof visibleCommentId === "number",
    "created comment should include id",
  );

  const createdHiddenComment = await requestJson(
    `/api/admin/posts/${postId}/comments`,
    {
      method: "POST",
      jar: adminJar,
      headers: csrfHeaders(adminJar),
      body: {
        content: "숨김 댓글",
        tagPath: "ai/platform/hidden",
        isHidden: true,
      },
    },
  );
  assert(
    createdHiddenComment.status === 201,
    "hidden comment create should return 201",
  );

  const adminList = await requestJson(`/api/admin/posts/${postId}/comments`, {
    jar: adminJar,
  });
  assert(adminList.status === 200, "admin comment list should return 200");
  assert(
    Array.isArray(adminList.data?.items) && adminList.data.items.length === 2,
    "admin comment list should include 2 comments",
  );

  const wikiRoot = await requestJson("/api/wiki");
  assert(wikiRoot.status === 200, "wiki root should return 200");
  const aiCategory = wikiRoot.data?.categories?.find(
    (category) => category.path === "ai",
  );
  assert(aiCategory, "wiki root should include ai category");

  const wikiPlatform = await requestJson("/api/wiki/ai/platform");
  assert(wikiPlatform.status === 200, "wiki path should return 200");
  assert(
    wikiPlatform.data?.totalCount === 1,
    "wiki path should include only visible comments",
  );
  assert(
    Array.isArray(wikiPlatform.data?.comments) &&
      wikiPlatform.data.comments.length === 1,
    "wiki path comments should include one visible item",
  );

  const hideVisibleComment = await requestJson(
    `/api/admin/posts/${postId}/comments/${visibleCommentId}`,
    {
      method: "PATCH",
      jar: adminJar,
      headers: csrfHeaders(adminJar),
      body: {
        isHidden: true,
      },
    },
  );
  assert(
    hideVisibleComment.status === 200,
    "comment hide patch should return 200",
  );

  const wikiAfterHide = await requestJson("/api/wiki/ai/platform");
  assert(
    wikiAfterHide.status === 404,
    "wiki path should be removed when all comments are hidden/deleted",
  );

  const restoreVisibleComment = await requestJson(
    `/api/admin/posts/${postId}/comments/${visibleCommentId}`,
    {
      method: "PATCH",
      jar: adminJar,
      headers: csrfHeaders(adminJar),
      body: {
        isHidden: false,
        tagPath: "ai/platform/release",
      },
    },
  );
  assert(
    restoreVisibleComment.status === 200,
    "comment restore patch should return 200",
  );

  const wikiRelease = await requestJson("/api/wiki/ai/platform");
  assert(wikiRelease.status === 200, "wiki path should return after unhide");
  assert(
    wikiRelease.data?.comments?.[0]?.tagPath === "ai/platform/release",
    "wiki path should reflect updated tag path",
  );

  const deleted = await requestJson(
    `/api/admin/posts/${postId}/comments/${visibleCommentId}`,
    {
      method: "DELETE",
      jar: adminJar,
      headers: csrfHeaders(adminJar),
    },
  );
  assert(deleted.status === 200, "comment delete should return 200");

  const wikiAfterDelete = await requestJson("/api/wiki/ai/platform");
  assert(
    wikiAfterDelete.status === 404,
    "wiki path should return 404 after deleting visible comment",
  );

  return { postId };
}

function seedPerformanceDataset(
  postId,
  totalComments = 10_000,
  totalPaths = 2_000,
) {
  const db = new Database(TEST_DB_PATH);
  db.pragma("foreign_keys = ON");

  const uniquePaths = [];
  for (let index = 0; index < totalPaths; index += 1) {
    const l1 = `cat-${Math.floor(index / 100)}`;
    const l2 = `topic-${Math.floor((index % 100) / 10)}`;
    const l3 = `leaf-${index % 10}`;
    uniquePaths.push(`${l1}/${l2}/${l3}`);
  }

  const seed = db.transaction(() => {
    db.prepare("DELETE FROM comment_tags").run();
    db.prepare("DELETE FROM post_comments").run();

    const insertComment = db.prepare(
      `
      INSERT INTO post_comments (post_id, content, is_hidden, created_at, updated_at)
      VALUES (?, ?, 0, datetime('now'), datetime('now'))
      `,
    );
    const insertTag = db.prepare(
      "INSERT INTO comment_tags (comment_id, tag_path) VALUES (?, ?)",
    );

    for (let index = 0; index < totalComments; index += 1) {
      const inserted = insertComment.run(postId, `perf comment ${index}`);
      const commentId = Number(inserted.lastInsertRowid);
      const tagPath = uniquePaths[index % uniquePaths.length];
      insertTag.run(commentId, tagPath);
    }
  });

  try {
    seed();
  } finally {
    db.close();
  }
}

function percentile95(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index];
}

async function measureP95(label, iterations, runOnce) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    await runOnce();
    samples.push(performance.now() - startedAt);
  }

  const p95 = percentile95(samples);
  const average =
    samples.reduce((sum, value) => sum + value, 0) / samples.length;
  console.log(
    `[step11] ${label}: avg=${average.toFixed(1)}ms p95=${p95.toFixed(1)}ms iterations=${samples.length}`,
  );
  return p95;
}

async function runPerformanceScenario(postId) {
  seedPerformanceDataset(postId, 10_000, 2_000);

  // Warm-up requests to stabilize query plans and filesystem cache.
  for (let index = 0; index < 5; index += 1) {
    const root = await requestJson("/api/wiki");
    assert(root.status === 200, "warmup /api/wiki should return 200");
    const path = await requestJson("/api/wiki/cat-0/topic-0?limit=200");
    assert(
      path.status === 200,
      "warmup /api/wiki/cat-0/topic-0 should return 200",
    );
  }

  const rootP95 = await measureP95("wiki-root", 25, async () => {
    const response = await requestJson("/api/wiki");
    assert(response.status === 200, "measured /api/wiki should return 200");
  });

  const pathP95 = await measureP95("wiki-path", 25, async () => {
    const response = await requestJson("/api/wiki/cat-0/topic-0?limit=200");
    assert(
      response.status === 200,
      "measured /api/wiki/cat-0/topic-0 should return 200",
    );
  });

  assert(
    rootP95 <= 500,
    `wiki root query p95 exceeds 500ms (actual: ${rootP95.toFixed(1)}ms)`,
  );
  assert(
    pathP95 <= 500,
    `wiki path query p95 exceeds 500ms (actual: ${pathP95.toFixed(1)}ms)`,
  );
}

async function main() {
  const logs = [];

  await cleanupTestDb();
  const server = await startServer(logs);

  try {
    const { postId } = await runApiScenario();
    await runPerformanceScenario(postId);
  } finally {
    await stopServer(server);
    await cleanupTestDb();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[step11] failed: ${message}`);
  process.exitCode = 1;
});
