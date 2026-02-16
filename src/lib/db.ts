import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "blog.db");
const CURRENT_SCHEMA_VERSION = 2;

const BASE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS posts (
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

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE IF NOT EXISTS sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT NOT NULL UNIQUE,
  post_id     INTEGER REFERENCES posts(id),
  scraped_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ai_model    TEXT,
  prompt_hint TEXT
);

CREATE TABLE IF NOT EXISTS schema_versions (
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

CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_status_published_at ON posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_sources_url ON sources(url);
`;

const STEP9_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS admin_auth (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  username              TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  totp_secret_encrypted TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hash      TEXT,
  user_agent   TEXT
);

CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash  TEXT NOT NULL UNIQUE,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  is_pinned  INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_todos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'doing', 'done')),
  priority     TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
  due_at       TEXT,
  completed_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_schedules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  start_at    TEXT NOT NULL,
  end_at      TEXT NOT NULL,
  is_done     INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at
  ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_last_seen_at
  ON admin_sessions(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_recovery_codes_used_at
  ON admin_recovery_codes(used_at);
CREATE INDEX IF NOT EXISTS idx_admin_notes_pinned_updated
  ON admin_notes(is_pinned DESC, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_admin_todos_status_priority_due
  ON admin_todos(status, priority, due_at, id DESC);
CREATE INDEX IF NOT EXISTS idx_admin_schedules_start_at
  ON admin_schedules(start_at, id DESC);
`;

type DbGlobals = {
  __blogDb?: Database.Database;
  __blogDbPath?: string;
  __blogMigrationsApplied?: boolean;
};

const dbGlobals = globalThis as typeof globalThis & DbGlobals;

function ensureDatabaseDirectory(databasePath: string) {
  const directory = path.dirname(databasePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
}

function configurePragmas(database: Database.Database) {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("synchronous = NORMAL");
  database.pragma("cache_size = -2000");
}

export function getDatabasePath(): string {
  return process.env.DATABASE_PATH || DEFAULT_DB_PATH;
}

export function runMigrations(database: Database.Database): void {
  const migrate = database.transaction(() => {
    database.exec(BASE_SCHEMA_SQL);

    const row = database
      .prepare("SELECT MAX(version) AS version FROM schema_versions")
      .get() as { version: number | null } | undefined;

    let currentVersion = row?.version ?? 0;

    if (currentVersion < 1) {
      database
        .prepare(
          "INSERT INTO schema_versions (version, description) VALUES (?, ?)",
        )
        .run(1, "Initial schema for Step 2");
      currentVersion = 1;
    }

    if (currentVersion < 2) {
      database.exec(STEP9_SCHEMA_SQL);
      database
        .prepare(
          "INSERT INTO schema_versions (version, description) VALUES (?, ?)",
        )
        .run(2, "Admin workspace schema for Step 9");
    }
  });

  migrate();
}

export function getSchemaVersion(database: Database.Database): number {
  const row = database
    .prepare("SELECT MAX(version) AS version FROM schema_versions")
    .get() as { version: number | null } | undefined;
  return row?.version ?? 0;
}

export function getDb(): Database.Database {
  const databasePath = getDatabasePath();

  if (dbGlobals.__blogDb && dbGlobals.__blogDbPath !== databasePath) {
    dbGlobals.__blogDb.close();
    dbGlobals.__blogDb = undefined;
    dbGlobals.__blogDbPath = undefined;
    dbGlobals.__blogMigrationsApplied = false;
  }

  if (!dbGlobals.__blogDb) {
    ensureDatabaseDirectory(databasePath);
    dbGlobals.__blogDb = new Database(databasePath);
    dbGlobals.__blogDbPath = databasePath;
    dbGlobals.__blogMigrationsApplied = false;
    configurePragmas(dbGlobals.__blogDb);
  }

  if (!dbGlobals.__blogMigrationsApplied) {
    runMigrations(dbGlobals.__blogDb);
    dbGlobals.__blogMigrationsApplied = true;
  }

  return dbGlobals.__blogDb;
}
