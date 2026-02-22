import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const NEXT_BIN = require.resolve("next/dist/bin/next");

const ROOT = process.cwd();
const DEFAULT_PORT = 3350;
const DEV_SERVER_HOST = "127.0.0.1";
const TEST_DB_PATH = path.join(ROOT, "data", "test-step10.db");
const TEST_DB_WAL_PATH = `${TEST_DB_PATH}-wal`;
const TEST_DB_SHM_PATH = `${TEST_DB_PATH}-shm`;
const TEST_DB_FILES = [TEST_DB_PATH, TEST_DB_WAL_PATH, TEST_DB_SHM_PATH];

const BLOG_API_KEY = process.env.BLOG_API_KEY ?? "step10-ai-api-key";
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
          "step10-session-secret-0123456789",
        ADMIN_TOTP_SECRET_ENCRYPTION_KEY:
          process.env.ADMIN_TOTP_SECRET_ENCRYPTION_KEY ??
          "step10-totp-encryption-key-0123456789",
        ADMIN_CSRF_SECRET:
          process.env.ADMIN_CSRF_SECRET ?? "step10-csrf-secret-0123456789",
        ADMIN_TOTP_SECRET,
        ADMIN_RECOVERY_CODES,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.__step10Port = port;

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
    typeof child.__step10Port === "number" ? child.__step10Port : null;
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
  const { method = "GET", apiKey, body, headers = {}, jar } = options;
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
    text,
  };
}

async function requestText(pathname, options = {}) {
  const { headers = {}, jar } = options;
  const requestHeaders = { ...headers };
  if (jar) {
    const cookieHeader = jar.toHeader();
    if (cookieHeader) {
      requestHeaders.Cookie = cookieHeader;
    }
  }

  const response = await fetch(`${apiBase}${pathname}`, {
    headers: requestHeaders,
  });
  if (jar) {
    jar.updateFromResponse(response);
  }
  const text = await response.text();
  return {
    status: response.status,
    text,
    url: response.url,
    redirected: response.redirected,
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

async function authenticateAdminSession() {
  const jar = new CookieJar();

  const loginStart = await requestJson("/api/admin/auth/login", {
    method: "POST",
    body: {
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    },
    jar,
  });
  assert(
    loginStart.status === 200,
    `expected admin primary login to return 200, got ${loginStart.status}`,
  );

  const verify = await requestJson("/api/admin/auth/verify", {
    method: "POST",
    body: {
      code: generateTotpCode(ADMIN_TOTP_SECRET),
    },
    jar,
  });
  assert(
    verify.status === 200,
    `expected admin verify to return 200, got ${verify.status}`,
  );
  assert(jar.get("admin_session"), "admin_session cookie should exist");
  assert(jar.get("admin_csrf"), "admin_csrf cookie should exist");

  return jar;
}

function indexOfTitle(html, title) {
  const index = html.indexOf(title);
  assert(index >= 0, `expected html to include title: ${title}`);
  return index;
}

async function main() {
  const logs = [];

  await cleanupTestDb();
  const server = await startServer(logs);

  try {
    const created = await requestJson("/api/posts", {
      method: "POST",
      apiKey: BLOG_API_KEY,
      body: {
        title: "Kubernetes 클러스터 관리",
        content: "kubectl 명령어로 파드를 관리하는 방법",
        status: "published",
      },
    });

    assert(
      created.status === 201,
      `expected POST /api/posts to return 201, got ${created.status}`,
    );

    const searchHit = await requestText(
      `/posts?q=${encodeURIComponent("Kubernetes")}`,
    );
    assert(
      searchHit.status === 200,
      `expected GET /posts?q=Kubernetes to return 200, got ${searchHit.status}`,
    );
    assert(
      searchHit.redirected,
      "expected GET /posts?q=Kubernetes to redirect to admin login",
    );
    assert(
      searchHit.url.includes("/admin/login?next=%2Fposts%3Fq%3DKubernetes"),
      `expected redirected url to include encoded next path, got ${searchHit.url}`,
    );

    const searchMiss = await requestText(
      `/posts?q=${encodeURIComponent("존재하지않는검색어12345")}`,
    );
    assert(
      searchMiss.status === 200,
      `expected GET /posts?q=존재하지않는검색어12345 to return 200, got ${searchMiss.status}`,
    );
    assert(
      searchMiss.redirected,
      "expected GET /posts?q=존재하지않는검색어12345 to redirect to admin login",
    );

    const searchSyntaxError = await requestText(
      `/posts?q=${encodeURIComponent('"unclosed')}`,
    );
    assert(
      searchSyntaxError.status === 200,
      `expected GET /posts?q=%22unclosed to return 200, got ${searchSyntaxError.status}`,
    );
    assert(
      searchSyntaxError.redirected,
      "expected GET /posts?q=%22unclosed to redirect to admin login",
    );

    const listApi = await requestJson("/api/posts");
    assert(
      listApi.status === 401,
      `expected GET /api/posts to return 401 without admin session, got ${listApi.status}`,
    );

    const suggestApi = await requestJson(
      `/api/posts/suggest?q=${encodeURIComponent("Kubernetes")}`,
    );
    assert(
      suggestApi.status === 401,
      `expected GET /api/posts/suggest to return 401 without admin session, got ${suggestApi.status}`,
    );

    const unreadOlderTitle = `STEP10-UNREAD-OLDER-${Date.now()}`;
    const unreadNewerTitle = `STEP10-UNREAD-NEWER-${Date.now()}`;
    const readNewestTitle = `STEP10-READ-NEWEST-${Date.now()}`;

    const unreadOlder = await requestJson("/api/posts", {
      method: "POST",
      apiKey: BLOG_API_KEY,
      body: {
        title: unreadOlderTitle,
        content: "미읽음 오래된 글",
        status: "published",
      },
    });
    assert(
      unreadOlder.status === 201,
      `expected unread older seed to return 201, got ${unreadOlder.status}`,
    );
    const unreadOlderId = unreadOlder.data?.id;
    assert(
      Number.isInteger(unreadOlderId),
      "unread older id should be integer",
    );

    await sleep(5);

    const unreadNewer = await requestJson("/api/posts", {
      method: "POST",
      apiKey: BLOG_API_KEY,
      body: {
        title: unreadNewerTitle,
        content: "미읽음 최신 글",
        status: "published",
      },
    });
    assert(
      unreadNewer.status === 201,
      `expected unread newer seed to return 201, got ${unreadNewer.status}`,
    );
    const unreadNewerId = unreadNewer.data?.id;
    assert(
      Number.isInteger(unreadNewerId),
      "unread newer id should be integer",
    );

    await sleep(5);

    const readNewest = await requestJson("/api/posts", {
      method: "POST",
      apiKey: BLOG_API_KEY,
      body: {
        title: readNewestTitle,
        content: "읽음으로 바꿀 최신 글",
        status: "published",
      },
    });
    assert(
      readNewest.status === 201,
      `expected read newest seed to return 201, got ${readNewest.status}`,
    );
    const readNewestId = readNewest.data?.id;
    assert(Number.isInteger(readNewestId), "read newest id should be integer");

    const adminJar = await authenticateAdminSession();
    const markRead = await requestJson(`/api/admin/posts/${readNewestId}`, {
      method: "PATCH",
      jar: adminJar,
      headers: csrfHeaders(adminJar),
      body: { isRead: true },
    });
    assert(
      markRead.status === 200,
      `expected PATCH /api/admin/posts/${readNewestId} to return 200, got ${markRead.status}`,
    );
    assert(
      markRead.data?.is_read === 1,
      `expected readNewest is_read=1, got ${markRead.data?.is_read}`,
    );

    const archiveAll = await requestText("/posts?per_page=50", {
      jar: adminJar,
    });
    assert(
      archiveAll.status === 200,
      `expected authenticated GET /posts to return 200, got ${archiveAll.status}`,
    );
    assert(
      !archiveAll.redirected,
      "expected authenticated GET /posts to avoid redirect",
    );

    const unreadNewerIndex = indexOfTitle(archiveAll.text, unreadNewerTitle);
    const unreadOlderIndex = indexOfTitle(archiveAll.text, unreadOlderTitle);
    const readNewestIndex = indexOfTitle(archiveAll.text, readNewestTitle);
    assert(
      unreadNewerIndex < unreadOlderIndex,
      "expected unread newer post to appear before unread older post",
    );
    assert(
      unreadOlderIndex < readNewestIndex,
      "expected default sort to place unread posts before read posts",
    );

    const archiveUnread = await requestText("/posts?read=unread&per_page=50", {
      jar: adminJar,
    });
    assert(
      archiveUnread.status === 200,
      `expected authenticated GET /posts?read=unread to return 200, got ${archiveUnread.status}`,
    );
    assert(
      archiveUnread.text.includes(unreadOlderTitle),
      "expected unread filter results to include unread older post",
    );
    assert(
      archiveUnread.text.includes(unreadNewerTitle),
      "expected unread filter results to include unread newer post",
    );
    assert(
      !archiveUnread.text.includes(readNewestTitle),
      "expected unread filter results to exclude read posts",
    );
  } finally {
    await stopServer(server);
    await cleanupTestDb();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[step10] failed: ${message}`);
  process.exitCode = 1;
});
