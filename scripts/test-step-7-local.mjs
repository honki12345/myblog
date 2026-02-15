import { spawn } from "node:child_process";
import process from "node:process";

const SERVICE_NAME = "blog";
const ROOT_PORT = "3000";
const LOCAL_ROOT_URL = `http://127.0.0.1:${ROOT_PORT}/`;
const LOCAL_HEALTH_URL = `http://127.0.0.1:${ROOT_PORT}/api/health`;
const MEMORY_LIMIT_MB = 400;
const MEMORY_LIMIT_BYTES = MEMORY_LIMIT_MB * 1024 * 1024;
const TOTAL_USED_MEMORY_LIMIT_MB = 860;
const DB_PATH = "/var/lib/blog/data/blog.db";
const BACKUP_DIR = "/opt/blog/backups";
const EXPECTED_WORKING_DIRECTORY = "/opt/blog";
const EXPECTED_NODE_BIN_PREFIX = "/home/blog/.nvm/versions/node/";
const EXPECTED_NODE_BIN_SUFFIX = "/bin/node";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function parseMb(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

async function run(command, args, options = {}) {
  const { allowFailure = false, printCommand = true } = options;
  if (printCommand) {
    console.log(`$ ${formatCommand(command, args)}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
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
      const result = {
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };

      if (!allowFailure && result.code !== 0) {
        const details = [result.stderr, result.stdout]
          .filter(Boolean)
          .join("\n");
        reject(
          new Error(
            `${formatCommand(command, args)} failed with code ${result.code}${details ? `\n${details}` : ""}`,
          ),
        );
        return;
      }

      resolve(result);
    });
  });
}

async function ensureBinary(name) {
  const check = await run("bash", ["-lc", `command -v ${name}`], {
    allowFailure: true,
    printCommand: false,
  });
  assert(
    check.code === 0,
    `required command is missing: ${name}. install it before running test:step7-local`,
  );
}

async function detectPrivilegeMode() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return "root";
  }

  const sudoCheck = await run("sudo", ["-n", "true"], {
    allowFailure: true,
    printCommand: false,
  });
  if (sudoCheck.code === 0) {
    return "sudo";
  }

  return "none";
}

async function runPrivileged(privilegeMode, command, args, options = {}) {
  if (privilegeMode === "root") {
    return run(command, args, options);
  }

  if (privilegeMode === "sudo") {
    return run("sudo", ["-n", command, ...args], options);
  }

  throw new Error(
    `root or passwordless sudo is required for: ${formatCommand(command, args)}`,
  );
}

async function requestStatus(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "step7-local-check",
    },
  });
  return response.status;
}

async function waitForStatus(
  url,
  expectedStatus,
  retries = 15,
  delayMs = 1000,
) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const status = await requestStatus(url);
      if (status === expectedStatus) {
        return;
      }
    } catch {
      // ignore transient startup errors
    }

    if (attempt < retries) {
      await sleep(delayMs);
    }
  }

  throw new Error(
    `timed out waiting for ${url} to return status ${expectedStatus}`,
  );
}

function parseNumericValue(raw, label) {
  const value = Number.parseInt(raw.trim(), 10);
  assert(Number.isFinite(value), `${label} must be numeric, received: ${raw}`);
  return value;
}

function extractNodeBinFromExecStart(execStartValue) {
  const pathMatch = execStartValue.match(/\bpath=([^ ;}]+)/);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  const argvMatch = execStartValue.match(/\bargv\[\]=([^\s;]+)\s+server\.js\b/);
  if (argvMatch?.[1]) {
    return argvMatch[1];
  }

  const directMatch = execStartValue.match(/^([^\s]+)\s+server\.js\b/);
  if (directMatch?.[1]) {
    return directMatch[1];
  }

  return null;
}

function assertNvmNodeBin(nodeBin, execStartValue) {
  assert(
    typeof nodeBin === "string" && nodeBin.length > 0,
    `failed to parse node binary from ExecStart: ${execStartValue}`,
  );
  assert(
    nodeBin.startsWith(EXPECTED_NODE_BIN_PREFIX),
    `ExecStart node binary must start with ${EXPECTED_NODE_BIN_PREFIX}, received: ${nodeBin}`,
  );
  assert(
    nodeBin.endsWith(EXPECTED_NODE_BIN_SUFFIX),
    `ExecStart node binary must end with ${EXPECTED_NODE_BIN_SUFFIX}, received: ${nodeBin}`,
  );
}

async function checkServerEnvironment() {
  console.log("\n[1/4] server environment");
  await ensureBinary("caddy");
  await ensureBinary("systemctl");
  await ensureBinary("curl");
  await ensureBinary("sqlite3");
  await ensureBinary("crontab");

  const execStart = await run("systemctl", [
    "show",
    SERVICE_NAME,
    "--property=ExecStart",
    "--value",
  ]);
  const nodeBin = extractNodeBinFromExecStart(execStart.stdout);
  assertNvmNodeBin(nodeBin, execStart.stdout);

  const nodeVersion = await run(nodeBin, ["--version"]);
  assert(
    /^v22\./.test(nodeVersion.stdout),
    `node version must be v22.x, received: ${nodeVersion.stdout}`,
  );

  const caddyVersion = await run("caddy", ["version"]);
  assert(
    /\bv?2\./.test(caddyVersion.stdout),
    `caddy version must be v2.x, received: ${caddyVersion.stdout}`,
  );

  await run("free", ["-m"]);
  await run("df", ["-h", "/opt/blog"]);
  console.log("SERVER ENVIRONMENT PASSED");
}

async function ensureServiceActive(privilegeMode) {
  const current = await run("systemctl", ["is-active", SERVICE_NAME], {
    allowFailure: true,
  });

  if (current.stdout.trim() !== "active") {
    await runPrivileged(privilegeMode, "systemctl", ["start", SERVICE_NAME]);
  }

  const afterStart = await run("systemctl", ["is-active", SERVICE_NAME], {
    allowFailure: true,
  });
  assert(
    afterStart.stdout.trim() === "active",
    `${SERVICE_NAME} service must be active`,
  );
}

async function checkSystemdAndLocalPort(privilegeMode) {
  console.log("\n[2/4] systemd and local port");
  await ensureServiceActive(privilegeMode);

  const workingDirectory = await run("systemctl", [
    "show",
    SERVICE_NAME,
    "--property=WorkingDirectory",
    "--value",
  ]);
  assert(
    workingDirectory.stdout === EXPECTED_WORKING_DIRECTORY,
    `WorkingDirectory must be ${EXPECTED_WORKING_DIRECTORY}, received: ${workingDirectory.stdout}`,
  );

  const execStart = await run("systemctl", [
    "show",
    SERVICE_NAME,
    "--property=ExecStart",
    "--value",
  ]);
  const nodeBin = extractNodeBinFromExecStart(execStart.stdout);
  assertNvmNodeBin(nodeBin, execStart.stdout);
  assert(
    execStart.stdout.includes(nodeBin) &&
      execStart.stdout.includes("server.js"),
    `ExecStart must include node binary and server.js, received: ${execStart.stdout}`,
  );

  await waitForStatus(LOCAL_ROOT_URL, 200);
  await waitForStatus(LOCAL_HEALTH_URL, 200);
  console.log("SYSTEMD + LOCAL PORT PASSED");
}

async function checkMemory() {
  console.log("\n[3/4] memory limits");
  const freeOutput = await run("free", ["-m"]);
  const memLineMatch = freeOutput.stdout.match(
    /^Mem:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m,
  );
  assert(memLineMatch, "failed to parse free -m output");

  const totalMb = parseMb(memLineMatch[1]);
  const availableMb = parseMb(memLineMatch[6]);
  const usedMb =
    totalMb !== null && availableMb !== null ? totalMb - availableMb : null;
  assert(
    totalMb !== null && availableMb !== null && usedMb !== null,
    "invalid memory values",
  );
  assert(
    usedMb < TOTAL_USED_MEMORY_LIMIT_MB,
    `system memory used(total-available) must be < ${TOTAL_USED_MEMORY_LIMIT_MB}MB, received: ${usedMb}MB`,
  );

  const memoryMax = await run("systemctl", [
    "show",
    SERVICE_NAME,
    "--property=MemoryMax",
    "--value",
  ]);
  const memoryMaxBytes = parseNumericValue(memoryMax.stdout, "MemoryMax");
  assert(
    memoryMaxBytes === MEMORY_LIMIT_BYTES,
    `MemoryMax must be ${MEMORY_LIMIT_BYTES} bytes (400M), received: ${memoryMaxBytes}`,
  );

  const memoryCurrent = await run("systemctl", [
    "show",
    SERVICE_NAME,
    "--property=MemoryCurrent",
    "--value",
  ]);
  const memoryCurrentBytes = parseNumericValue(
    memoryCurrent.stdout,
    "MemoryCurrent",
  );
  assert(
    memoryCurrentBytes <= MEMORY_LIMIT_BYTES,
    `MemoryCurrent must be <= ${MEMORY_LIMIT_BYTES}, received: ${memoryCurrentBytes}`,
  );

  console.log("MEMORY LIMITS PASSED");
}

async function readCronTable(privilegeMode) {
  const userCron = await run("crontab", ["-l"], { allowFailure: true });
  if (userCron.code === 0 && userCron.stdout.length > 0) {
    return { source: "user", content: userCron.stdout };
  }

  if (privilegeMode !== "none") {
    const rootCron = await runPrivileged(privilegeMode, "crontab", ["-l"], {
      allowFailure: true,
    });
    if (rootCron.code === 0 && rootCron.stdout.length > 0) {
      return { source: "root", content: rootCron.stdout };
    }
  }

  throw new Error("unable to find crontab entries for backup checks");
}

function hasScheduledLine(content, hour, commandFragment) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  return lines.some((line) => {
    if (!line.includes(commandFragment)) {
      return false;
    }

    const fields = line.split(/\s+/);
    if (fields.length < 6) {
      return false;
    }

    return fields[0] === "0" && fields[1] === String(hour);
  });
}

function makeBackupPath() {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${BACKUP_DIR}/blog-${yyyy}${mm}${dd}-step7-${Date.now()}.db`;
}

async function checkBackupCronAndIntegrity(privilegeMode) {
  console.log("\n[4/4] backup cron and integrity");
  const cron = await readCronTable(privilegeMode);

  const hasBackupSchedule = hasScheduledLine(
    cron.content,
    3,
    `sqlite3 ${DB_PATH}`,
  );
  assert(
    hasBackupSchedule,
    `missing 03:00 sqlite3 backup schedule in ${cron.source} crontab`,
  );

  const hasPruneSchedule = hasScheduledLine(
    cron.content,
    4,
    "find /opt/blog/backups",
  );
  assert(
    hasPruneSchedule &&
      cron.content.includes("-mtime +7") &&
      cron.content.includes("-delete"),
    `missing 04:00 backup prune schedule in ${cron.source} crontab`,
  );

  const backupPath = makeBackupPath();
  try {
    await runPrivileged(privilegeMode, "install", [
      "-d",
      "-m",
      "755",
      BACKUP_DIR,
    ]);
    await runPrivileged(privilegeMode, "sqlite3", [
      DB_PATH,
      `.backup ${backupPath}`,
    ]);

    const integrity = await runPrivileged(privilegeMode, "sqlite3", [
      backupPath,
      "PRAGMA integrity_check;",
    ]);
    assert(
      integrity.stdout.toLowerCase().includes("ok"),
      `backup integrity check failed: ${integrity.stdout || integrity.stderr}`,
    );
  } finally {
    await runPrivileged(privilegeMode, "rm", ["-f", backupPath], {
      allowFailure: true,
    });
  }

  console.log("BACKUP CRON + INTEGRITY PASSED");
}

async function main() {
  assert(process.platform === "linux", "test:step7-local must run on linux VM");

  const privilegeMode = await detectPrivilegeMode();
  console.log(`privilege mode: ${privilegeMode}`);

  await checkServerEnvironment();
  await checkSystemdAndLocalPort(privilegeMode);
  await checkMemory();
  await checkBackupCronAndIntegrity(privilegeMode);

  console.log("\nSTEP 7 LOCAL TEST PASSED");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nSTEP 7 LOCAL TEST FAILED: ${message}`);
  process.exitCode = 1;
});
