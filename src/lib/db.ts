import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "blog.db");
const CURRENT_SCHEMA_VERSION = 1;

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

    const currentVersion = row?.version ?? 0;
    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      database
        .prepare(
          "INSERT INTO schema_versions (version, description) VALUES (?, ?)",
        )
        .run(CURRENT_SCHEMA_VERSION, "Initial schema for Step 2");
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
