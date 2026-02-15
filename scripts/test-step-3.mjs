import { spawn } from "node:child_process";
import { access, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PORT = 3000;
const API_BASE = `http://localhost:${PORT}`;
const TEST_DB_PATH = path.join(ROOT, "data", "test-step3.db");
const TEST_DB_WAL_PATH = `${TEST_DB_PATH}-wal`;
const TEST_DB_SHM_PATH = `${TEST_DB_PATH}-shm`;
const TEST_DB_FILES = [TEST_DB_PATH, TEST_DB_WAL_PATH, TEST_DB_SHM_PATH];
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertErrorResponse(response, expectedStatus, expectedCode) {
  assert(
    response.status === expectedStatus,
    `expected status ${expectedStatus}, received ${response.status}`,
  );
  assert(
    typeof response.data === "object" && response.data !== null,
    "error response should be a JSON object",
  );
  assert(
    typeof response.data.error === "object" && response.data.error !== null,
    "error response should include error object",
  );
  assert(
    response.data.error.code === expectedCode,
    `expected error code ${expectedCode}, received ${response.data.error.code}`,
  );
  assert(
    typeof response.data.error.message === "string" &&
      response.data.error.message.length > 0,
    "error response should include non-empty message",
  );
  assert(
    Object.hasOwn(response.data.error, "details"),
    "error response should include details field",
  );
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
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
      const response = await fetch(url);
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
  const child = spawn(
    "node",
    ["node_modules/next/dist/bin/next", "dev", "--port", String(PORT)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        BLOG_API_KEY: apiKey,
        DATABASE_PATH: TEST_DB_PATH,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", (chunk) => process.stdout.write(chunk.toString()));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk.toString()));

  await waitForServer(`${API_BASE}/api/health`);
  return child;
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
    child.kill("SIGTERM");
  }

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      try {
        if (processGroup !== null) {
          process.kill(processGroup, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        child.kill("SIGKILL");
      }
    }, 5000);

    child.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function callJson(pathname, options = {}) {
  const { method = "GET", apiKey, body, headers = {} } = options;
  const requestHeaders = { ...headers };

  if (apiKey) {
    requestHeaders.Authorization = `Bearer ${apiKey}`;
  }

  let payload;
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: requestHeaders,
    body: payload,
  });

  const text = await response.text();
  let data = null;

  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return { status: response.status, data, headers: response.headers };
}

async function callUpload(pathname, apiKey, file) {
  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch(`${API_BASE}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const text = await response.text();
  let data = null;

  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return { status: response.status, data };
}

async function runSessionOne(apiKey, uploadedFiles) {
  const seed = Date.now();
  console.log(
    "\n[session-1] health/auth/create/validate/duplicate/patch/upload checks",
  );

  const healthPublic = await callJson("/api/health");
  assert(healthPublic.status === 200, "GET /api/health should return 200");
  assert(healthPublic.data?.status === "ok", "health status should be ok");
  assert(
    healthPublic.data?.db === "connected",
    "health db should be connected",
  );

  const healthInvalidAuth = await callJson("/api/health", {
    headers: { Authorization: "Bearer wrong-key" },
  });
  assertErrorResponse(healthInvalidAuth, 401, "UNAUTHORIZED");

  const healthWithAuth = await callJson("/api/health", { apiKey });
  assert(
    healthWithAuth.status === 200,
    "GET /api/health with valid key should return 200",
  );
  assert(healthWithAuth.data?.auth === "valid", "health auth should be valid");

  const unauthorizedCreate = await callJson("/api/posts", {
    method: "POST",
    body: { title: "x", content: "y" },
  });
  assertErrorResponse(unauthorizedCreate, 401, "UNAUTHORIZED");

  const wrongKeyCreate = await callJson("/api/posts", {
    method: "POST",
    apiKey: "wrong-key-12345",
    body: { title: "x", content: "y" },
  });
  assertErrorResponse(wrongKeyCreate, 401, "UNAUTHORIZED");

  const created = await callJson("/api/posts", {
    method: "POST",
    apiKey,
    body: {
      title: "2026년 AI 뉴스 요약",
      content: "## 주요 뉴스\n\n- GPT-5 발표\n- Claude 4 출시",
      tags: ["ai", "news"],
      sourceUrl: `https://example.com/article-${seed}`,
      status: "published",
    },
  });
  assert(created.status === 201, "valid POST /api/posts should return 201");
  assert(
    typeof created.data?.id === "number",
    "create response should include numeric id",
  );
  assert(
    typeof created.data?.slug === "string",
    "create response should include slug",
  );

  const postId = created.data.id;
  const originalSlug = created.data.slug;

  const unauthorizedGetPost = await callJson(`/api/posts/${postId}`);
  assertErrorResponse(unauthorizedGetPost, 401, "UNAUTHORIZED");

  const wrongKeyGetPost = await callJson(`/api/posts/${postId}`, {
    apiKey: "wrong-key-12345",
  });
  assertErrorResponse(wrongKeyGetPost, 401, "UNAUTHORIZED");

  const unauthorizedPatchPost = await callJson(`/api/posts/${postId}`, {
    method: "PATCH",
    body: { status: "draft" },
  });
  assertErrorResponse(unauthorizedPatchPost, 401, "UNAUTHORIZED");

  const wrongKeyPatchPost = await callJson(`/api/posts/${postId}`, {
    method: "PATCH",
    apiKey: "wrong-key-12345",
    body: { status: "draft" },
  });
  assertErrorResponse(wrongKeyPatchPost, 401, "UNAUTHORIZED");

  const loaded = await callJson(`/api/posts/${postId}`, { apiKey });
  assert(loaded.status === 200, "GET /api/posts/[id] should return 200");
  assert(
    Array.isArray(loaded.data?.tags),
    "post detail should include tags array",
  );
  assert(
    loaded.data.status === "published",
    "created post status should be published",
  );
  assert(
    typeof loaded.data.published_at === "string",
    "published post should include published_at",
  );

  const publishedAtBeforeDraft = loaded.data.published_at;

  const missingTitle = await callJson("/api/posts", {
    method: "POST",
    apiKey,
    body: { content: "내용만 있음" },
  });
  assertErrorResponse(missingTitle, 400, "INVALID_INPUT");

  const longTitle = await callJson("/api/posts", {
    method: "POST",
    apiKey,
    body: { title: "A".repeat(201), content: "내용" },
  });
  assertErrorResponse(longTitle, 400, "INVALID_INPUT");

  const longContent = await callJson("/api/posts", {
    method: "POST",
    apiKey,
    body: { title: "제목", content: "X".repeat(100001) },
  });
  assertErrorResponse(longContent, 400, "INVALID_INPUT");

  const tooManyTags = await callJson("/api/posts", {
    method: "POST",
    apiKey,
    body: {
      title: "태그 초과",
      content: "내용",
      tags: [
        "t1",
        "t2",
        "t3",
        "t4",
        "t5",
        "t6",
        "t7",
        "t8",
        "t9",
        "t10",
        "t11",
      ],
    },
  });
  assertErrorResponse(tooManyTags, 400, "INVALID_INPUT");

  const invalidStatus = await callJson("/api/posts", {
    method: "POST",
    apiKey,
    body: { title: "제목", content: "내용", status: "archived" },
  });
  assertErrorResponse(invalidStatus, 400, "INVALID_INPUT");

  const duplicateSourceUrl = `https://example.com/dup-test-${seed}`;
  const duplicateFirst = await callJson("/api/posts", {
    method: "POST",
    apiKey,
    body: {
      title: "원본 글",
      content: "내용",
      sourceUrl: duplicateSourceUrl,
    },
  });
  assert(
    duplicateFirst.status === 201,
    "first sourceUrl insert should return 201",
  );

  const duplicateSecond = await callJson("/api/posts", {
    method: "POST",
    apiKey,
    body: {
      title: "중복 글",
      content: "다른 내용",
      sourceUrl: duplicateSourceUrl,
    },
  });
  assert(
    duplicateSecond.status === 409,
    "duplicate sourceUrl should return 409",
  );
  assertErrorResponse(duplicateSecond, 409, "DUPLICATE_SOURCE");

  const checkUnauthorized = await callJson(
    `/api/posts/check?url=${encodeURIComponent(duplicateSourceUrl)}`,
  );
  assertErrorResponse(checkUnauthorized, 401, "UNAUTHORIZED");

  const checkWrongKey = await callJson(
    `/api/posts/check?url=${encodeURIComponent(duplicateSourceUrl)}`,
    { apiKey: "wrong-key-12345" },
  );
  assertErrorResponse(checkWrongKey, 401, "UNAUTHORIZED");

  const checkExists = await callJson(
    `/api/posts/check?url=${encodeURIComponent(duplicateSourceUrl)}`,
    { apiKey },
  );
  assert(
    checkExists.status === 200,
    "GET /api/posts/check existing url should return 200",
  );
  assert(
    checkExists.data?.exists === true,
    "check existing url should be true",
  );
  assert(
    typeof checkExists.data?.postId === "number",
    "check existing url should include postId",
  );

  const checkNotExists = await callJson(
    `/api/posts/check?url=${encodeURIComponent(`https://example.com/not-exist-${seed}`)}`,
    { apiKey },
  );
  assert(
    checkNotExists.status === 200,
    "GET /api/posts/check missing url should return 200",
  );
  assert(
    checkNotExists.data?.exists === false,
    "check missing url should be false",
  );

  const patched = await callJson(`/api/posts/${postId}`, {
    method: "PATCH",
    apiKey,
    body: { status: "draft", title: "제목 변경 테스트" },
  });
  assert(patched.status === 200, "PATCH /api/posts/[id] should return 200");

  const afterPatch = await callJson(`/api/posts/${postId}`, { apiKey });
  assert(afterPatch.status === 200, "GET after PATCH should return 200");
  assert(afterPatch.data?.status === "draft", "patched status should be draft");
  assert(
    afterPatch.data?.slug === originalSlug,
    "slug must remain unchanged after title update",
  );
  assert(
    afterPatch.data?.published_at === publishedAtBeforeDraft,
    "published_at must stay unchanged when published -> draft",
  );

  const missingPost = await callJson("/api/posts/99999", { apiKey });
  assertErrorResponse(missingPost, 404, "NOT_FOUND");

  const uploadUnauthorized = await fetch(`${API_BASE}/api/uploads`, {
    method: "POST",
  });
  const uploadUnauthorizedData = await uploadUnauthorized.json();
  assertErrorResponse(
    { status: uploadUnauthorized.status, data: uploadUnauthorizedData },
    401,
    "UNAUTHORIZED",
  );

  const uploadUnsupportedType = await callUpload(
    "/api/uploads",
    apiKey,
    new File([Buffer.from("plain text")], "invalid.txt", {
      type: "text/plain",
    }),
  );
  assertErrorResponse(uploadUnsupportedType, 415, "UNSUPPORTED_TYPE");

  const uploadInvalidSignature = await callUpload(
    "/api/uploads",
    apiKey,
    new File([Buffer.from("not-png-signature")], "fake.png", {
      type: "image/png",
    }),
  );
  assertErrorResponse(uploadInvalidSignature, 415, "UNSUPPORTED_TYPE");

  const uploadTooLarge = await callUpload(
    "/api/uploads",
    apiKey,
    new File([Buffer.alloc(MAX_UPLOAD_SIZE_BYTES + 1, 0)], "large.png", {
      type: "image/png",
    }),
  );
  assertErrorResponse(uploadTooLarge, 413, "FILE_TOO_LARGE");

  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6Jf2QAAAAASUVORK5CYII=",
    "base64",
  );
  const uploadResponse = await callUpload(
    "/api/uploads",
    apiKey,
    new File([tinyPng], "tiny.png", { type: "image/png" }),
  );
  assert(uploadResponse.status === 201, "POST /api/uploads should return 201");
  assert(
    typeof uploadResponse.data?.url === "string",
    "upload response should include url",
  );

  const absoluteUploadPath = path.join(
    ROOT,
    uploadResponse.data.url.replace(/^\//, ""),
  );
  const uploadedPathExists = await pathExists(absoluteUploadPath);
  assert(uploadedPathExists, "uploaded file should exist on disk");
  uploadedFiles.push(absoluteUploadPath);
}

async function runSessionTwo(apiKey) {
  const seed = Date.now();
  console.log("\n[session-2] slug/published_at/e2e checks");

  const sameTitle = `동일 제목 테스트 ${seed}`;
  const slugFirst = await callJson("/api/posts", {
    method: "POST",
    apiKey,
    body: { title: sameTitle, content: "내용 1" },
  });
  assert(slugFirst.status === 201, "first same-title post should return 201");

  const slugSecond = await callJson("/api/posts", {
    method: "POST",
    apiKey,
    body: { title: sameTitle, content: "내용 2" },
  });
  assert(slugSecond.status === 201, "second same-title post should return 201");
  assert(
    slugFirst.data.slug !== slugSecond.data.slug,
    "slug must be unique for duplicate titles",
  );
  assert(
    slugSecond.data.slug.endsWith("-2"),
    "second duplicate slug should end with -2",
  );

  const draftPost = await callJson("/api/posts", {
    method: "POST",
    apiKey,
    body: {
      title: `전이 테스트 ${seed}`,
      content: "전이 테스트",
      status: "draft",
    },
  });
  assert(draftPost.status === 201, "draft post creation should return 201");

  const draftLoaded = await callJson(`/api/posts/${draftPost.data.id}`, {
    apiKey,
  });
  assert(draftLoaded.status === 200, "draft GET should return 200");
  assert(
    draftLoaded.data.published_at === null,
    "draft post should start with null published_at",
  );

  const publishPatch = await callJson(`/api/posts/${draftPost.data.id}`, {
    method: "PATCH",
    apiKey,
    body: { status: "published" },
  });
  assert(
    publishPatch.status === 200,
    "draft -> published PATCH should return 200",
  );

  const publishedLoaded = await callJson(`/api/posts/${draftPost.data.id}`, {
    apiKey,
  });
  assert(publishedLoaded.status === 200, "published GET should return 200");
  assert(
    typeof publishedLoaded.data.published_at === "string",
    "published_at should be set on first publish",
  );
  const publishedAtBeforeRepublish = publishedLoaded.data.published_at;

  const republishPatch = await callJson(`/api/posts/${draftPost.data.id}`, {
    method: "PATCH",
    apiKey,
    body: { status: "published" },
  });
  assert(
    republishPatch.status === 200,
    "published -> published PATCH should return 200",
  );
  assert(
    republishPatch.data?.published_at === publishedAtBeforeRepublish,
    "published_at must stay unchanged when published -> published",
  );

  const e2eUrl = `https://example.com/e2e-test-${seed}`;
  const e2eCheck = await callJson(
    `/api/posts/check?url=${encodeURIComponent(e2eUrl)}`,
    { apiKey },
  );
  assert(e2eCheck.status === 200, "e2e pre-check should return 200");
  assert(
    e2eCheck.data.exists === false,
    "e2e pre-check should be false before create",
  );

  const e2eCreate = await callJson("/api/posts", {
    method: "POST",
    apiKey,
    body: {
      title: "E2E 테스트 글",
      content: "## E2E\n\n실제 흐름 테스트",
      tags: ["e2e", "test"],
      sourceUrl: e2eUrl,
      status: "published",
    },
  });
  assert(e2eCreate.status === 201, "e2e create should return 201");

  const e2eRead = await callJson(`/api/posts/${e2eCreate.data.id}`, { apiKey });
  assert(e2eRead.status === 200, "e2e read should return 200");
  assert(
    Array.isArray(e2eRead.data.tags),
    "e2e read should include tags array",
  );

  const e2eDuplicate = await callJson("/api/posts", {
    method: "POST",
    apiKey,
    body: {
      title: "E2E 중복",
      content: "내용",
      sourceUrl: e2eUrl,
    },
  });
  assert(e2eDuplicate.status === 409, "e2e duplicate should return 409");
  assertErrorResponse(e2eDuplicate, 409, "DUPLICATE_SOURCE");

  const e2ePatch = await callJson(`/api/posts/${e2eCreate.data.id}`, {
    method: "PATCH",
    apiKey,
    body: { status: "draft" },
  });
  assert(e2ePatch.status === 200, "e2e patch should return 200");

  const raceSourceUrl = `https://example.com/race-${seed}`;
  const raceResults = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      callJson("/api/posts", {
        method: "POST",
        apiKey,
        body: {
          title: `경합 테스트 ${seed}-${index}`,
          content: "경합 테스트 내용",
          sourceUrl: raceSourceUrl,
        },
      }),
    ),
  );

  const raceCreatedCount = raceResults.filter(
    (response) => response.status === 201,
  ).length;
  const raceDuplicateCount = raceResults.filter(
    (response) => response.status === 409,
  ).length;
  assert(
    raceCreatedCount === 1,
    `concurrent sourceUrl race must create exactly one post (received ${raceCreatedCount})`,
  );
  assert(
    raceDuplicateCount === raceResults.length - 1,
    "concurrent sourceUrl race must return 409 for all non-winning requests",
  );
  for (const response of raceResults) {
    if (response.status === 409) {
      assertErrorResponse(response, 409, "DUPLICATE_SOURCE");
    }
  }
}

async function runRateLimitSession(apiKey) {
  const seed = Date.now();
  console.log("\n[session-3] rate limit checks");

  const results = [];

  for (let index = 1; index <= 12; index += 1) {
    const result = await callJson("/api/posts", {
      method: "POST",
      apiKey,
      body: {
        title: `rate-${seed}-${index}`,
        content: "내용",
      },
    });

    results.push(result);
  }

  const statuses = results.map((result) => result.status);

  assert(
    statuses.slice(0, 10).every((status) => status === 201),
    "first 10 requests must return 201",
  );
  assertErrorResponse(results[10], 429, "RATE_LIMITED");
  assertErrorResponse(results[11], 429, "RATE_LIMITED");
  assert(
    typeof results[10].data.error.details?.retryAfterMs === "number",
    "429 response should include retryAfterMs",
  );
}

async function cleanupUploads(uploadedFiles) {
  for (const filePath of uploadedFiles) {
    try {
      await unlink(filePath);
    } catch {
      // ignore cleanup failures
    }
  }
}

async function main() {
  const uploadedFiles = [];
  const apiKey = await resolveApiKey();
  let server = null;

  try {
    await cleanupTestDb();

    server = await startServer(apiKey);
    await runSessionOne(apiKey, uploadedFiles);

    await stopServer(server);
    server = await startServer(apiKey);
    await runSessionTwo(apiKey);

    await stopServer(server);
    server = await startServer(apiKey);
    await runRateLimitSession(apiKey);

    console.log("\nStep 3 checks passed.");
  } finally {
    await stopServer(server);
    await cleanupUploads(uploadedFiles);
    await cleanupTestDb();
  }
}

main().catch((error) => {
  console.error("\nStep 3 checks failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
