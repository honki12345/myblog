import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";

const ROOT = process.cwd();
const NPX_COMMAND = process.platform === "win32" ? "npx.cmd" : "npx";

const PROJECTS = ["mobile-360", "tablet-768", "desktop-1440"];

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function isTruthyEnv(value) {
  if (!value) {
    return false;
  }
  return value !== "0";
}

function parsePositiveIntegerEnv(envValue, fallback, { minimum = 1 } = {}) {
  if (!envValue) {
    return fallback;
  }

  const parsed = Number.parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }

  return parsed;
}

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort, maxAttempts = 50) {
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

function resolvePortBase() {
  const defaultBase = process.env.CI ? 3000 : 3400;
  return parsePositiveIntegerEnv(
    process.env.PLAYWRIGHT_PORT_BASE?.trim(),
    defaultBase,
  );
}

async function resolvePlaywrightPort(portBase) {
  const explicitPort = parsePositiveIntegerEnv(
    process.env.PLAYWRIGHT_PORT?.trim(),
    null,
  );
  if (explicitPort !== null) {
    if (!(await canBindPort(explicitPort))) {
      throw new Error(`PLAYWRIGHT_PORT=${explicitPort} is already in use`);
    }

    return explicitPort;
  }

  // In CI, keep the default port stable so it stays consistent with the build artifact.
  if (process.env.CI && !process.env.PLAYWRIGHT_PORT_BASE) {
    if (!(await canBindPort(portBase))) {
      throw new Error(
        `CI expects port ${portBase} to be free. Set PLAYWRIGHT_PORT_BASE to override or stop the process using the port.`,
      );
    }

    return portBase;
  }

  return findAvailablePort(portBase);
}

function hasProjectArg(args) {
  return args.some((arg, index) => {
    if (arg === "--project") {
      return typeof args[index + 1] === "string";
    }
    return arg.startsWith("--project=");
  });
}

function runPlaywright(args, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(NPX_COMMAND, ["playwright", "test", ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `playwright test failed with code ${code ?? "null"}${signal ? ` (signal: ${signal})` : ""}`,
        ),
      );
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const portBase = resolvePortBase();
  const port = await resolvePlaywrightPort(portBase);
  const skipBuild = isTruthyEnv(process.env.PLAYWRIGHT_SKIP_BUILD);

  if (hasProjectArg(args)) {
    await runPlaywright(args, { PLAYWRIGHT_PORT: String(port) });
    return;
  }

  for (let index = 0; index < PROJECTS.length; index += 1) {
    const project = PROJECTS[index];
    if (index > 0) {
      await waitForPortToBeFree(port);
    }

    const envOverrides = {
      PLAYWRIGHT_PORT: String(port),
    };

    // When running all viewports locally, build once and reuse the outputs.
    if (!skipBuild && index > 0) {
      envOverrides.PLAYWRIGHT_SKIP_BUILD = "1";
    }

    const startedAt = Date.now();
    console.log(
      `[test:ui] running project=${project} (PORT=${envOverrides.PLAYWRIGHT_PORT})`,
    );
    await runPlaywright([`--project=${project}`, ...args], envOverrides);
    const durationMs = Date.now() - startedAt;
    console.log(
      `[test:ui] project=${project} done in ${formatDuration(durationMs)}`,
    );
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[test:ui] failed: ${message}`);
  process.exitCode = 1;
});
