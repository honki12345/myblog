import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile, rm, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const NEXT_BIN = require.resolve("next/dist/bin/next");

const ROOT = process.cwd();
const DEV_SERVER_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
let apiBase = `http://${DEV_SERVER_HOST}:${DEFAULT_PORT}`;
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

async function assertRejects(action, name) {
  let didThrow = false;

  try {
    await action();
  } catch {
    didThrow = true;
  }

  assert(didThrow, `expected rejection: ${name}`);
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
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

async function waitForPortToBeFree(port, retries = 25, delayMs = 200) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (await canBindPort(port)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Timed out waiting for port ${port} to be released`);
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

  try {
    return await loadApiKeyFromEnvFile();
  } catch {
    return `api-test-${randomUUID()}`;
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

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Timed out waiting for server: ${url}`);
}

async function startServer(apiKey, options = {}) {
  const { env = {} } = options;
  const startPort = Number.parseInt(process.env.STEP3_PORT_BASE ?? "", 10);
  const portBase =
    Number.isFinite(startPort) && startPort > 0 ? startPort : DEFAULT_PORT;
  const port = await findAvailablePort(portBase);
  apiBase = `http://${DEV_SERVER_HOST}:${port}`;

  const output = { stdout: "", stderr: "" };
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
        BLOG_API_KEY: apiKey,
        DATABASE_PATH: TEST_DB_PATH,
        NEXT_PUBLIC_SITE_URL: apiBase,
        NEXT_TELEMETRY_DISABLED: "1",
        ...env,
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.__step3Port = port;

  child.__output = output;
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    output.stdout += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    output.stderr += text;
    process.stderr.write(text);
  });

  await waitForServer(`${apiBase}/api/health`);
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

  // `next dev` can keep the port occupied briefly after the parent process exits
  // (child workers / graceful shutdown). Ensure we don't race the next start.
  const port = typeof child.__step3Port === "number" ? child.__step3Port : null;
  if (port !== null) {
    await waitForPortToBeFree(port);
  }
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

  const response = await fetch(`${apiBase}${pathname}`, {
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

  const response = await fetch(`${apiBase}${pathname}`, {
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

async function runInboxUrlUnitTests() {
  console.log("\n[unit] inbox url normalization");

  const inboxUrlModule = await import("../src/lib/inbox-url.ts");
  const inboxUrlExports = inboxUrlModule.default ?? inboxUrlModule;
  const { normalizeDocUrl, normalizeXStatusUrl } = inboxUrlExports;

  const direct = await normalizeXStatusUrl("https://x.com/i/web/status/123");
  assert(
    direct.canonicalUrl === "https://x.com/i/web/status/123",
    "direct canonical URL should be preserved",
  );

  const viaTwitter = await normalizeXStatusUrl(
    "https://twitter.com/i/web/status/456",
  );
  assert(
    viaTwitter.canonicalUrl === "https://x.com/i/web/status/456",
    "twitter.com URL should normalize to x.com canonical",
  );

  const statusPath = await normalizeXStatusUrl(
    "https://x.com/someuser/status/789",
  );
  assert(
    statusPath.canonicalUrl === "https://x.com/i/web/status/789",
    "/status/<id> URL should normalize to canonical",
  );

  const redirectMap = new Map([
    [
      "https://t.co/abc",
      new Response(null, {
        status: 302,
        headers: { location: "https://twitter.com/i/web/status/999" },
      }),
    ],
    [
      "https://twitter.com/i/web/status/999",
      new Response(null, { status: 200 }),
    ],
  ]);

  const stubFetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const response = redirectMap.get(url);
    if (!response) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return response;
  };

  const viaTco = await normalizeXStatusUrl("https://t.co/abc", {
    fetch: stubFetch,
  });
  assert(
    viaTco.canonicalUrl === "https://x.com/i/web/status/999",
    "t.co redirect should normalize to canonical",
  );

  const badRedirects = new Map([
    [
      "https://t.co/bad",
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/i/web/status/111" },
      }),
    ],
  ]);
  const badFetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const response = badRedirects.get(url);
    if (!response) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return response;
  };

  await assertRejects(
    () =>
      normalizeXStatusUrl("https://t.co/bad", {
        fetch: badFetch,
      }),
    "t.co redirect to disallowed host",
  );

  await assertRejects(
    () => normalizeXStatusUrl("http://x.com/i/web/status/123"),
    "http scheme rejection",
  );

  const stubResolveHostname = async () => ["93.184.216.34"];
  const okFetch = async () => new Response(null, { status: 200 });

  const docHash = await normalizeDocUrl("https://example.com/a#b", {
    fetch: okFetch,
    resolveHostname: stubResolveHostname,
  });
  assert(
    docHash.canonicalUrl === "https://example.com/a",
    "doc URL should strip fragment",
  );

  const docDefaultPort = await normalizeDocUrl("https://example.com:443/a#b", {
    fetch: okFetch,
    resolveHostname: stubResolveHostname,
  });
  assert(
    docDefaultPort.canonicalUrl === "https://example.com/a",
    "doc URL should strip default port and fragment",
  );

  const docTracking = await normalizeDocUrl(
    "https://example.com/a?utm_source=x&x=1#b",
    { fetch: okFetch, resolveHostname: stubResolveHostname },
  );
  assert(
    docTracking.canonicalUrl === "https://example.com/a?x=1",
    "doc URL should strip tracking params and fragment",
  );

  await assertRejects(
    () =>
      normalizeDocUrl("http://example.com/a", {
        fetch: okFetch,
        resolveHostname: stubResolveHostname,
      }),
    "doc http scheme rejection",
  );

  await assertRejects(
    () =>
      normalizeDocUrl("https://u:p@example.com/a", {
        fetch: okFetch,
        resolveHostname: stubResolveHostname,
      }),
    "doc credential rejection (username/password)",
  );

  await assertRejects(
    () =>
      normalizeDocUrl("https://u@example.com/a", {
        fetch: okFetch,
        resolveHostname: stubResolveHostname,
      }),
    "doc credential rejection (username only)",
  );

  await assertRejects(
    () =>
      normalizeDocUrl("https://example.com:8443/a", {
        fetch: okFetch,
        resolveHostname: stubResolveHostname,
      }),
    "doc non-default port rejection",
  );

  const docRedirectMap = new Map([
    [
      "https://short.example/abc",
      new Response(null, {
        status: 302,
        headers: {
          location: "https://example.com/final?utm_source=x&x=1#b",
        },
      }),
    ],
    [
      "https://example.com/final?utm_source=x&x=1#b",
      new Response(null, { status: 200 }),
    ],
  ]);

  const redirectFetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const response = docRedirectMap.get(url);
    if (!response) {
      return new Response(null, { status: 200 });
    }
    return response;
  };

  const redirected = await normalizeDocUrl("https://short.example/abc", {
    fetch: redirectFetch,
    resolveHostname: stubResolveHostname,
  });
  assert(
    redirected.canonicalUrl === "https://example.com/final?x=1",
    "doc URL should follow redirects and canonicalize query/hash",
  );

  let lastFetchInit;
  const pinnedFetch = async (_input, init) => {
    lastFetchInit = init;
    return new Response(null, { status: 200 });
  };
  await normalizeDocUrl("https://example.com/pin-check", {
    fetch: pinnedFetch,
    resolveHostname: stubResolveHostname,
  });
  assert(
    lastFetchInit &&
      typeof lastFetchInit === "object" &&
      "dispatcher" in lastFetchInit,
    "doc URL fetch should include dispatcher to prevent DNS rebinding",
  );

  const oversizeLocation = `https://example.com/` + "a".repeat(2100);
  const oversizeRedirectMap = new Map([
    [
      "https://short.example/oversize",
      new Response(null, {
        status: 302,
        headers: {
          location: oversizeLocation,
        },
      }),
    ],
    [oversizeLocation, new Response(null, { status: 200 })],
  ]);
  const oversizeRedirectFetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const response = oversizeRedirectMap.get(url);
    if (!response) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return response;
  };
  await assertRejects(
    () =>
      normalizeDocUrl("https://short.example/oversize", {
        fetch: oversizeRedirectFetch,
        resolveHostname: stubResolveHostname,
      }),
    "doc URL should reject canonical URL longer than 2048 after redirects",
  );

  const blockedResolver = async (hostname) => {
    switch (hostname) {
      case "blocked-loopback.example":
        return ["127.0.0.1"];
      case "blocked-private.example":
        return ["10.0.0.1"];
      case "blocked-metadata.example":
        return ["169.254.169.254"];
      case "blocked-v6-loopback.example":
        return ["::1"];
      case "blocked-v6-linklocal.example":
        return ["fe80::1"];
      case "blocked-v6-ula.example":
        return ["fc00::1"];
      case "blocked-mixed.example":
        return ["93.184.216.34", "10.0.0.1"];
      default:
        return ["93.184.216.34"];
    }
  };

  for (const hostname of [
    "blocked-loopback.example",
    "blocked-private.example",
    "blocked-metadata.example",
    "blocked-v6-loopback.example",
    "blocked-v6-linklocal.example",
    "blocked-v6-ula.example",
    "blocked-mixed.example",
  ]) {
    await assertRejects(
      () =>
        normalizeDocUrl(`https://${hostname}/a`, {
          fetch: okFetch,
          resolveHostname: blockedResolver,
        }),
      `doc SSRF blocking: ${hostname}`,
    );
  }

  console.log("[unit] inbox url normalization passed");
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

  const uploadUnauthorized = await fetch(`${apiBase}/api/uploads`, {
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

function generateStatusId(seed, index) {
  const suffix = String(index).padStart(2, "0");
  return `${seed}${suffix}`;
}

function assertNoTokenInLogs(server, token, label) {
  const stdout = server?.__output?.stdout ?? "";
  const stderr = server?.__output?.stderr ?? "";
  const combined = `${stdout}\n${stderr}`;
  assert(
    !combined.includes(token),
    `${label}: token must not appear in server stdout/stderr`,
  );
}

async function runInboxSession(apiKey, server) {
  const seed = Date.now();
  console.log("\n[session-4] inbox enqueue/list/patch checks");

  const unauthorizedCreate = await callJson("/api/inbox", {
    method: "POST",
    body: {
      url: "https://x.com/i/web/status/1",
      source: "x",
      client: "ios_shortcuts",
    },
  });
  assertErrorResponse(unauthorizedCreate, 401, "UNAUTHORIZED");

  const wrongTokenCreate = await callJson("/api/inbox", {
    method: "POST",
    headers: { Authorization: "Bearer wrong-token" },
    body: {
      url: "https://x.com/i/web/status/1",
      source: "x",
      client: "ios_shortcuts",
    },
  });
  assertErrorResponse(wrongTokenCreate, 401, "UNAUTHORIZED");

  const invalidBody = await callJson("/api/inbox", {
    method: "POST",
    apiKey,
    body: {
      url: "https://x.com/i/web/status/1",
      source: "x",
      client: "not-ios",
    },
  });
  assertErrorResponse(invalidBody, 400, "INVALID_INPUT");

  const invalidUrl = await callJson("/api/inbox", {
    method: "POST",
    apiKey,
    body: {
      url: "http://x.com/i/web/status/123",
      source: "x",
      client: "ios_shortcuts",
    },
  });
  assertErrorResponse(invalidUrl, 400, "INVALID_INPUT");

  const invalidDocScheme = await callJson("/api/inbox", {
    method: "POST",
    apiKey,
    body: {
      url: "http://example.com/a",
      source: "doc",
      client: "ios_shortcuts",
    },
  });
  assertErrorResponse(invalidDocScheme, 400, "INVALID_INPUT");

  const invalidDocPort = await callJson("/api/inbox", {
    method: "POST",
    apiKey,
    body: {
      url: "https://example.com:8443/a",
      source: "doc",
      client: "ios_shortcuts",
    },
  });
  assertErrorResponse(invalidDocPort, 400, "INVALID_INPUT");

  const invalidDocLocalhost = await callJson("/api/inbox", {
    method: "POST",
    apiKey,
    body: {
      url: "https://localhost/a",
      source: "doc",
      client: "ios_shortcuts",
    },
  });
  assertErrorResponse(invalidDocLocalhost, 400, "INVALID_INPUT");

  const statusId1 = generateStatusId(seed, 1);
  const created = await callJson("/api/inbox", {
    method: "POST",
    apiKey,
    body: {
      url: `https://twitter.com/i/web/status/${statusId1}`,
      source: "x",
      client: "ios_shortcuts",
      note: "test note",
    },
  });
  assert(created.status === 201, "valid POST /api/inbox should return 201");
  assert(
    typeof created.data?.id === "number",
    "inbox create response should include numeric id",
  );
  assert(
    created.data?.status === "queued",
    "inbox create response should be queued",
  );
  const inboxItemId1 = created.data.id;

  const docSeed = `doc-${seed}`;
  const docCreated = await callJson("/api/inbox", {
    method: "POST",
    apiKey,
    body: {
      url: `https://example.com/${docSeed}?utm_source=x&x=1#b`,
      source: "doc",
      client: "ios_shortcuts",
    },
  });
  assert(docCreated.status === 201, "doc POST /api/inbox should return 201");
  assert(
    typeof docCreated.data?.id === "number",
    "doc inbox create response should include numeric id",
  );
  const inboxDocId = docCreated.data.id;

  const duplicated = await callJson("/api/inbox", {
    method: "POST",
    apiKey,
    body: {
      url: `https://x.com/i/web/status/${statusId1}`,
      source: "x",
      client: "ios_shortcuts",
    },
  });
  assert(
    duplicated.status === 200,
    "duplicate POST /api/inbox should return 200",
  );
  assert(
    duplicated.data?.status === "duplicate",
    "duplicate POST /api/inbox should return duplicate status",
  );
  assert(
    duplicated.data?.id === inboxItemId1,
    "duplicate POST /api/inbox should return existing id",
  );

  const docDuplicated = await callJson("/api/inbox", {
    method: "POST",
    apiKey,
    body: {
      url: `https://example.com/${docSeed}?utm_medium=y&x=1#c`,
      source: "doc",
      client: "ios_shortcuts",
    },
  });
  assert(
    docDuplicated.status === 200,
    "duplicate doc POST /api/inbox should return 200",
  );
  assert(
    docDuplicated.data?.status === "duplicate",
    "duplicate doc POST /api/inbox should return duplicate status",
  );
  assert(
    docDuplicated.data?.id === inboxDocId,
    "duplicate doc POST /api/inbox should return existing id",
  );

  const listQueued = await callJson("/api/inbox", {
    apiKey,
  });
  assert(listQueued.status === 200, "GET /api/inbox should return 200");
  assert(
    Array.isArray(listQueued.data?.items),
    "GET /api/inbox response should include items array",
  );
  const queuedItem = listQueued.data.items.find(
    (item) => item.id === inboxItemId1,
  );
  assert(queuedItem, "queued item must be present in GET /api/inbox");
  assert(
    queuedItem.url === `https://x.com/i/web/status/${statusId1}`,
    "stored URL must be canonicalized",
  );
  const docItem = listQueued.data.items.find((item) => item.id === inboxDocId);
  assert(docItem, "doc item must be present in GET /api/inbox");
  assert(docItem.source === "doc", "stored doc item source should be included");
  assert(
    docItem.url === `https://example.com/${docSeed}?x=1`,
    "stored doc URL must be canonicalized",
  );
  assert(queuedItem.status === "queued", "stored status must be queued");

  const invalidStatusList = await callJson("/api/inbox?status=unknown", {
    apiKey,
  });
  assertErrorResponse(invalidStatusList, 400, "INVALID_INPUT");

  const invalidLimitList = await callJson("/api/inbox?limit=0", {
    apiKey,
  });
  assertErrorResponse(invalidLimitList, 400, "INVALID_INPUT");

  const patchInvalidId = await callJson("/api/inbox/abc", {
    method: "PATCH",
    apiKey,
    body: { status: "processed" },
  });
  assertErrorResponse(patchInvalidId, 400, "INVALID_INPUT");

  const patchMissing = await callJson("/api/inbox/999999", {
    method: "PATCH",
    apiKey,
    body: { status: "processed" },
  });
  assertErrorResponse(patchMissing, 404, "NOT_FOUND");

  const patchedProcessed = await callJson(`/api/inbox/${inboxItemId1}`, {
    method: "PATCH",
    apiKey,
    body: { status: "processed" },
  });
  assert(
    patchedProcessed.status === 200,
    "PATCH /api/inbox/:id should return 200",
  );
  assert(
    patchedProcessed.data?.status === "processed",
    "PATCH /api/inbox/:id should set processed",
  );

  const listQueuedAfter = await callJson("/api/inbox", {
    apiKey,
  });
  assert(listQueuedAfter.status === 200, "GET /api/inbox should return 200");
  const stillQueued = listQueuedAfter.data.items.find(
    (item) => item.id === inboxItemId1,
  );
  assert(!stillQueued, "processed item must not be listed in queued items");

  const listProcessed = await callJson("/api/inbox?status=processed", {
    apiKey,
  });
  assert(
    listProcessed.status === 200,
    "GET /api/inbox?status=processed should return 200",
  );
  const processedItem = listProcessed.data.items.find(
    (item) => item.id === inboxItemId1,
  );
  assert(processedItem, "processed item must be listed in processed items");
  assert(
    processedItem.status === "processed",
    "processed list entry must have processed status",
  );

  const invalidTransition = await callJson(`/api/inbox/${inboxItemId1}`, {
    method: "PATCH",
    apiKey,
    body: { status: "failed", error: "should not be allowed" },
  });
  assertErrorResponse(invalidTransition, 400, "INVALID_INPUT");

  const statusId2 = generateStatusId(seed, 2);
  const created2 = await callJson("/api/inbox", {
    method: "POST",
    apiKey,
    body: {
      url: `https://x.com/i/web/status/${statusId2}`,
      source: "x",
      client: "ios_shortcuts",
    },
  });
  assert(created2.status === 201, "second inbox create should return 201");
  const inboxItemId2 = created2.data.id;

  const failedError = `failed-${seed}`;
  const patchedFailed = await callJson(`/api/inbox/${inboxItemId2}`, {
    method: "PATCH",
    apiKey,
    body: { status: "failed", error: failedError },
  });
  assert(
    patchedFailed.status === 200,
    "PATCH /api/inbox/:id failed should return 200",
  );
  assert(
    patchedFailed.data?.status === "failed",
    "PATCH /api/inbox/:id should set failed",
  );

  const listFailed = await callJson("/api/inbox?status=failed", {
    apiKey,
  });
  assert(
    listFailed.status === 200,
    "GET /api/inbox?status=failed should return 200",
  );
  const failedItem = listFailed.data.items.find(
    (item) => item.id === inboxItemId2,
  );
  assert(failedItem, "failed item must be listed in failed items");
  assert(failedItem.error === failedError, "failed item should persist error");

  assertNoTokenInLogs(server, apiKey, "session-4 logs");
}

async function runInboxRateLimitSession(apiKey, server) {
  const seed = Date.now();
  console.log("\n[session-5] inbox rate limit checks");

  const results = [];
  for (let index = 1; index <= 4; index += 1) {
    const statusId = generateStatusId(seed, index);
    const result = await callJson("/api/inbox", {
      method: "POST",
      apiKey,
      body: {
        url: `https://x.com/i/web/status/${statusId}`,
        source: "x",
        client: "ios_shortcuts",
      },
    });

    results.push(result);
  }

  assert(
    results[0].status === 201 && results[1].status === 201,
    "first two inbox requests must be allowed",
  );
  assertErrorResponse(results[2], 429, "RATE_LIMITED");
  assertErrorResponse(results[3], 429, "RATE_LIMITED");

  const retryAfterMs = results[2].data?.error?.details?.retryAfterMs;
  assert(
    typeof retryAfterMs === "number" && retryAfterMs > 0,
    "429 response should include retryAfterMs",
  );

  const retryAfterHeader = results[2].headers.get("Retry-After");
  assert(
    typeof retryAfterHeader === "string" && retryAfterHeader.length > 0,
    "429 response should include Retry-After header",
  );
  const expectedSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  assert(
    retryAfterHeader === String(expectedSeconds),
    `Retry-After must match retryAfterMs (${retryAfterHeader} vs ${expectedSeconds})`,
  );

  assertNoTokenInLogs(server, apiKey, "session-5 logs");
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
    await runInboxUrlUnitTests();
    await cleanupTestDb();

    server = await startServer(apiKey);
    await runSessionOne(apiKey, uploadedFiles);

    await stopServer(server);
    server = await startServer(apiKey);
    await runSessionTwo(apiKey);

    await stopServer(server);
    server = await startServer(apiKey);
    await runRateLimitSession(apiKey);

    await stopServer(server);
    server = await startServer(apiKey, {
      env: {
        INBOX_DOC_TEST_STUB_NETWORK: "1",
      },
    });
    await runInboxSession(apiKey, server);

    await stopServer(server);
    server = await startServer(apiKey, {
      env: {
        INBOX_RATE_LIMIT_MAX_REQUESTS: "2",
        INBOX_RATE_LIMIT_WINDOW_MS: "60000",
      },
    });
    await runInboxRateLimitSession(apiKey, server);

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
