import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

const ROOT = process.cwd();
const DEFAULT_PORT = 3200;
const DEV_SERVER_HOST = "127.0.0.1";
const TEST_DB_PATH = path.join(ROOT, "data", "test-step8.db");
const TEST_DB_WAL_PATH = `${TEST_DB_PATH}-wal`;
const TEST_DB_SHM_PATH = `${TEST_DB_PATH}-shm`;
const TEST_DB_FILES = [TEST_DB_PATH, TEST_DB_WAL_PATH, TEST_DB_SHM_PATH];
const LOCAL_LOG_MODE = process.argv.includes("--journalctl")
  ? "journalctl"
  : "stdout";
const JOURNAL_SERVICE = process.env.STEP8_JOURNAL_SERVICE ?? "blog";

let apiBase = `http://127.0.0.1:${DEFAULT_PORT}`;

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

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({ code: code ?? 1, stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with code ${code}\n${stderr || stdout}`,
        ),
      );
    });
  });
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

async function startServer(apiKey, logs) {
  const startPort = parsePositiveIntegerEnv(
    process.env.STEP8_PORT_BASE,
    DEFAULT_PORT,
  );
  const port = await findAvailablePort(startPort);
  apiBase = `http://${DEV_SERVER_HOST}:${port}`;

  const child = spawn(
    "node",
    [
      "node_modules/next/dist/bin/next",
      "dev",
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
        RATE_LIMIT_BULK_MAX_REQUESTS:
          process.env.RATE_LIMIT_BULK_MAX_REQUESTS ?? "3",
        RATE_LIMIT_BULK_WINDOW_MS:
          process.env.RATE_LIMIT_BULK_WINDOW_MS ?? "60000",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.__step8Port = port;

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

  const port = typeof child.__step8Port === "number" ? child.__step8Port : null;
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
      // The process may have already exited (ESRCH); ignore shutdown races.
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
            // The process may have already exited (ESRCH); ignore shutdown races.
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
    // Ensure the port is actually free before starting the next session.
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
    headers: response.headers,
  };
}

function assertBulkError(response, expectedStatus, expectedCode) {
  assert(
    response.status === expectedStatus,
    `expected bulk status ${expectedStatus}, received ${response.status}`,
  );
  assert(
    response.data && typeof response.data === "object",
    "bulk response should be JSON object",
  );
  assert(
    response.data.code === expectedCode,
    `expected bulk code ${expectedCode}, received ${response.data.code}`,
  );
  assert(
    Array.isArray(response.data.errors),
    "bulk error response should include errors array",
  );
  assert(
    Array.isArray(response.data.created) && response.data.created.length === 0,
    "bulk error response created should be []",
  );
}

function countPostsWithSourceUrls(sourceUrls) {
  if (sourceUrls.length === 0) {
    return 0;
  }

  const placeholders = sourceUrls.map(() => "?").join(", ");
  const db = new Database(TEST_DB_PATH, { readonly: true });

  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM posts WHERE source_url IN (${placeholders})`,
      )
      .get(...sourceUrls);
    return Number(row.count ?? 0);
  } finally {
    db.close();
  }
}

function loadSourceMetadata(url) {
  const db = new Database(TEST_DB_PATH, { readonly: true });

  try {
    const row = db
      .prepare(
        `
        SELECT ai_model, prompt_hint
        FROM sources
        WHERE url = ?
        ORDER BY id DESC
        LIMIT 1
        `,
      )
      .get(url);
    return row ?? null;
  } finally {
    db.close();
  }
}

async function runBulkCoreChecks(apiKey) {
  console.log("\n[session-1] bulk success + validation + atomic rollback");
  const seed = Date.now();

  const successResponse = await requestJson("/api/posts/bulk", {
    method: "POST",
    apiKey,
    body: {
      posts: [
        { title: `벌크 글 A-${seed}`, content: "내용 A", tags: ["bulk"] },
        { title: `벌크 글 B-${seed}`, content: "내용 B", tags: ["bulk"] },
        { title: `벌크 글 C-${seed}`, content: "내용 C", tags: ["bulk"] },
      ],
    },
  });
  assert(successResponse.status === 201, "bulk success should return 201");
  assert(
    Array.isArray(successResponse.data?.created) &&
      successResponse.data.created.length === 3,
    "bulk success should create 3 posts",
  );
  assert(
    Array.isArray(successResponse.data?.errors) &&
      successResponse.data.errors.length === 0,
    "bulk success errors should be empty",
  );
  for (const createdItem of successResponse.data.created) {
    assert(
      typeof createdItem.id === "number" &&
        typeof createdItem.slug === "string" &&
        createdItem.slug.length > 0,
      "bulk created item should include id and slug",
    );
  }

  const posts = Array.from({ length: 11 }, (_, index) => ({
    title: `bulk-limit-${seed}-${index}`,
    content: `content-${index}`,
  }));
  const limitResponse = await requestJson("/api/posts/bulk", {
    method: "POST",
    apiKey,
    body: { posts },
  });
  assertBulkError(limitResponse, 400, "INVALID_INPUT");

  const atomicA = `https://example.com/step8-atomic-a-${seed}`;
  const atomicC = `https://example.com/step8-atomic-c-${seed}`;
  const rollbackResponse = await requestJson("/api/posts/bulk", {
    method: "POST",
    apiKey,
    body: {
      posts: [
        { title: `원자성-A-${seed}`, content: "ok", sourceUrl: atomicA },
        { title: "", content: "invalid title" },
        { title: `원자성-C-${seed}`, content: "ok", sourceUrl: atomicC },
      ],
    },
  });
  assertBulkError(rollbackResponse, 400, "INVALID_INPUT");

  const rollbackCount = countPostsWithSourceUrls([atomicA, atomicC]);
  assert(
    rollbackCount === 0,
    `atomic rollback failed, expected 0 rows but received ${rollbackCount}`,
  );
}

async function runBulkDuplicateChecks(apiKey) {
  console.log("\n[session-2] bulk duplicate checks");
  const seed = Date.now();
  const requestDuplicateUrl = `https://example.com/step8-dup-req-${seed}`;

  const duplicateInRequest = await requestJson("/api/posts/bulk", {
    method: "POST",
    apiKey,
    body: {
      posts: [
        { title: "중복 요청 1", content: "ok", sourceUrl: requestDuplicateUrl },
        { title: "중복 요청 2", content: "ok", sourceUrl: requestDuplicateUrl },
      ],
    },
  });
  assertBulkError(duplicateInRequest, 409, "DUPLICATE_SOURCE");

  const existingUrl = `https://example.com/step8-dup-existing-${seed}`;
  const singleCreate = await requestJson("/api/posts", {
    method: "POST",
    apiKey,
    body: {
      title: `single-${seed}`,
      content: "single content",
      sourceUrl: existingUrl,
      status: "published",
    },
  });
  assert(
    singleCreate.status === 201,
    `single create for duplicate setup should return 201, got ${singleCreate.status}`,
  );

  const duplicateExisting = await requestJson("/api/posts/bulk", {
    method: "POST",
    apiKey,
    body: {
      posts: [
        {
          title: `중복 기존 데이터-${seed}`,
          content: "ok",
          sourceUrl: existingUrl,
        },
      ],
    },
  });
  assertBulkError(duplicateExisting, 409, "DUPLICATE_SOURCE");
}

async function runBulkRaceCheck(apiKey) {
  console.log("\n[session-3] bulk race check");
  const seed = Date.now();
  const raceUrl = `https://example.com/step8-race-${seed}`;
  const body = {
    posts: [{ title: `경합-${seed}`, content: "내용", sourceUrl: raceUrl }],
  };

  const [first, second] = await Promise.all([
    requestJson("/api/posts/bulk", { method: "POST", apiKey, body }),
    requestJson("/api/posts/bulk", { method: "POST", apiKey, body }),
  ]);

  const statuses = [first.status, second.status].sort((a, b) => a - b);
  assert(
    statuses[0] === 201 && statuses[1] === 409,
    `race statuses must be [201,409], received [${statuses.join(",")}]`,
  );

  if (first.status === 409) {
    assertBulkError(first, 409, "DUPLICATE_SOURCE");
  }
  if (second.status === 409) {
    assertBulkError(second, 409, "DUPLICATE_SOURCE");
  }

  const count = countPostsWithSourceUrls([raceUrl]);
  assert(count === 1, `race should create exactly one row, received ${count}`);
}

async function runBulkRateLimitCheck(apiKey) {
  console.log("\n[session-4] bulk rate limit check");
  const seed = Date.now();
  const responses = [];

  for (let index = 1; index <= 4; index += 1) {
    responses.push(
      await requestJson("/api/posts/bulk", {
        method: "POST",
        apiKey,
        body: {
          posts: [
            {
              title: `rate-bulk-${seed}-${index}`,
              content: "본문",
              sourceUrl: `https://example.com/step8-rate-${seed}-${index}`,
            },
          ],
        },
      }),
    );
  }

  assert(
    responses[0].status === 201 &&
      responses[1].status === 201 &&
      responses[2].status === 201,
    "bulk rate limit first three requests must be 201",
  );
  assertBulkError(responses[3], 429, "RATE_LIMITED");
  assert(
    typeof responses[3].data.retryAfterMs === "number" &&
      responses[3].data.retryAfterMs >= 0,
    "429 response should include numeric retryAfterMs",
  );
}

function parseStructuredLogEntries(lines) {
  const parsed = [];

  for (const line of lines) {
    let candidate;
    try {
      candidate = JSON.parse(line);
    } catch {
      continue;
    }

    if (
      candidate &&
      typeof candidate === "object" &&
      typeof candidate.route === "string" &&
      typeof candidate.status === "number"
    ) {
      parsed.push({ line, entry: candidate });
    }
  }

  return parsed;
}

async function loadJournalLogLines() {
  const result = await runCommand(
    "journalctl",
    ["-u", JOURNAL_SERVICE, "-n", "200", "--no-pager"],
    { allowFailure: false },
  );
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function validateStructuredLogFields(parsedEntries) {
  for (const { entry } of parsedEntries) {
    const requiredStringKeys = ["timestamp", "route", "payloadHash"];
    const requiredNumberKeys = [
      "status",
      "durationMs",
      "postCount",
      "contentLengthSum",
      "sourceUrlCount",
    ];

    for (const key of requiredStringKeys) {
      assert(
        typeof entry[key] === "string" && entry[key].length > 0,
        `structured log missing string key: ${key}`,
      );
    }

    for (const key of requiredNumberKeys) {
      assert(
        typeof entry[key] === "number",
        `structured log missing numeric key: ${key}`,
      );
    }
  }
}

async function runMetadataAndLogChecks(apiKey, logs) {
  console.log("\n[session-5] metadata + structured log checks");
  const seed = Date.now();

  const metadataSourceUrl = `https://example.com/step8-meta-${seed}`;
  const singleTitle = `STEP8-LOG-TITLE-${seed}`;
  const singleContent = `STEP8-LOG-CONTENT-${seed}`;
  const singlePromptHint = `STEP8-LOG-PROMPT-${seed}`;

  const singleCreate = await requestJson("/api/posts", {
    method: "POST",
    apiKey,
    body: {
      title: singleTitle,
      content: singleContent,
      sourceUrl: metadataSourceUrl,
      status: "published",
      aiModel: "gpt-5",
      promptHint: singlePromptHint,
    },
  });
  assert(
    singleCreate.status === 201,
    `metadata save create should return 201, received ${singleCreate.status}`,
  );

  const savedSource = loadSourceMetadata(metadataSourceUrl);
  assert(savedSource, "source metadata row should exist");
  assert(
    savedSource.ai_model === "gpt-5",
    `ai_model mismatch: expected gpt-5, received ${savedSource.ai_model}`,
  );
  assert(
    savedSource.prompt_hint === singlePromptHint,
    `prompt_hint mismatch: expected ${singlePromptHint}, received ${savedSource.prompt_hint}`,
  );

  const bulkTitle = `STEP8-BULK-TITLE-${seed}`;
  const bulkContent = `STEP8-BULK-CONTENT-${seed}`;
  const bulkPromptHint = `STEP8-BULK-PROMPT-${seed}`;
  const bulkCreate = await requestJson("/api/posts/bulk", {
    method: "POST",
    apiKey,
    body: {
      posts: [
        {
          title: bulkTitle,
          content: bulkContent,
          sourceUrl: `https://example.com/step8-log-bulk-${seed}`,
          status: "draft",
          aiModel: "gpt-5-mini",
          promptHint: bulkPromptHint,
        },
      ],
    },
  });
  assert(
    bulkCreate.status === 201,
    `bulk create for log check should return 201, received ${bulkCreate.status}`,
  );

  await sleep(500);

  const targetLogLines =
    LOCAL_LOG_MODE === "journalctl" ? await loadJournalLogLines() : logs;
  const parsed = parseStructuredLogEntries(targetLogLines).filter(
    ({ entry }) =>
      entry.route === "POST /api/posts" ||
      entry.route === "POST /api/posts/bulk",
  );

  assert(
    parsed.some(
      ({ entry }) => entry.route === "POST /api/posts" && entry.status === 201,
    ),
    "structured log must include POST /api/posts success entry",
  );
  assert(
    parsed.some(
      ({ entry }) =>
        entry.route === "POST /api/posts/bulk" && entry.status === 201,
    ),
    "structured log must include POST /api/posts/bulk success entry",
  );
  validateStructuredLogFields(parsed);

  const sensitiveMarkers = [
    singleTitle,
    singleContent,
    singlePromptHint,
    bulkTitle,
    bulkContent,
    bulkPromptHint,
  ];

  for (const marker of sensitiveMarkers) {
    assert(
      !parsed.some(({ line }) => line.includes(marker)),
      `structured log leaked sensitive payload fragment: ${marker}`,
    );
  }
}

async function runSession(apiKey, runner) {
  const logs = [];
  const server = await startServer(apiKey, logs);

  try {
    await runner(logs);
  } finally {
    await stopServer(server);
  }
}

async function main() {
  const apiKey = await resolveApiKey();

  await cleanupTestDb();

  try {
    await runSession(apiKey, () => runBulkCoreChecks(apiKey));
    await runSession(apiKey, () => runBulkDuplicateChecks(apiKey));
    await runSession(apiKey, () => runBulkRaceCheck(apiKey));
    await runSession(apiKey, () => runBulkRateLimitCheck(apiKey));
    await runSession(apiKey, (logs) => runMetadataAndLogChecks(apiKey, logs));

    console.log("\nStep 8 checks passed.");
  } finally {
    await cleanupTestDb();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nStep 8 checks failed: ${message}`);
  process.exitCode = 1;
});
