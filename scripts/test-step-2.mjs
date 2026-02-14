import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

const ROOT = process.cwd();
const TEST_DB_PATH = path.join(ROOT, "data", "test-blog.db");
const TEST_DB_WAL_PATH = `${TEST_DB_PATH}-wal`;
const TEST_DB_SHM_PATH = `${TEST_DB_PATH}-shm`;
const TEST_DB_FILES = [TEST_DB_PATH, TEST_DB_WAL_PATH, TEST_DB_SHM_PATH];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function cleanupTestDb() {
  for (const filename of TEST_DB_FILES) {
    if (existsSync(filename)) {
      rmSync(filename, { force: true });
    }
  }
}

function runCommand(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status}): ${command} ${args.join(" ")}`,
    );
  }

  return result;
}

function runMigration() {
  runCommand("npm", ["run", "db:migrate"], {
    DATABASE_PATH: TEST_DB_PATH,
  });
}

function testSchemaAndObjects(db) {
  const tableRows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all();
  const tables = tableRows.map((row) => row.name);
  const requiredTables = [
    "posts",
    "tags",
    "post_tags",
    "sources",
    "schema_versions",
    "posts_fts",
  ];

  for (const table of requiredTables) {
    assert(tables.includes(table), `Missing table: ${table}`);
  }

  const columnRows = db.prepare("PRAGMA table_info(posts)").all();
  const columns = columnRows.map((row) => row.name);
  const requiredColumns = [
    "id",
    "title",
    "slug",
    "content",
    "status",
    "source_url",
    "created_at",
    "updated_at",
    "published_at",
  ];

  for (const column of requiredColumns) {
    assert(columns.includes(column), `Missing posts column: ${column}`);
  }

  const triggerRows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger'")
    .all();
  const triggers = triggerRows.map((row) => row.name);
  for (const trigger of ["posts_ai", "posts_ad", "posts_au"]) {
    assert(triggers.includes(trigger), `Missing trigger: ${trigger}`);
  }

  const indexRows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index'")
    .all();
  const indexes = indexRows.map((row) => row.name);
  for (const index of [
    "idx_posts_slug",
    "idx_posts_status",
    "idx_posts_created_at",
    "idx_posts_status_published_at",
    "idx_sources_url",
  ]) {
    assert(indexes.includes(index), `Missing index: ${index}`);
  }
}

function testPragmas(db) {
  const journalMode = String(db.pragma("journal_mode", { simple: true }))
    .trim()
    .toLowerCase();
  assert(journalMode === "wal", `Unexpected journal_mode: ${journalMode}`);

  const probeScript = [
    'import { getDb } from "./src/lib/db";',
    "const db = getDb();",
    "const snapshot = {",
    '  journal_mode: String(db.pragma("journal_mode", { simple: true })).toLowerCase(),',
    '  foreign_keys: Number(db.pragma("foreign_keys", { simple: true })),',
    '  busy_timeout: Number(db.pragma("busy_timeout", { simple: true })),',
    '  synchronous: Number(db.pragma("synchronous", { simple: true })),',
    '  cache_size: Number(db.pragma("cache_size", { simple: true })),',
    "};",
    "console.log(JSON.stringify(snapshot));",
  ].join("\n");

  const probeResult = runCommand(
    "npx",
    ["tsx", "--eval", probeScript],
    { DATABASE_PATH: TEST_DB_PATH },
  );

  const probeLines = probeResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const snapshotLine = probeLines[probeLines.length - 1];

  let snapshot;
  try {
    snapshot = JSON.parse(snapshotLine);
  } catch {
    throw new Error(`Failed to parse pragma probe output: ${snapshotLine}`);
  }

  assert(
    snapshot.journal_mode === "wal",
    `Unexpected getDb journal_mode: ${snapshot.journal_mode}`,
  );
  assert(
    snapshot.foreign_keys === 1,
    `Unexpected getDb foreign_keys: ${snapshot.foreign_keys}`,
  );
  assert(
    snapshot.busy_timeout === 5000,
    `Unexpected getDb busy_timeout: ${snapshot.busy_timeout}`,
  );
  assert(
    snapshot.synchronous === 1,
    `Unexpected getDb synchronous: ${snapshot.synchronous}`,
  );
  assert(
    snapshot.cache_size === -2000,
    `Unexpected getDb cache_size: ${snapshot.cache_size}`,
  );
}

function testCrud(db) {
  const slug = `crud-${Date.now()}`;
  const create = db
    .prepare(
      "INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)",
    )
    .run("Step 2 CRUD", slug, "CRUD content", "draft");

  const postId = Number(create.lastInsertRowid);
  assert(postId > 0, "CREATE failed");

  const read = db.prepare("SELECT title FROM posts WHERE id = ?").get(postId);
  assert(read?.title === "Step 2 CRUD", "READ failed");

  db.prepare("UPDATE posts SET status = ? WHERE id = ?").run("published", postId);
  const updated = db.prepare("SELECT status FROM posts WHERE id = ?").get(postId);
  assert(updated?.status === "published", "UPDATE failed");

  db.prepare("DELETE FROM posts WHERE id = ?").run(postId);
  const deleted = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  assert(!deleted, "DELETE failed");
}

function testFts(db) {
  const jsSlug = `js-${Date.now()}`;
  const pySlug = `py-${Date.now()}`;

  db.prepare(
    "INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)",
  ).run(
    "JavaScript async patterns",
    jsSlug,
    "Promise and async await details",
    "published",
  );
  db.prepare(
    "INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)",
  ).run("Python ML intro", pySlug, "Start machine learning with scikit", "published");

  const matches = db
    .prepare("SELECT rowid, title FROM posts_fts WHERE posts_fts MATCH ?")
    .all("JavaScript");
  assert(matches.length > 0, "FTS MATCH returned no result");
  assert(
    matches.some((row) => String(row.title).includes("JavaScript")),
    "FTS result mismatch",
  );

  db.prepare("DELETE FROM posts WHERE slug IN (?, ?)").run(jsSlug, pySlug);
}

function testForeignKeyCascade(db) {
  const postSlug = `fk-${Date.now()}`;
  const tagName = `tag-${Date.now()}`;

  const postId = Number(
    db.prepare(
      "INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)",
    ).run("FK test", postSlug, "FK content", "draft").lastInsertRowid,
  );
  const tagId = Number(
    db.prepare("INSERT INTO tags (name) VALUES (?)").run(tagName).lastInsertRowid,
  );

  db.prepare("INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)").run(
    postId,
    tagId,
  );
  db.prepare("DELETE FROM posts WHERE id = ?").run(postId);

  const orphan = db
    .prepare("SELECT post_id FROM post_tags WHERE post_id = ?")
    .get(postId);
  assert(!orphan, "CASCADE delete failed");

  db.prepare("DELETE FROM tags WHERE id = ?").run(tagId);
}

function testStatusCheckConstraint(db) {
  const slug = `invalid-${Date.now()}`;
  let didThrow = false;

  try {
    db.prepare(
      "INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)",
    ).run("Invalid status", slug, "content", "invalid_status");
  } catch {
    didThrow = true;
  }

  assert(didThrow, "CHECK constraint did not throw");
}

function testIdempotency() {
  runMigration();
  runMigration();
}

function main() {
  cleanupTestDb();
  runMigration();

  assert(existsSync(TEST_DB_PATH), `Missing DB file: ${TEST_DB_PATH}`);

  const db = new Database(TEST_DB_PATH);
  try {
    db.pragma("foreign_keys = ON");
    testSchemaAndObjects(db);
    testPragmas(db);
    testCrud(db);
    testFts(db);
    testForeignKeyCascade(db);
    testStatusCheckConstraint(db);

    const walObserved = existsSync(TEST_DB_WAL_PATH);
    console.log(`[step2] wal_file_observed_during_session=${walObserved}`);
  } finally {
    db.close();
  }

  testIdempotency();
  console.log("Step 2 checks passed.");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Step 2 checks failed: ${message}`);
  process.exitCode = 1;
} finally {
  cleanupTestDb();
}
