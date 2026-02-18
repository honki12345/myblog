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
    "origin",
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
  for (const trigger of [
    "posts_ai",
    "posts_ad",
    "posts_au",
    "posts_origin_immutable",
  ]) {
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
    "idx_posts_origin",
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

  const probeResult = runCommand("npx", ["tsx", "--eval", probeScript], {
    DATABASE_PATH: TEST_DB_PATH,
  });

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

  db.prepare("UPDATE posts SET status = ? WHERE id = ?").run(
    "published",
    postId,
  );
  const updated = db
    .prepare("SELECT status FROM posts WHERE id = ?")
    .get(postId);
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
  ).run(
    "Python ML intro",
    pySlug,
    "Start machine learning with scikit",
    "published",
  );

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
    db
      .prepare(
        "INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)",
      )
      .run("FK test", postSlug, "FK content", "draft").lastInsertRowid,
  );
  const tagId = Number(
    db.prepare("INSERT INTO tags (name) VALUES (?)").run(tagName)
      .lastInsertRowid,
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

function testOriginConstraints(db) {
  const slug = `origin-${Date.now()}`;

  const created = db
    .prepare(
      "INSERT INTO posts (title, slug, content, status) VALUES (?, ?, ?, ?)",
    )
    .run("Origin test", slug, "Origin content", "draft");
  const postId = Number(created.lastInsertRowid);
  assert(postId > 0, "Origin CREATE failed");

  const row = db.prepare("SELECT origin FROM posts WHERE id = ?").get(postId);
  assert(
    row?.origin === "original",
    `Unexpected default origin: ${row?.origin}`,
  );

  let invalidOriginThrow = false;
  try {
    db.prepare(
      "INSERT INTO posts (title, slug, content, status, origin) VALUES (?, ?, ?, ?, ?)",
    ).run("Invalid origin", `${slug}-invalid`, "content", "draft", "bad");
  } catch {
    invalidOriginThrow = true;
  }
  assert(invalidOriginThrow, "origin CHECK constraint did not throw");

  let immutableThrow = false;
  try {
    db.prepare("UPDATE posts SET origin = 'ai' WHERE id = ?").run(postId);
  } catch {
    immutableThrow = true;
  }
  assert(immutableThrow, "origin immutability trigger did not throw");

  db.prepare("DELETE FROM posts WHERE id = ?").run(postId);
}

function testOriginMigrationBackfill() {
  cleanupTestDb();

  const seedSlugA = `backfill-a-${Date.now()}`;
  const seedSlugB = `backfill-b-${Date.now()}`;
  const seedSlugC = `backfill-c-${Date.now()}`;

  const db = new Database(TEST_DB_PATH);
  try {
    db.pragma("foreign_keys = ON");

    // Simulate a version-3 database where posts.origin does not exist yet.
    db.exec(`
      CREATE TABLE posts (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT NOT NULL,
        slug         TEXT NOT NULL UNIQUE,
        content      TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'draft'
          CHECK(status IN ('draft', 'published')),
        source_url   TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        published_at TEXT
      );

      CREATE TABLE sources (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        url         TEXT NOT NULL UNIQUE,
        post_id     INTEGER REFERENCES posts(id),
        scraped_at  TEXT NOT NULL DEFAULT (datetime('now')),
        ai_model    TEXT,
        prompt_hint TEXT
      );

      CREATE TABLE admin_auth (
        id                    INTEGER PRIMARY KEY CHECK (id = 1),
        username              TEXT NOT NULL UNIQUE,
        password_hash         TEXT NOT NULL,
        totp_secret_encrypted TEXT NOT NULL,
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE schema_versions (
        version     INTEGER PRIMARY KEY,
        applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
        description TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
        title,
        content,
        content='posts',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
        INSERT INTO posts_fts(rowid, title, content)
        VALUES (new.id, new.title, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
        INSERT INTO posts_fts(posts_fts, rowid, title, content)
        VALUES ('delete', old.id, old.title, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE ON posts BEGIN
        INSERT INTO posts_fts(posts_fts, rowid, title, content)
        VALUES ('delete', old.id, old.title, old.content);
        INSERT INTO posts_fts(rowid, title, content)
        VALUES (new.id, new.title, new.content);
      END;
    `);

    db.prepare(
      "INSERT INTO schema_versions (version, description) VALUES (?, ?)",
    ).run(3, "Seeded schema version for backfill test");

    const now = "2026-01-01 00:00:00";

    const postAId = Number(
      db
        .prepare(
          `
          INSERT INTO posts (title, slug, content, status, source_url, created_at, updated_at, published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          "Backfill A",
          seedSlugA,
          "backfill content a",
          "draft",
          "https://example.test/a",
          now,
          now,
          null,
        ).lastInsertRowid,
    );
    assert(postAId > 0, "failed to seed backfill post A");

    const postBId = Number(
      db
        .prepare(
          `
          INSERT INTO posts (title, slug, content, status, source_url, created_at, updated_at, published_at)
          VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
          `,
        )
        .run(
          "Backfill B",
          seedSlugB,
          "backfill content b",
          "draft",
          now,
          now,
          null,
        ).lastInsertRowid,
    );
    assert(postBId > 0, "failed to seed backfill post B");

    db.prepare("INSERT INTO sources (url, post_id) VALUES (?, ?)").run(
      "https://example.test/b",
      postBId,
    );

    const postCId = Number(
      db
        .prepare(
          `
          INSERT INTO posts (title, slug, content, status, source_url, created_at, updated_at, published_at)
          VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
          `,
        )
        .run(
          "Backfill C",
          seedSlugC,
          "backfill content c",
          "draft",
          now,
          now,
          null,
        ).lastInsertRowid,
    );
    assert(postCId > 0, "failed to seed backfill post C");
  } finally {
    db.close();
  }

  runMigration();

  const migrated = new Database(TEST_DB_PATH);
  try {
    const originColumnRows = migrated.prepare("PRAGMA table_info(posts)").all();
    assert(
      originColumnRows.some((row) => row.name === "origin"),
      "origin column missing after migration",
    );

    const rowA = migrated
      .prepare("SELECT origin FROM posts WHERE slug = ?")
      .get(seedSlugA);
    const rowB = migrated
      .prepare("SELECT origin FROM posts WHERE slug = ?")
      .get(seedSlugB);
    const rowC = migrated
      .prepare("SELECT origin FROM posts WHERE slug = ?")
      .get(seedSlugC);

    assert(rowA?.origin === "ai", `unexpected origin for A: ${rowA?.origin}`);
    assert(rowB?.origin === "ai", `unexpected origin for B: ${rowB?.origin}`);
    assert(
      rowC?.origin === "original",
      `unexpected origin for C: ${rowC?.origin}`,
    );

    const schemaVersionRow = migrated
      .prepare("SELECT MAX(version) AS version FROM schema_versions")
      .get();
    assert(
      schemaVersionRow?.version === 6,
      `unexpected schema version: ${schemaVersionRow?.version}`,
    );
  } finally {
    migrated.close();
  }
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
    testOriginConstraints(db);

    const walObserved = existsSync(TEST_DB_WAL_PATH);
    console.log(`[step2] wal_file_observed_during_session=${walObserved}`);
  } finally {
    db.close();
  }

  testIdempotency();
  testOriginMigrationBackfill();
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
