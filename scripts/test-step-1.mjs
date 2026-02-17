import { spawn } from "node:child_process";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import process from "node:process";
import path from "node:path";

const require = createRequire(import.meta.url);
const NEXT_BIN = require.resolve("next/dist/bin/next");

let standaloneServerDir = path.join(".next", "standalone");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(`${command} ${args.join(" ")} failed with code ${code}`),
      );
    });
  });
}

async function waitForHttpOk(url, retries = 25, delayMs = 500) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // ignore transient startup errors
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function assertFile(pathname) {
  try {
    await access(pathname);
  } catch {
    throw new Error(`Missing expected path: ${pathname}`);
  }
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
    server.listen({ port, host: "127.0.0.1" }, () => {
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

async function resolveStandaloneServerDir() {
  const primaryServerPath = path.join(".next", "standalone", "server.js");

  try {
    await access(primaryServerPath);
    return path.dirname(primaryServerPath);
  } catch {
    // fallback to worktree-nested standalone layout
  }

  const worktreesDir = path.join(".next", "standalone", ".worktrees");
  try {
    const entries = await readdir(worktreesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = path.join(worktreesDir, entry.name, "server.js");
      try {
        await access(candidate);
        return path.dirname(candidate);
      } catch {
        // continue searching
      }
    }
  } catch {
    // fall through to final error
  }

  throw new Error("Missing expected standalone server entry: server.js");
}

async function ensureLocalEnvFile() {
  try {
    await access(".env.local");
    return;
  } catch {
    // continue to create from template
  }

  let template = "";
  try {
    template = await readFile(".env.example", "utf8");
  } catch {
    // .env.example validation is handled in testEnvFiles
  }

  // Next.js expands "$FOO" style placeholders inside env files.
  // Admin hashes/secrets often include "$" so keep them commented in generated `.env.local`
  // to avoid overriding test-provided env values (e.g. Step 9 / Playwright).
  const rawLines = template.split(/\r?\n/);
  let hasApiKey = false;

  const lines = rawLines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith("BLOG_API_KEY=")) {
        hasApiKey = true;
        return line;
      }

      if (line.startsWith("ADMIN_")) {
        return `# ${line}`;
      }

      return line;
    });

  if (!hasApiKey) {
    lines.unshift("BLOG_API_KEY=change-this-local-api-key");
  }

  const content = `${lines.join("\n")}\n`;
  try {
    await writeFile(".env.local", content, { flag: "wx" });
    console.log("Created .env.local for this local test run.");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return;
    }
    throw error;
  }
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
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

async function testBuildArtifacts() {
  console.log("\n[1/6] npm run build");
  await run("npm", ["run", "build"]);

  console.log("\n[2/6] standalone build outputs");
  standaloneServerDir = await resolveStandaloneServerDir();
  await assertFile(path.join(standaloneServerDir, "server.js"));
  await assertFile(".next/static");
}

async function testStandaloneServer() {
  console.log("\n[3/6] standalone server health check");
  const standalone = spawn("node", ["server.js"], {
    cwd: standaloneServerDir,
    env: { ...process.env, PORT: "3001" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  standalone.stdout.on("data", (chunk) =>
    process.stdout.write(chunk.toString()),
  );
  standalone.stderr.on("data", (chunk) =>
    process.stderr.write(chunk.toString()),
  );

  try {
    await waitForHttpOk("http://127.0.0.1:3001/api/health");
  } finally {
    await stopProcess(standalone);
  }
}

async function testDevServer() {
  console.log("\n[4/6] dev server health check");
  // Use a different port from other test steps to avoid flakey EADDRINUSE
  // when previous Next dev server shutdown is still in progress.
  const portBase = parsePositiveIntegerEnv(
    process.env.STEP1_DEV_PORT_BASE,
    3002,
  );
  const port = await findAvailablePort(portBase);
  const dev = spawn(
    "node",
    [NEXT_BIN, "dev", "--port", String(port)],
    {
      env: { ...process.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  dev.stdout.on("data", (chunk) => process.stdout.write(chunk.toString()));
  dev.stderr.on("data", (chunk) => process.stderr.write(chunk.toString()));

  try {
    await waitForHttpOk(`http://127.0.0.1:${port}/api/health`);
  } finally {
    await stopProcess(dev);
  }
}

async function testEnvFiles() {
  console.log("\n[5/6] env file checks");
  await assertFile(".env.example");
  await ensureLocalEnvFile();
  await assertFile(".env.local");

  const { stdout } = await run("bash", [
    "-lc",
    "grep -q 'BLOG_API_KEY' .env.example && echo OK",
  ]);
  if (!stdout.includes("OK")) {
    throw new Error(".env.example is missing BLOG_API_KEY");
  }
}

async function testGitignoreEntries() {
  console.log("\n[6/6] .gitignore checks");
  const checks = ["data/", "uploads/", ".env.local"];

  for (const value of checks) {
    const { stdout } = await run("bash", [
      "-lc",
      `grep -q '${value}' .gitignore && echo OK`,
    ]);
    if (!stdout.includes("OK")) {
      throw new Error(`.gitignore is missing ${value}`);
    }
  }
}

async function main() {
  await testBuildArtifacts();
  await testStandaloneServer();
  await testDevServer();
  await testEnvFiles();
  await testGitignoreEntries();

  console.log("\nStep 1 checks passed.");
}

main().catch((error) => {
  console.error("\nStep 1 checks failed:");
  console.error(error.message);
  process.exit(1);
});
