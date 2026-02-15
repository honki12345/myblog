import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PORT = 3102;
const REQUIRED_PATH_FILTERS = ["src/**", "package*.json", "next.config.*"];
const REQUIRED_SECRETS = ["BLOG_DOMAIN", "VM_HOST", "VM_USER", "VM_SSH_KEY"];
const CHECK_WORKFLOW_POLICY_ONLY = process.argv.includes(
  "--check-workflow-policy",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

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

async function stopProcess(child) {
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

async function waitForHttpOk(url, retries = 30, delayMs = 500) {
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

async function testWorkflowPolicy() {
  console.log("\n[1/5] workflow policy checks");
  const deployPath = path.join(ROOT, ".github", "workflows", "deploy.yml");
  const ciPath = path.join(ROOT, ".github", "workflows", "ci.yml");

  const deployYaml = await readFile(deployPath, "utf8");
  const ciYaml = await readFile(ciPath, "utf8");

  assert(deployYaml.includes("on:"), "deploy.yml must include 'on:'");
  assert(deployYaml.includes("jobs:"), "deploy.yml must include 'jobs:'");
  assert(
    /workflow_dispatch\s*:/.test(deployYaml),
    "deploy.yml must include workflow_dispatch",
  );

  const hasPushMainBranch =
    /push\s*:[\s\S]*branches\s*:[\s\S]*-+\s*main/.test(deployYaml) ||
    /push\s*:[\s\S]*branches\s*:\s*\[\s*main\s*]/.test(deployYaml);
  assert(hasPushMainBranch, "deploy.yml must include push trigger for main");

  for (const pathFilter of REQUIRED_PATH_FILTERS) {
    assert(
      deployYaml.includes(pathFilter),
      `deploy.yml missing required push path filter: ${pathFilter}`,
    );
  }

  assert(
    /for\s+name\s+in\s+BLOG_DOMAIN VM_HOST VM_USER VM_SSH_KEY/.test(deployYaml),
    "deploy.yml must fail fast when required secrets are missing",
  );

  for (const secret of REQUIRED_SECRETS) {
    assert(
      deployYaml.includes(`secrets.${secret}`),
      `deploy.yml missing required secret reference: ${secret}`,
    );
  }

  const requiredDeployFragments = [
    "npm run build",
    "tar -czf",
    "scp",
    "ssh",
    "/opt/blog-v",
    "ln -sfn",
    "systemctl restart blog",
    "/api/health",
  ];

  for (const fragment of requiredDeployFragments) {
    assert(
      deployYaml.includes(fragment),
      `deploy.yml missing required deploy fragment: ${fragment}`,
    );
  }

  const requiredPersistentDataFragments = [
    'PERSIST_ROOT="/var/lib/blog"',
    'PERSIST_DB_PATH="${PERSIST_DATA_DIR}/blog.db"',
    'sudo install -d -m 755 -o blog -g blog "${PERSIST_DATA_DIR}" "${PERSIST_UPLOADS_DIR}"',
    'sudo sqlite3 "${PREVIOUS_DB_PATH}" ".backup ${PERSIST_DB_PATH}"',
    'sudo ln -sfn "${PERSIST_DATA_DIR}" "${RELEASE_PATH}/data"',
    'sudo ln -sfn "${PERSIST_UPLOADS_DIR}" "${RELEASE_PATH}/uploads"',
  ];

  for (const fragment of requiredPersistentDataFragments) {
    assert(
      deployYaml.includes(fragment),
      `deploy.yml missing persistent data deploy fragment: ${fragment}`,
    );
  }

  assert(
    !deployYaml.includes(
      'sudo install -d -m 755 -o blog -g blog "${RELEASE_PATH}/data" "${RELEASE_PATH}/uploads"',
    ),
    "deploy.yml must not create release-local data/uploads directories",
  );

  const forbiddenInCi = [
    /workflow_dispatch\s*:/,
    /\bscp\b/,
    /\bssh\b/,
    /systemctl\s+restart\s+blog/,
    /\/api\/health/,
    /VM_HOST/,
    /VM_SSH_KEY/,
  ];

  for (const pattern of forbiddenInCi) {
    assert(
      !pattern.test(ciYaml),
      `ci.yml must remain verification-only (forbidden pattern: ${pattern})`,
    );
  }

  assert(/verify\s*:/.test(ciYaml), "ci.yml must include verify job");
  console.log("WORKFLOW POLICY PASSED");
}

async function testCleanBuildSimulation() {
  console.log("\n[2/5] clean build simulation");
  await rm(path.join(ROOT, "node_modules"), { recursive: true, force: true });
  await rm(path.join(ROOT, ".next"), { recursive: true, force: true });

  await run("npm", ["ci"], { cwd: ROOT });
  await run("npm", ["run", "build"], { cwd: ROOT });
}

async function testStandalonePackaging() {
  console.log("\n[3/5] standalone artifact packaging");
  const artifactPath = path.join(
    os.tmpdir(),
    `blog-standalone-${Date.now()}.tar.gz`,
  );

  await run(
    "tar",
    ["-czf", artifactPath, ".next/standalone/", ".next/static/", "public/"],
    { cwd: ROOT },
  );

  const stats = await stat(artifactPath);
  assert(stats.size > 0, "artifact file size must be greater than zero");

  const { stdout: listing } = await run("tar", ["-tzf", artifactPath], {
    cwd: ROOT,
  });
  assert(/(^|\/)server\.js$/m.test(listing), "artifact must include server.js");
  assert(
    listing.includes(".next/static/"),
    "artifact must include .next/static/",
  );
  assert(listing.includes("public/"), "artifact must include public/");

  return artifactPath;
}

async function testArtifactIntegrity(artifactPath) {
  console.log("\n[4/5] artifact integrity from isolated directory");
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "blog-step6-"));
  const testDbPath = path.join(tempRoot, "data", "step6.db");
  const standaloneDir = path.join(tempRoot, ".next", "standalone");
  const healthUrl = `http://127.0.0.1:${PORT}/api/health`;

  await run("tar", ["-xzf", artifactPath], { cwd: tempRoot });

  await run(
    "bash",
    [
      "-lc",
      [
        "set -euo pipefail",
        "mkdir -p .next/standalone/.next",
        "if [ -d .next/static ]; then cp -R .next/static .next/standalone/.next/static; fi",
        "if [ -d public ]; then cp -R public .next/standalone/public; fi",
      ].join(" && "),
    ],
    { cwd: tempRoot },
  );

  const child = spawn("node", ["server.js"], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(PORT),
      BLOG_API_KEY: process.env.BLOG_API_KEY ?? "step6-local-test-key",
      DATABASE_PATH: testDbPath,
      NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk.toString()));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk.toString()));

  try {
    await waitForHttpOk(healthUrl);
    const response = await fetch(healthUrl);
    assert(response.status === 200, "artifact health check must return 200");
  } finally {
    await stopProcess(child);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function testNativeBindingExists() {
  console.log("\n[5/5] better-sqlite3 native binding checks");
  console.log(`platform=${process.platform} arch=${process.arch}`);

  const bindingPath = path.join(
    ROOT,
    ".next",
    "standalone",
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node",
  );

  const bindingStats = await stat(bindingPath);
  assert(
    bindingStats.size > 0,
    "better_sqlite3.node must exist and be non-empty",
  );
}

async function main() {
  await testWorkflowPolicy();

  if (CHECK_WORKFLOW_POLICY_ONLY) {
    console.log("\nStep 6 workflow policy checks passed.");
    return;
  }

  let artifactPath = "";
  try {
    await testCleanBuildSimulation();
    artifactPath = await testStandalonePackaging();
    await testArtifactIntegrity(artifactPath);
    await testNativeBindingExists();
  } finally {
    if (artifactPath) {
      await rm(artifactPath, { force: true });
    }
  }

  console.log("\nStep 6 checks passed.");
}

main().catch((error) => {
  console.error("\nStep 6 checks failed:");
  console.error(error.message);
  process.exit(1);
});
