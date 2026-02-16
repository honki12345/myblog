import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_PORT = 3300;
const TEST_DB_PATH = path.join(ROOT, "data", "test-step9.db");
const TEST_DB_WAL_PATH = `${TEST_DB_PATH}-wal`;
const TEST_DB_SHM_PATH = `${TEST_DB_PATH}-shm`;
const TEST_DB_FILES = [TEST_DB_PATH, TEST_DB_WAL_PATH, TEST_DB_SHM_PATH];

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin-password-1234";
const ADMIN_PASSWORD_HASH =
  process.env.ADMIN_PASSWORD_HASH ??
  "$argon2id$v=19$m=19456,t=2,p=1$IKB9DtSF0qPG5/YP8Iv25A$Ia5kZtdBS0EpKzo9eFpjq2zBlBWSayktEzMrUI81WHM";
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET ?? "JBSWY3DPEHPK3PXP";
const ADMIN_RECOVERY_CODES =
  process.env.ADMIN_RECOVERY_CODES ?? "RECOVERY-ONE,RECOVERY-TWO";

const TINY_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

let apiBase = `http://127.0.0.1:${DEFAULT_PORT}`;

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
  apiBase = `http://127.0.0.1:${port}`;

  const child = spawn(
    "node",
    ["node_modules/next/dist/bin/next", "dev", "--port", String(port)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_PATH: TEST_DB_PATH,
        NEXT_PUBLIC_SITE_URL: apiBase,
        BLOG_API_KEY: process.env.BLOG_API_KEY ?? "step9-ai-api-key",
        ADMIN_USERNAME,
        ADMIN_PASSWORD_HASH,
        ADMIN_SESSION_SECRET:
          process.env.ADMIN_SESSION_SECRET ?? "step9-session-secret-0123456789",
        ADMIN_TOTP_SECRET_ENCRYPTION_KEY:
          process.env.ADMIN_TOTP_SECRET_ENCRYPTION_KEY ??
          "step9-totp-encryption-key-0123456789",
        ADMIN_CSRF_SECRET:
          process.env.ADMIN_CSRF_SECRET ?? "step9-csrf-secret-0123456789",
        ADMIN_TOTP_SECRET,
        ADMIN_RECOVERY_CODES,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

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

  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 5000);
    child.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function requestJson(pathname, options = {}) {
  const {
    method = "GET",
    body,
    headers = {},
    jar,
    expectJson = true,
  } = options;
  const requestHeaders = { ...headers };

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

  let data = null;
  const text = await response.text();
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
    headers: response.headers,
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

async function runScenario() {
  const anonymous = await requestJson("/api/admin/notes");
  assert(anonymous.status === 401, "anonymous admin notes should return 401");

  const adminJar = new CookieJar();
  const loginStart = await requestJson("/api/admin/auth/login", {
    method: "POST",
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    jar: adminJar,
  });
  assert(loginStart.status === 200, "admin login primary should return 200");
  assert(
    loginStart.data?.requiresTwoFactor === true,
    "admin login should require two-factor",
  );

  const invalidVerify = await requestJson("/api/admin/auth/verify", {
    method: "POST",
    body: { code: "000000" },
    jar: adminJar,
  });
  assert(invalidVerify.status === 401, "invalid TOTP should return 401");

  const totpCode = generateTotpCode(ADMIN_TOTP_SECRET);
  const verifyOk = await requestJson("/api/admin/auth/verify", {
    method: "POST",
    body: { code: totpCode },
    jar: adminJar,
  });
  assert(verifyOk.status === 200, "valid TOTP should return 200");
  assert(adminJar.get("admin_session"), "admin session cookie should be set");
  assert(adminJar.get("admin_csrf"), "admin csrf cookie should be set");

  const verifyReuse = await requestJson("/api/admin/auth/verify", {
    method: "POST",
    body: { code: totpCode },
    jar: adminJar,
  });
  assert(
    verifyReuse.status === 401,
    "reusing same TOTP verification should return 401",
  );

  const noteTitle = `STEP9-NOTE-${Date.now()}`;
  const noteCreate = await requestJson("/api/admin/notes", {
    method: "POST",
    body: {
      title: noteTitle,
      content: "주간 점검 항목",
      isPinned: true,
    },
    jar: adminJar,
    headers: csrfHeaders(adminJar),
  });
  assert(noteCreate.status === 201, "admin notes create should return 201");
  assert(noteCreate.data?.title === noteTitle, "created note title mismatch");
  const noteId = noteCreate.data?.id;
  assert(Number.isInteger(noteId), "created note id should be integer");

  const noteList = await requestJson("/api/admin/notes", { jar: adminJar });
  assert(noteList.status === 200, "admin notes list should return 200");
  assert(
    Array.isArray(noteList.data?.items) &&
      noteList.data.items.some((item) => item.title === noteTitle),
    "created note should exist in list",
  );

  const notePatch = await requestJson(`/api/admin/notes/${noteId}`, {
    method: "PATCH",
    body: {
      title: `${noteTitle}-UPDATED`,
      isPinned: false,
    },
    jar: adminJar,
    headers: csrfHeaders(adminJar),
  });
  assert(notePatch.status === 200, "admin notes patch should return 200");
  assert(notePatch.data?.title.endsWith("-UPDATED"), "note update mismatch");

  const noteDelete = await requestJson(`/api/admin/notes/${noteId}`, {
    method: "DELETE",
    jar: adminJar,
    headers: csrfHeaders(adminJar),
  });
  assert(noteDelete.status === 200, "admin notes delete should return 200");

  const csrfRejected = await requestJson("/api/admin/notes", {
    method: "POST",
    body: {
      title: "CSRF-REJECT",
      content: "x",
      isPinned: false,
    },
    jar: adminJar,
  });
  assert(
    csrfRejected.status === 403 || csrfRejected.status === 401,
    "missing csrf should return 403 or 401",
  );

  const todoCreate = await requestJson("/api/admin/todos", {
    method: "POST",
    body: {
      title: "STEP9-TODO",
      status: "todo",
      priority: "high",
    },
    jar: adminJar,
    headers: csrfHeaders(adminJar),
  });
  assert(todoCreate.status === 201, "admin todo create should return 201");
  const todoId = todoCreate.data?.id;
  assert(Number.isInteger(todoId), "todo id should be integer");

  const todoDoing = await requestJson(`/api/admin/todos/${todoId}`, {
    method: "PATCH",
    body: { status: "doing" },
    jar: adminJar,
    headers: csrfHeaders(adminJar),
  });
  assert(todoDoing.status === 200, "todo status doing patch should return 200");
  assert(todoDoing.data?.status === "doing", "todo should be doing");

  const todoDone = await requestJson(`/api/admin/todos/${todoId}`, {
    method: "PATCH",
    body: { status: "done" },
    jar: adminJar,
    headers: csrfHeaders(adminJar),
  });
  assert(todoDone.status === 200, "todo status done patch should return 200");
  assert(todoDone.data?.status === "done", "todo should be done");

  const scheduleStart = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const scheduleEnd = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const scheduleCreate = await requestJson("/api/admin/schedules", {
    method: "POST",
    body: {
      title: "STEP9-SCHEDULE",
      description: "점검 일정",
      startAt: scheduleStart,
      endAt: scheduleEnd,
    },
    jar: adminJar,
    headers: csrfHeaders(adminJar),
  });
  assert(scheduleCreate.status === 201, "schedule create should return 201");
  const scheduleId = scheduleCreate.data?.id;
  assert(Number.isInteger(scheduleId), "schedule id should be integer");

  const rangeFrom = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rangeTo = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const scheduleRange = await requestJson(
    `/api/admin/schedules?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`,
    {
      jar: adminJar,
    },
  );
  assert(scheduleRange.status === 200, "schedule range list should return 200");
  assert(
    Array.isArray(scheduleRange.data?.items) &&
      scheduleRange.data.items.some((item) => item.id === scheduleId),
    "created schedule should appear in range query",
  );

  const schedulePatch = await requestJson(
    `/api/admin/schedules/${scheduleId}`,
    {
      method: "PATCH",
      body: { isDone: true },
      jar: adminJar,
      headers: csrfHeaders(adminJar),
    },
  );
  assert(schedulePatch.status === 200, "schedule patch should return 200");
  assert(schedulePatch.data?.isDone === true, "schedule should be marked done");

  const scheduleDelete = await requestJson(
    `/api/admin/schedules/${scheduleId}`,
    {
      method: "DELETE",
      jar: adminJar,
      headers: csrfHeaders(adminJar),
    },
  );
  assert(scheduleDelete.status === 200, "schedule delete should return 200");

  const aiUploadBlocked = await fetch(`${apiBase}/api/uploads`, {
    method: "POST",
    headers: {
      Cookie: adminJar.toHeader(),
    },
    body: new FormData(),
  });
  assert(
    aiUploadBlocked.status === 401 || aiUploadBlocked.status === 403,
    "admin session should not authorize /api/uploads",
  );

  const uploadForm = new FormData();
  uploadForm.set(
    "file",
    new File([TINY_PNG], "step9.png", {
      type: "image/png",
    }),
  );
  const adminUpload = await fetch(`${apiBase}/api/admin/uploads`, {
    method: "POST",
    headers: {
      Cookie: adminJar.toHeader(),
      ...csrfHeaders(adminJar),
    },
    body: uploadForm,
  });
  const adminUploadJson = await adminUpload.json();
  assert(adminUpload.status === 201, "admin upload should return 201");
  assert(
    typeof adminUploadJson.url === "string" &&
      adminUploadJson.url.startsWith("/uploads/"),
    "admin upload should return file url",
  );
  const uploadedFile = path.join(ROOT, adminUploadJson.url.replace(/^\//, ""));
  const uploadedStat = await stat(uploadedFile);
  assert(uploadedStat.size > 0, "uploaded admin file should exist");
  await rm(uploadedFile, { force: true });

  const recoveryJar = new CookieJar();
  const recoveryLogin = await requestJson("/api/admin/auth/login", {
    method: "POST",
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    jar: recoveryJar,
  });
  assert(
    recoveryLogin.status === 200,
    "recovery login start should return 200",
  );

  const recoveryVerify = await requestJson("/api/admin/auth/verify", {
    method: "POST",
    body: { code: "RECOVERY-ONE" },
    jar: recoveryJar,
  });
  assert(
    recoveryVerify.status === 200,
    "first recovery code verify should return 200",
  );

  const recoveryReuseJar = new CookieJar();
  const recoveryLoginAgain = await requestJson("/api/admin/auth/login", {
    method: "POST",
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    jar: recoveryReuseJar,
  });
  assert(
    recoveryLoginAgain.status === 200,
    "second recovery login start should return 200",
  );

  const recoveryReuse = await requestJson("/api/admin/auth/verify", {
    method: "POST",
    body: { code: "RECOVERY-ONE" },
    jar: recoveryReuseJar,
  });
  assert(
    recoveryReuse.status === 401,
    "reused recovery code should return 401",
  );

  const logout = await requestJson("/api/admin/auth/logout", {
    method: "POST",
    jar: adminJar,
    headers: csrfHeaders(adminJar),
  });
  assert(logout.status === 200, "logout should return 200");

  const afterLogout = await requestJson("/api/admin/notes", {
    jar: adminJar,
  });
  assert(
    afterLogout.status === 401,
    "admin notes should return 401 after logout",
  );
}

async function main() {
  const logs = [];
  let serverProcess;
  let failed = false;

  try {
    await cleanupTestDb();
    serverProcess = await startServer(logs);
    await runScenario();
    console.log("[test:step9] PASS");
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[test:step9] FAIL: ${message}`);
    console.error("[test:step9] recent server logs:");
    for (const line of logs.slice(-80)) {
      console.error(line);
    }
  } finally {
    await stopServer(serverProcess);
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[test:step9] fatal: ${message}`);
  process.exitCode = 1;
});
