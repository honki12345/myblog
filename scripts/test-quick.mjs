import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";

const ROOT = process.cwd();
const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function pipeWithPrefix(stream, prefix, output = process.stdout) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.length === 0) {
        output.write("\n");
      } else {
        output.write(`[${prefix}] ${line}\n`);
      }
    }
  });

  stream.on("end", () => {
    if (buffer.length > 0) {
      output.write(`[${prefix}] ${buffer}\n`);
      buffer = "";
    }
  });
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once("error", () => {
      resolve(false);
    });

    server.listen({ port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort, maxAttempts = 100) {
  for (let port = startPort; port < startPort + maxAttempts; port += 1) {
    if (await canBindPort(port)) {
      return port;
    }
  }

  throw new Error(`unable to find available port from ${startPort}`);
}

async function stopProcess(
  child,
  { termTimeoutMs = 5000, killWaitMs = 2000 } = {},
) {
  if (!child || !isRunning(child)) {
    return;
  }

  const closed = new Promise((resolve) => {
    child.once("close", () => resolve());
  });

  child.kill("SIGTERM");
  const terminated = await Promise.race([
    closed.then(() => true),
    delay(termTimeoutMs).then(() => false),
  ]);

  if (!terminated && isRunning(child)) {
    child.kill("SIGKILL");
    await Promise.race([closed, delay(killWaitMs)]);
  }
}

function startScript(scriptName, options = {}) {
  const label = options.label ?? scriptName;
  const args = ["run", scriptName];
  if (Array.isArray(options.args) && options.args.length > 0) {
    args.push(...options.args);
  }

  const child = spawn(NPM_COMMAND, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  pipeWithPrefix(child.stdout, label, process.stdout);
  pipeWithPrefix(child.stderr, `${label}:err`, process.stderr);

  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${label} failed with code ${code ?? "null"}${signal ? ` (signal: ${signal})` : ""}`,
        ),
      );
    });
  });

  return { child, done, label };
}

async function runSingle(scriptName, options = {}) {
  const startedAt = Date.now();
  const { done, label } = startScript(scriptName, options);
  await done;
  const durationMs = Date.now() - startedAt;
  console.log(`[test:quick] ${label} done in ${formatDuration(durationMs)}`);
  return durationMs;
}

async function runParallelGroup(groupName, entries) {
  const startedAt = Date.now();
  const processes = entries.map((entry) =>
    startScript(entry.script, {
      label: entry.label ?? entry.script,
      env: entry.env,
    }),
  );

  let firstError = null;

  const wrapped = processes.map((proc) =>
    proc.done.catch((error) => {
      if (!firstError) {
        firstError = error;
      }
      throw error;
    }),
  );

  try {
    await Promise.all(wrapped);
  } catch {
    await Promise.allSettled(processes.map((proc) => stopProcess(proc.child)));
    throw firstError ?? new Error(`${groupName} failed`);
  }

  const durationMs = Date.now() - startedAt;
  console.log(
    `[test:quick] ${groupName} done in ${formatDuration(durationMs)}`,
  );
  return durationMs;
}

async function main() {
  const totalStartedAt = Date.now();

  console.log("[test:quick] start");
  await runSingle("test:step1");
  await runParallelGroup("group-a(step2+step4)", [
    { script: "test:step2", label: "step2" },
    { script: "test:step4", label: "step4" },
  ]);
  await runSingle("test:step3", {
    env: { STEP3_PORT_BASE: "3300" },
  });
  await runSingle("test:step5", {
    env: { STEP5_PORT_BASE: "3100" },
  });
  await runSingle("test:step8", {
    env: { STEP8_PORT_BASE: "3200" },
  });

  const uiPort = await findAvailablePort(
    Number.parseInt(process.env.PLAYWRIGHT_PORT_BASE ?? "", 10) || 3400,
  );
  await runSingle("test:ui:fast", {
    env: {
      PLAYWRIGHT_PORT: String(uiPort),
      PLAYWRIGHT_SKIP_BUILD: "1",
    },
  });

  const totalDurationMs = Date.now() - totalStartedAt;
  console.log(
    `[test:quick] total done in ${formatDuration(totalDurationMs)} (${totalDurationMs}ms)`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[test:quick] failed: ${message}`);
  process.exitCode = 1;
});
