import { spawn } from "node:child_process";
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

function resolvePortBase() {
  const defaultBase = process.env.CI ? 3000 : 3400;
  const raw = process.env.PLAYWRIGHT_PORT_BASE?.trim();
  if (!raw) {
    return defaultBase;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultBase;
  }

  return parsed;
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
  const skipBuild = isTruthyEnv(process.env.PLAYWRIGHT_SKIP_BUILD);

  if (hasProjectArg(args)) {
    await runPlaywright(args, { PLAYWRIGHT_PORT: String(portBase) });
    return;
  }

  for (let index = 0; index < PROJECTS.length; index += 1) {
    const project = PROJECTS[index];
    const envOverrides = {
      PLAYWRIGHT_PORT: String(portBase + index),
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
