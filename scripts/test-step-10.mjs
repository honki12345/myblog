import { spawn } from "node:child_process";
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

let apiBase = `http://${DEV_SERVER_HOST}:${DEFAULT_PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    [NEXT_BIN, "dev", "--hostname", DEV_SERVER_HOST, "--port", String(port)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        BLOG_API_KEY,
        DATABASE_PATH: TEST_DB_PATH,
        NEXT_PUBLIC_SITE_URL: apiBase,
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

  return {
    status: response.status,
    data,
    text,
  };
}

async function requestText(pathname) {
  const response = await fetch(`${apiBase}${pathname}`);
  const text = await response.text();
  return { status: response.status, text };
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
      searchHit.text.includes("Kubernetes 클러스터 관리"),
      "expected search results to include the created post title",
    );

    const searchMiss = await requestText(
      `/posts?q=${encodeURIComponent("존재하지않는검색어12345")}`,
    );
    assert(
      searchMiss.status === 200,
      `expected GET /posts?q=존재하지않는검색어12345 to return 200, got ${searchMiss.status}`,
    );
    assert(
      searchMiss.text.includes("검색 결과가 없습니다"),
      "expected empty search message",
    );

    const searchSyntaxError = await requestText(
      `/posts?q=${encodeURIComponent('"unclosed')}`,
    );
    assert(
      searchSyntaxError.status === 200,
      `expected GET /posts?q=%22unclosed to return 200, got ${searchSyntaxError.status}`,
    );
    assert(
      searchSyntaxError.text.includes("검색어가 올바르지 않습니다"),
      "expected invalid query message",
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
