import { spawn } from "node:child_process";
import { access, readFile, rm, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_PORT = 3000;
let apiBase = `http://127.0.0.1:${DEFAULT_PORT}`;
const TEST_DB_PATH = path.join(ROOT, "data", "test-step5.db");
const TEST_DB_WAL_PATH = `${TEST_DB_PATH}-wal`;
const TEST_DB_SHM_PATH = `${TEST_DB_PATH}-shm`;
const TEST_DB_FILES = [TEST_DB_PATH, TEST_DB_WAL_PATH, TEST_DB_SHM_PATH];
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveIntegerEnv(envValue, fallback, { minimum = 1 } = {}) {
  if (!envValue) {
    return fallback;
  }

  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }

  return Math.floor(parsed);
}

function isNetworkError(error) {
  return (
    error instanceof Error &&
    /fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up/i.test(
      error.message,
    )
  );
}

async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const retries = retryOptions.retries ?? 0;
  const baseDelayMs = retryOptions.baseDelayMs ?? 250;

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (!isNetworkError(error) || attempt === retries) {
        throw error;
      }
      await sleep(baseDelayMs * (attempt + 1));
    }
  }

  throw lastError ?? new Error("fetch failed");
}

function getRetryCountForMethod(method) {
  const normalizedMethod = method.toUpperCase();
  return normalizedMethod === "GET" || normalizedMethod === "HEAD" ? 3 : 0;
}

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once("error", () => {
      resolve(false);
    });

    server.listen({ port, host: "127.0.0.1" }, () => {
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

function assertErrorResponse(response, expectedStatus, expectedCode) {
  assert(
    response.status === expectedStatus,
    `expected status ${expectedStatus}, received ${response.status}`,
  );
  assert(
    response.data && typeof response.data === "object",
    "expected JSON error object",
  );
  assert(
    response.data.error && typeof response.data.error === "object",
    "missing error envelope",
  );
  assert(
    response.data.error.code === expectedCode,
    `expected error.code ${expectedCode}, received ${response.data.error.code}`,
  );
}

async function cleanupTestDb() {
  for (const filePath of TEST_DB_FILES) {
    await rm(filePath, { force: true });
  }
}

async function loadApiKeyFromEnvFile() {
  const envPath = path.join(ROOT, ".env.local");
  const raw = await readFile(envPath, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const [key, ...rest] = trimmed.split("=");
    if (key === "BLOG_API_KEY") {
      const value = rest.join("=").trim();
      return value.replace(/^['\"]|['\"]$/g, "");
    }
  }

  throw new Error("BLOG_API_KEY is missing in .env.local");
}

async function resolveApiKey() {
  const fromEnv = process.env.API_KEY ?? process.env.BLOG_API_KEY;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }

  return loadApiKeyFromEnvFile();
}

async function waitForServer(url, retries = 60, delayMs = 500) {
  for (let index = 0; index < retries; index += 1) {
    try {
      const response = await fetchWithRetry(url, {}, { retries: 1 });
      if (response.ok) {
        return;
      }
    } catch {
      // ignore startup errors
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Timed out waiting for server: ${url}`);
}

async function startServer(apiKey) {
  const startPort = parsePositiveIntegerEnv(
    process.env.STEP5_PORT_BASE,
    DEFAULT_PORT,
  );
  const port = await findAvailablePort(startPort);
  apiBase = `http://127.0.0.1:${port}`;

  const child = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      BLOG_API_KEY: apiKey,
      DATABASE_PATH: TEST_DB_PATH,
      NEXT_PUBLIC_SITE_URL: apiBase,
      RATE_LIMIT_MAX_REQUESTS:
        process.env.STEP5_RATE_LIMIT_MAX_REQUESTS ??
        process.env.RATE_LIMIT_MAX_REQUESTS ??
        "100",
      RATE_LIMIT_WINDOW_MS:
        process.env.STEP5_RATE_LIMIT_WINDOW_MS ??
        process.env.RATE_LIMIT_WINDOW_MS ??
        "1000",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk.toString()));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk.toString()));

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
}

async function requestText(pathname, options = {}) {
  const { method = "GET", apiKey, body, headers = {} } = options;
  const requestMethod = method.toUpperCase();
  const requestHeaders = { ...headers };

  if (apiKey) {
    requestHeaders.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchWithRetry(
    `${apiBase}${pathname}`,
    {
      method: requestMethod,
      headers: requestHeaders,
      body,
    },
    {
      retries: getRetryCountForMethod(requestMethod),
    },
  );

  return {
    status: response.status,
    text: await response.text(),
    headers: response.headers,
  };
}

async function requestJson(pathname, options = {}) {
  const { method = "GET", apiKey, body, headers = {} } = options;
  const requestMethod = method.toUpperCase();
  const requestHeaders = { ...headers };

  if (apiKey) {
    requestHeaders.Authorization = `Bearer ${apiKey}`;
  }

  let payload;
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetchWithRetry(
    `${apiBase}${pathname}`,
    {
      method: requestMethod,
      headers: requestHeaders,
      body: payload,
    },
    {
      retries: getRetryCountForMethod(requestMethod),
    },
  );

  const text = await response.text();
  let data = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return {
    status: response.status,
    data,
    headers: response.headers,
  };
}

async function createPost(apiKey, body) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await requestJson("/api/posts", {
      method: "POST",
      apiKey,
      body,
    });

    if (response.status === 201) {
      assert(
        typeof response.data?.id === "number",
        "create response missing id",
      );
      assert(
        typeof response.data?.slug === "string" &&
          response.data.slug.length > 0,
        "create response missing slug",
      );
      return response.data;
    }

    if (response.status === 429) {
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const retryAfterMsFromHeader = Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1000
        : 0;
      const retryAfterMsFromBody = Number(
        response.data?.error?.details?.retryAfterMs ?? 0,
      );
      const waitMs = Math.max(
        retryAfterMsFromHeader,
        retryAfterMsFromBody,
        1000,
      );
      await sleep(waitMs + 200);
      continue;
    }

    throw new Error(`post create failed: ${response.status}`);
  }

  throw new Error("post create failed after retry attempts");
}

async function runChecks(apiKey) {
  const seed = Date.now();

  const homeResponse = await requestText("/");
  assert(homeResponse.status === 200, "home should return 200");
  assert(
    homeResponse.text.includes("아직 글이 없습니다"),
    "home empty state missing",
  );

  const homeCreateTitles = [1, 2, 3].map((i) => `STEP5-HOME-${seed}-${i}`);
  for (const title of homeCreateTitles) {
    await createPost(apiKey, {
      title,
      content: `${title} content`,
      status: "published",
      sourceUrl: `https://step5.test/home/${encodeURIComponent(title)}`,
    });
  }

  const homeWithPosts = await requestText("/");
  assert(homeWithPosts.status === 200, "home should return 200 after create");
  for (const title of homeCreateTitles) {
    assert(homeWithPosts.text.includes(title), `home missing title: ${title}`);
  }

  const postsResponse = await requestText("/posts");
  assert(postsResponse.status === 200, "posts should return 200");

  const markdownTitle = `STEP5-DETAIL-${seed}`;
  const markdownCreated = await createPost(apiKey, {
    title: markdownTitle,
    content: "## 소제목\n\n본문 내용",
    status: "published",
    tags: ["frontend", "react"],
    sourceUrl: `https://step5.test/detail/${seed}`,
  });

  const detailResponse = await requestText(`/posts/${markdownCreated.slug}`);
  assert(detailResponse.status === 200, "detail should return 200");
  assert(detailResponse.text.includes(markdownTitle), "detail title missing");
  assert(detailResponse.text.includes("<h2"), "detail markdown h2 missing");

  const koreanTitle = `한글-상세-${seed}`;
  const koreanCreated = await createPost(apiKey, {
    title: koreanTitle,
    content: "한글 slug 본문",
    status: "published",
    sourceUrl: `https://step5.test/korean/${seed}`,
  });

  const koreanDetailPlain = await requestText(`/posts/${koreanCreated.slug}`);
  assert(
    koreanDetailPlain.status === 200,
    "korean slug detail should return 200",
  );
  assert(
    koreanDetailPlain.text.includes(koreanTitle),
    "korean slug detail title missing",
  );

  const koreanDetailEncoded = await requestText(
    `/posts/${encodeURIComponent(koreanCreated.slug)}`,
  );
  assert(
    koreanDetailEncoded.status === 200,
    "encoded korean slug detail should return 200",
  );
  assert(
    koreanDetailEncoded.text.includes(koreanTitle),
    "encoded korean slug detail title missing",
  );

  const detail404 = await requestText("/posts/this-slug-does-not-exist-12345");
  assert(detail404.status === 404, "missing slug should return 404");

  const malformedSlug = await requestText("/posts/%E0%A4%A");
  assert(
    malformedSlug.status === 400,
    "malformed encoded slug should return 400",
  );

  const tagResponse = await requestText("/tags/frontend");
  assert(tagResponse.status === 200, "tag page should return 200");
  assert(
    tagResponse.text.includes(markdownTitle),
    "tag page missing filtered post",
  );

  const missingTagResponse = await requestText("/tags/nonexistent-tag-xyz");
  assert(missingTagResponse.status === 200, "missing tag should return 200");
  assert(
    missingTagResponse.text.includes("빈 목록"),
    "missing tag empty state missing",
  );

  const draftTitle = `STEP5-DRAFT-${seed}`;
  const draftCreated = await createPost(apiKey, {
    title: draftTitle,
    content: "draft content",
    status: "draft",
    sourceUrl: `https://step5.test/draft/${seed}`,
  });

  const homeAfterDraft = await requestText("/");
  assert(
    !homeAfterDraft.text.includes(draftTitle),
    "draft should not be visible on home",
  );

  const postsAfterDraft = await requestText("/posts");
  assert(
    !postsAfterDraft.text.includes(draftTitle),
    "draft should not be visible on posts list",
  );

  const draftDetail = await requestText(`/posts/${draftCreated.slug}`);
  assert(draftDetail.status === 404, "draft detail should return 404");

  const paginationPrefix = `STEP5-PAGINATION-${seed}-`;
  const paginationTitles = [];
  for (let index = 0; index < 15; index += 1) {
    const title = `${paginationPrefix}${String(index).padStart(2, "0")}`;
    paginationTitles.push(title);
    await createPost(apiKey, {
      title,
      content: `pagination content ${index}`,
      status: "published",
      sourceUrl: `https://step5.test/pagination/${seed}/${index}`,
    });
  }

  const page1 = await requestText("/posts?page=1");
  const page2 = await requestText("/posts?page=2");

  const page1Count = paginationTitles.filter((title) =>
    page1.text.includes(title),
  ).length;
  const page2Count = paginationTitles.filter((title) =>
    page2.text.includes(title),
  ).length;
  assert(page1Count > 0, "pagination page1 should contain seeded posts");
  assert(page2Count > 0, "pagination page2 should contain seeded posts");
  assert(
    page1Count + page2Count === 15,
    `pagination total mismatch: ${page1Count + page2Count}`,
  );

  assert(homeWithPosts.text.includes('href="/"'), "home nav link missing /");
  assert(
    homeWithPosts.text.includes('href="/posts"'),
    "home nav link missing /posts",
  );

  const titleMatch = detailResponse.text.match(/<title>([^<]+)<\/title>/);
  assert(
    titleMatch && titleMatch[1].includes(markdownTitle),
    "metadata title mismatch",
  );

  const writePage = await requestText("/write");
  assert(writePage.status === 200, "write page should return 200");
  assert(
    writePage.text.includes("관리자 로그인"),
    "write compatibility redirect should land on admin login page",
  );

  const cacheTitle = `STEP5-CACHE-${seed}`;
  const cachePost = await createPost(apiKey, {
    title: cacheTitle,
    content: "cache content",
    status: "published",
    sourceUrl: `https://step5.test/cache/${seed}`,
  });

  const homeAfterCache = await requestText("/");
  const postsAfterCache = await requestText("/posts");
  const detailAfterCache = await requestText(`/posts/${cachePost.slug}`);

  assert(
    homeAfterCache.text.includes(cacheTitle),
    "cache verify: home missing post",
  );
  assert(
    postsAfterCache.text.includes(cacheTitle),
    "cache verify: posts missing post",
  );
  assert(
    detailAfterCache.text.includes(cacheTitle),
    "cache verify: detail missing post",
  );

  const unauthorizedCreate = await requestJson("/api/posts", {
    method: "POST",
    body: { title: "x", content: "y" },
  });
  assertErrorResponse(unauthorizedCreate, 401, "UNAUTHORIZED");

  const unauthorizedGetById = await requestJson(
    `/api/posts/${markdownCreated.id}`,
  );
  assertErrorResponse(unauthorizedGetById, 401, "UNAUTHORIZED");

  const unauthorizedPatchById = await requestJson(
    `/api/posts/${markdownCreated.id}`,
    {
      method: "PATCH",
      body: { status: "draft" },
    },
  );
  assertErrorResponse(unauthorizedPatchById, 401, "UNAUTHORIZED");

  const unauthorizedUpload = await fetchWithRetry(`${apiBase}/api/uploads`, {
    method: "POST",
    body: new FormData(),
  });
  assert(
    unauthorizedUpload.status === 401,
    "unauthorized upload should return 401",
  );

  const pngBytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  const uploadSuccessForm = new FormData();
  uploadSuccessForm.set(
    "file",
    new File([pngBytes], `step5-${seed}.png`, { type: "image/png" }),
  );

  const uploadSuccessResponse = await fetchWithRetry(`${apiBase}/api/uploads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: uploadSuccessForm,
  });

  const uploadSuccessJson = await uploadSuccessResponse.json();
  assert(
    uploadSuccessResponse.status === 201,
    "upload success should return 201",
  );
  assert(
    typeof uploadSuccessJson.url === "string" &&
      uploadSuccessJson.url.startsWith("/uploads/"),
    "upload success should return url",
  );

  const uploadedPath = path.join(
    ROOT,
    uploadSuccessJson.url.replace(/^\//, ""),
  );
  const uploadedStat = await stat(uploadedPath);
  assert(uploadedStat.size > 0, "uploaded file should exist");
  await rm(uploadedPath, { force: true });

  const uploadUnsupportedForm = new FormData();
  uploadUnsupportedForm.set(
    "file",
    new File(["not-image"], `step5-${seed}.txt`, { type: "text/plain" }),
  );

  const uploadUnsupported = await fetchWithRetry(`${apiBase}/api/uploads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: uploadUnsupportedForm,
  });
  assert(
    uploadUnsupported.status === 415,
    "unsupported upload should return 415",
  );

  const largeFileBytes = new Uint8Array(MAX_UPLOAD_SIZE_BYTES + 1);
  largeFileBytes.set([0x89, 0x50, 0x4e, 0x47], 0);

  const uploadLargeForm = new FormData();
  uploadLargeForm.set(
    "file",
    new File([largeFileBytes], `step5-${seed}-large.png`, {
      type: "image/png",
    }),
  );

  const uploadLarge = await fetchWithRetry(`${apiBase}/api/uploads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: uploadLargeForm,
  });
  assert(uploadLarge.status === 413, "oversized upload should return 413");

  console.log("Step 5 checks passed.");
}

async function main() {
  const apiKey = await resolveApiKey();
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await cleanupTestDb();
    const child = await startServer(apiKey);

    try {
      await runChecks(apiKey);
      assert(await fileExists(TEST_DB_PATH), "test db should be created");
      return;
    } catch (error) {
      const canRetry = attempt < maxAttempts && isNetworkError(error);
      if (!canRetry) {
        throw error;
      }
      console.warn(
        `Step 5 transient network error (attempt ${attempt}/${maxAttempts}), retrying...`,
      );
    } finally {
      await stopServer(child);
      await cleanupTestDb();
    }
  }
}

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Step 5 checks failed: ${message}`);
  process.exitCode = 1;
});
