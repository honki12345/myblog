import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "blog.db");

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

const ISSUE45_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inbox_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT NOT NULL UNIQUE,
  source     TEXT NOT NULL,
  client     TEXT NOT NULL,
  note       TEXT,
  status     TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processed', 'failed')),
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inbox_items_status_id
  ON inbox_items(status, id);
`;

const ISSUE75_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS guestbook_threads (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_username      TEXT NOT NULL UNIQUE,
  guest_password_hash TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guestbook_sessions (
  id           TEXT PRIMARY KEY,
  thread_id    INTEGER NOT NULL REFERENCES guestbook_threads(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hash      TEXT,
  user_agent   TEXT
);

CREATE TABLE IF NOT EXISTS guestbook_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  INTEGER NOT NULL REFERENCES guestbook_threads(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK(role IN ('guest', 'admin')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_guestbook_sessions_thread_id
  ON guestbook_sessions(thread_id);
CREATE INDEX IF NOT EXISTS idx_guestbook_sessions_expires_at
  ON guestbook_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_guestbook_sessions_last_seen_at
  ON guestbook_sessions(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_guestbook_threads_updated_at
  ON guestbook_threads(updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_guestbook_messages_thread_id_id
  ON guestbook_messages(thread_id, id);

CREATE TRIGGER IF NOT EXISTS guestbook_messages_ai
AFTER INSERT ON guestbook_messages
BEGIN
  UPDATE guestbook_threads
  SET updated_at = datetime('now')
  WHERE id = new.thread_id;
END;
`;

const ISSUE102_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS post_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  is_hidden  INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comment_tags (
  comment_id INTEGER PRIMARY KEY
    REFERENCES post_comments(id) ON DELETE CASCADE,
  tag_path   TEXT NOT NULL
    CHECK (
      length(tag_path) BETWEEN 1 AND 120
      AND tag_path = lower(tag_path)
      AND tag_path NOT LIKE '/%'
      AND tag_path NOT LIKE '%/'
      AND tag_path NOT LIKE '%//%'
    )
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post_id_id
  ON post_comments(post_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_post_comments_visible_by_post
  ON post_comments(post_id, id DESC)
  WHERE is_hidden = 0 AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_post_comments_visibility
  ON post_comments(is_hidden, deleted_at, id DESC);
CREATE INDEX IF NOT EXISTS idx_comment_tags_tag_path
  ON comment_tags(tag_path);
CREATE INDEX IF NOT EXISTS idx_comment_tags_tag_path_comment_id
  ON comment_tags(tag_path, comment_id);
`;

function hasTableColumn(
  database: Database.Database,
  tableName: string,
  columnName: string,
): boolean {
  const rows = database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name?: unknown }>;
  return rows.some((row) => row.name === columnName);
}

const ISSUE59_ADD_COLUMN_SQL = `
ALTER TABLE admin_auth
  ADD COLUMN totp_enabled_at TEXT;
`;

const ISSUE59_BACKFILL_SQL = `
-- Existing production DBs already have 2FA configured, so lock down TOTP setup
-- immediately after deploying this migration.
UPDATE admin_auth
SET totp_enabled_at = datetime('now')
WHERE id = 1 AND totp_enabled_at IS NULL;
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
      currentVersion = 2;
    }

    if (currentVersion < 3) {
      database.exec(ISSUE45_SCHEMA_SQL);
      database
        .prepare(
          "INSERT INTO schema_versions (version, description) VALUES (?, ?)",
        )
        .run(3, "Inbox ingestion queue schema for Issue #45");
      currentVersion = 3;
    }

    const hasTotpEnabledAtColumn = hasTableColumn(
      database,
      "admin_auth",
      "totp_enabled_at",
    );

    if (currentVersion < 4) {
      if (!hasTotpEnabledAtColumn) {
        database.exec(ISSUE59_ADD_COLUMN_SQL);
      }
      database.exec(ISSUE59_BACKFILL_SQL);
      database
        .prepare(
          "INSERT INTO schema_versions (version, description) VALUES (?, ?)",
        )
        .run(4, "Admin 2FA enabled state for Issue #59");
      currentVersion = 4;
    } else if (!hasTotpEnabledAtColumn) {
      // Legacy compatibility: some dev/test DBs may have used schema version 4 for
      // Issue #54. If the column is missing, apply the migration without bumping
      // schema_versions again (version 4 already exists).
      database.exec(ISSUE59_ADD_COLUMN_SQL);
      database.exec(ISSUE59_BACKFILL_SQL);
    }

    if (currentVersion < 5) {
      if (!hasTableColumn(database, "posts", "origin")) {
        database.exec(
          "ALTER TABLE posts ADD COLUMN origin TEXT NOT NULL DEFAULT 'original' CHECK (origin IN ('original','ai'))",
        );
      }

      // Allow re-running the backfill even if a legacy DB already has the
      // immutability trigger installed (e.g. Issue #54 previously used v4).
      database.exec("DROP TRIGGER IF EXISTS posts_origin_immutable");

      database.exec(
        `
        UPDATE posts
        SET origin = 'ai'
        WHERE origin <> 'ai'
          AND (
            source_url IS NOT NULL
            OR EXISTS (SELECT 1 FROM sources s WHERE s.post_id = posts.id)
          )
        `,
      );

      database.exec(
        "CREATE INDEX IF NOT EXISTS idx_posts_origin ON posts(origin)",
      );

      database.exec(`
        CREATE TRIGGER IF NOT EXISTS posts_origin_immutable
        BEFORE UPDATE OF origin ON posts
        BEGIN
          SELECT RAISE(ABORT, 'origin is immutable');
        END;
      `);

      database
        .prepare(
          "INSERT INTO schema_versions (version, description) VALUES (?, ?)",
        )
        .run(5, "posts.origin schema for Issue #54 (home/posts role split)");
      currentVersion = 5;
    }

    if (currentVersion < 6) {
      database.exec(ISSUE75_SCHEMA_SQL);
      database
        .prepare(
          "INSERT INTO schema_versions (version, description) VALUES (?, ?)",
        )
        .run(6, "Private guestbook thread schema for Issue #75");
      currentVersion = 6;
    }

    if (currentVersion < 7) {
      database.exec(ISSUE102_SCHEMA_SQL);
      database
        .prepare(
          "INSERT INTO schema_versions (version, description) VALUES (?, ?)",
        )
        .run(7, "Comments tag wiki schema for Issue #102");
      currentVersion = 7;
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
