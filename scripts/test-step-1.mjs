import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import process from "node:process";

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

      reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
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

  const lines = template
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.some((line) => line.startsWith("BLOG_API_KEY="))) {
    lines.push("BLOG_API_KEY=change-this-local-api-key");
  }

  const content = `${lines.join("\n")}\n`;
  try {
    await writeFile(".env.local", content, { flag: "wx" });
    console.log("Created .env.local from template for this local test run.");
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

async function testBuildArtifacts() {
  console.log("\n[1/6] npm run build");
  await run("npm", ["run", "build"]);

  console.log("\n[2/6] standalone build outputs");
  await assertFile(".next/standalone/server.js");
  await assertFile(".next/static");
}

async function testStandaloneServer() {
  console.log("\n[3/6] standalone server health check");
  const standalone = spawn("node", ["server.js"], {
    cwd: ".next/standalone",
    env: { ...process.env, PORT: "3001" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  standalone.stdout.on("data", (chunk) => process.stdout.write(chunk.toString()));
  standalone.stderr.on("data", (chunk) => process.stderr.write(chunk.toString()));

  try {
    await waitForHttpOk("http://localhost:3001");
  } finally {
    await stopProcess(standalone);
  }
}

async function testDevServer() {
  console.log("\n[4/6] dev server health check");
  const dev = spawn("node", ["node_modules/next/dist/bin/next", "dev", "--port", "3000"], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  dev.stdout.on("data", (chunk) => process.stdout.write(chunk.toString()));
  dev.stderr.on("data", (chunk) => process.stderr.write(chunk.toString()));

  try {
    await waitForHttpOk("http://localhost:3000");
  } finally {
    await stopProcess(dev);
  }
}

async function testEnvFiles() {
  console.log("\n[5/6] env file checks");
  await assertFile(".env.example");
  await ensureLocalEnvFile();
  await assertFile(".env.local");

  const { stdout } = await run("bash", ["-lc", "grep -q 'BLOG_API_KEY' .env.example && echo OK"]);
  if (!stdout.includes("OK")) {
    throw new Error(".env.example is missing BLOG_API_KEY");
  }
}

async function testGitignoreEntries() {
  console.log("\n[6/6] .gitignore checks");
  const checks = ["data/", "uploads/", ".env.local"];

  for (const value of checks) {
    const { stdout } = await run("bash", ["-lc", `grep -q '${value}' .gitignore && echo OK`]);
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
