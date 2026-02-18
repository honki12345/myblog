import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = process.cwd();
const DATABASE_PATH =
  process.env.DATABASE_PATH || path.join(ROOT, "data", "blog.db");

const TITLE_PATTERNS = [
  "STEP5-%",
  "UI-E2E-%",
  "UI-ADMIN-%",
  "PW-SEED-%",
  "PLAYWRIGHT-%",
  "홈 테스트 글 %",
  "개별 글 테스트%",
  "태그 필터 테스트%",
  "비공개 초안 글%",
  "페이지네이션 테스트 %",
];

const SOURCE_URL_PATTERNS = [
  "https://step5.test/%",
  "https://playwright.seed/%",
];

function assertTableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function createPatternWhereClause(column, patterns) {
  return patterns.map(() => `${column} LIKE ?`).join(" OR ");
}

function cleanupAdminTables(db) {
  const adminRecoveryCodesCount = assertTableExists(db, "admin_recovery_codes")
    ? db.prepare("DELETE FROM admin_recovery_codes").run().changes
    : 0;
  const adminSessionsCount = assertTableExists(db, "admin_sessions")
    ? db.prepare("DELETE FROM admin_sessions").run().changes
    : 0;
  const adminNotesCount = assertTableExists(db, "admin_notes")
    ? db.prepare("DELETE FROM admin_notes").run().changes
    : 0;
  const adminTodosCount = assertTableExists(db, "admin_todos")
    ? db.prepare("DELETE FROM admin_todos").run().changes
    : 0;
  const adminSchedulesCount = assertTableExists(db, "admin_schedules")
    ? db.prepare("DELETE FROM admin_schedules").run().changes
    : 0;

  return {
    adminRecoveryCodesCount,
    adminSessionsCount,
    adminNotesCount,
    adminTodosCount,
    adminSchedulesCount,
  };
}

function cleanupGuestbookTables(db) {
  const guestbookSessionsCount = assertTableExists(db, "guestbook_sessions")
    ? db.prepare("DELETE FROM guestbook_sessions").run().changes
    : 0;
  const guestbookMessagesCount = assertTableExists(db, "guestbook_messages")
    ? db.prepare("DELETE FROM guestbook_messages").run().changes
    : 0;
  const guestbookThreadsCount = assertTableExists(db, "guestbook_threads")
    ? db.prepare("DELETE FROM guestbook_threads").run().changes
    : 0;

  return {
    guestbookThreadsCount,
    guestbookSessionsCount,
    guestbookMessagesCount,
  };
}

function cleanup() {
  if (!existsSync(DATABASE_PATH)) {
    console.log(`[cleanup] skip: db file not found (${DATABASE_PATH})`);
    return;
  }

  const db = new Database(DATABASE_PATH);
  db.pragma("foreign_keys = ON");

  if (!assertTableExists(db, "posts")) {
    console.log(`[cleanup] skip: posts table not found (${DATABASE_PATH})`);
    db.close();
    return;
  }

  const postColumns = db
    .prepare("PRAGMA table_info(posts)")
    .all()
    .map((row) => row.name);
  const hasSourceUrlColumn = postColumns.includes("source_url");

  const titleCondition = createPatternWhereClause("title", TITLE_PATTERNS);
  const sourceCondition = hasSourceUrlColumn
    ? createPatternWhereClause("source_url", SOURCE_URL_PATTERNS)
    : null;

  const deleteInTransaction = db.transaction(() => {
    const whereParts = [`(${titleCondition})`];
    if (sourceCondition) {
      whereParts.push(`(${sourceCondition})`);
    }

    const targets = db
      .prepare(
        `
        SELECT id
        FROM posts
        WHERE ${whereParts.join(" OR ")}
        `,
      )
      .all(...TITLE_PATTERNS, ...(sourceCondition ? SOURCE_URL_PATTERNS : []));

    const postIds = targets.map((row) => row.id);

    if (postIds.length === 0) {
      const adminCounts = cleanupAdminTables(db);
      const guestbookCounts = cleanupGuestbookTables(db);

      return {
        postCount: 0,
        sourceCount: 0,
        tagLinkCount: 0,
        orphanTagCount: 0,
        ...adminCounts,
        ...guestbookCounts,
      };
    }

    const placeholders = postIds.map(() => "?").join(",");

    let sourceChanges = 0;
    if (assertTableExists(db, "sources")) {
      if (sourceCondition) {
        sourceChanges = db
          .prepare(
            `DELETE FROM sources WHERE post_id IN (${placeholders}) OR (${createPatternWhereClause("url", SOURCE_URL_PATTERNS)})`,
          )
          .run(...postIds, ...SOURCE_URL_PATTERNS).changes;
      } else {
        sourceChanges = db
          .prepare(`DELETE FROM sources WHERE post_id IN (${placeholders})`)
          .run(...postIds).changes;
      }
    }

    const tagLinkChanges = assertTableExists(db, "post_tags")
      ? db
          .prepare(`DELETE FROM post_tags WHERE post_id IN (${placeholders})`)
          .run(...postIds).changes
      : 0;

    const postChanges = db
      .prepare(`DELETE FROM posts WHERE id IN (${placeholders})`)
      .run(...postIds).changes;

    const orphanTagChanges =
      assertTableExists(db, "tags") && assertTableExists(db, "post_tags")
        ? db
            .prepare(
              `
              DELETE FROM tags
              WHERE id NOT IN (SELECT DISTINCT tag_id FROM post_tags)
              `,
            )
            .run().changes
        : 0;

    const adminCounts = cleanupAdminTables(db);
    const guestbookCounts = cleanupGuestbookTables(db);

    return {
      postCount: postChanges,
      sourceCount: sourceChanges,
      tagLinkCount: tagLinkChanges,
      orphanTagCount: orphanTagChanges,
      ...adminCounts,
      ...guestbookCounts,
    };
  });

  try {
    const result = deleteInTransaction();
    console.log(
      `[cleanup] posts=${result.postCount}, sources=${result.sourceCount}, post_tags=${result.tagLinkCount}, orphan_tags=${result.orphanTagCount}, admin_recovery_codes=${result.adminRecoveryCodesCount}, admin_sessions=${result.adminSessionsCount}, admin_notes=${result.adminNotesCount}, admin_todos=${result.adminTodosCount}, admin_schedules=${result.adminSchedulesCount}, guestbook_threads=${result.guestbookThreadsCount}, guestbook_sessions=${result.guestbookSessionsCount}, guestbook_messages=${result.guestbookMessagesCount}`,
    );
  } finally {
    db.close();
  }
}

try {
  cleanup();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[cleanup] failed: ${message}`);
  process.exitCode = 1;
}
