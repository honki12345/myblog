import { getDb } from "@/lib/db";
import { createExcerpt } from "@/lib/excerpt";
import { extractThumbnailUrlFromMarkdownCached } from "@/lib/post-thumbnail";

export type PostStatus = "draft" | "published";
export type PostOrigin = "original" | "ai";
export type PostTypeFilter = "all" | PostOrigin;
export type PostReadFilter = "all" | "unread";

export type PostListItem = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  tags: string[];
  publishedAt: string | null;
  status: PostStatus;
  isRead: boolean;
  thumbnailUrl: string | null;
  origin: PostOrigin;
  sourceUrl: string | null;
  sourceDomain: string | null;
};

export type TagCountItem = {
  name: string;
  count: number;
};

export type ActiveTagItem = {
  name: string;
  count: number;
  lastPostAt: string | null;
};

export function buildStatusFilter(
  statuses: readonly PostStatus[],
  alias?: string,
): {
  clause: string;
  params: PostStatus[];
} {
  const column = alias ? `${alias}.status` : "status";
  const placeholders = statuses.map(() => "?").join(", ");
  return {
    clause: `${column} IN (${placeholders})`,
    params: [...statuses],
  };
}

function escapeLikePattern(pattern: string): string {
  // Escape LIKE wildcard characters so user input behaves predictably.
  return pattern.replace(/[%_\\]/g, "\\$&");
}

function parseTagsCsv(tagsCsv: string): string[] {
  return tagsCsv.length > 0
    ? tagsCsv.split("\u001f").filter((tag) => tag.length > 0)
    : [];
}

function parseSourceDomain(sourceUrl: string | null): string | null {
  if (!sourceUrl) {
    return null;
  }

  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return null;
  }
}

type ListPostsRow = {
  id: number;
  slug: string;
  title: string;
  content: string;
  status: PostStatus;
  origin: PostOrigin;
  is_read: 0 | 1;
  published_at: string | null;
  updated_at: string;
  tags_csv: string;
  source_url: string | null;
};

function buildListQueryParts(options: {
  statuses: readonly PostStatus[];
  type: PostTypeFilter;
  read: PostReadFilter;
  tag: string | null;
  ftsQuery: string | null;
}): {
  whereClause: string;
  params: unknown[];
  ftsJoinSql: string;
  orderBySql: string;
  rankSelectSql: string;
} {
  const statusFilter = buildStatusFilter(options.statuses, "p");
  const whereClauses = [statusFilter.clause];
  const params: unknown[] = [...statusFilter.params];

  if (options.type !== "all") {
    whereClauses.push("p.origin = ?");
    params.push(options.type);
  }

  if (options.read === "unread") {
    whereClauses.push("p.is_read = 0");
  }

  if (options.tag) {
    whereClauses.push(
      `
      EXISTS (
        SELECT 1
        FROM post_tags ptf
        INNER JOIN tags tf ON tf.id = ptf.tag_id
        WHERE ptf.post_id = p.id AND tf.name = ?
      )
      `.trim(),
    );
    params.push(options.tag);
  }

  const sortDateSql = "datetime(COALESCE(p.published_at, p.created_at))";

  if (options.ftsQuery) {
    whereClauses.push("posts_fts MATCH ?");
    params.push(options.ftsQuery);
    return {
      whereClause: whereClauses.join(" AND "),
      params,
      ftsJoinSql: "INNER JOIN posts_fts ON posts_fts.rowid = p.id",
      rankSelectSql: ", bm25(posts_fts) AS rank",
      orderBySql: `rank ASC, p.is_read ASC, ${sortDateSql} DESC, p.id DESC`,
    };
  }

  return {
    whereClause: whereClauses.join(" AND "),
    params,
    ftsJoinSql: "",
    rankSelectSql: "",
    orderBySql: `p.is_read ASC, ${sortDateSql} DESC, p.id DESC`,
  };
}

export function listPostsWithTotalCount(options: {
  statuses: readonly PostStatus[];
  type?: PostTypeFilter;
  read?: PostReadFilter;
  tag?: string | null;
  ftsQuery?: string | null;
  limit: number;
  offset: number;
}): { items: PostListItem[]; totalCount: number } {
  const db = getDb();
  const type = options.type ?? "all";
  const read = options.read ?? "all";
  const tag = options.tag ?? null;
  const ftsQuery = options.ftsQuery ?? null;

  const queryParts = buildListQueryParts({
    statuses: options.statuses,
    type,
    read,
    tag,
    ftsQuery,
  });

  const countRow = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM posts p
      ${queryParts.ftsJoinSql}
      WHERE ${queryParts.whereClause}
      `,
    )
    .get(...queryParts.params) as { count: number } | undefined;

  const totalCount = countRow?.count ?? 0;

  const rows = db
    .prepare(
      `
      SELECT
        p.id,
        p.slug,
        p.title,
        p.content,
        p.status,
        p.origin,
        p.is_read,
        p.published_at,
        p.updated_at,
        COALESCE(all_tags.tags_csv, '') AS tags_csv,
        COALESCE(p.source_url, s.url) AS source_url
        ${queryParts.rankSelectSql}
      FROM posts p
      ${queryParts.ftsJoinSql}
      LEFT JOIN (
        SELECT
          pt2.post_id AS post_id,
          GROUP_CONCAT(t2.name, char(31)) AS tags_csv
        FROM post_tags pt2
        INNER JOIN tags t2 ON t2.id = pt2.tag_id
        GROUP BY pt2.post_id
      ) AS all_tags ON all_tags.post_id = p.id
      LEFT JOIN (
        SELECT
          post_id,
          MIN(url) AS url
        FROM sources
        WHERE post_id IS NOT NULL
        GROUP BY post_id
      ) s ON s.post_id = p.id
      WHERE ${queryParts.whereClause}
      ORDER BY ${queryParts.orderBySql}
      LIMIT ? OFFSET ?
      `,
    )
    .all(...queryParts.params, options.limit, options.offset) as ListPostsRow[];

  const items = rows.map((row) => {
    const sourceUrl = row.source_url;
    const sourceDomain = parseSourceDomain(sourceUrl);
    const thumbnailKey = `post:${row.id}:${row.updated_at}`;

    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: createExcerpt(row.content),
      tags: parseTagsCsv(row.tags_csv),
      publishedAt: row.published_at,
      status: row.status,
      isRead: row.is_read === 1,
      thumbnailUrl: extractThumbnailUrlFromMarkdownCached(
        thumbnailKey,
        row.content,
      ),
      origin: row.origin,
      sourceUrl,
      sourceDomain,
    };
  });

  return { items, totalCount };
}

export function listTagCounts(
  statuses: readonly PostStatus[],
  query?: string | null,
): Array<{ name: string; count: number }> {
  const db = getDb();
  const statusFilter = buildStatusFilter(statuses, "p");
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  const whereClauses = [statusFilter.clause];
  const params: unknown[] = [...statusFilter.params];

  if (normalizedQuery.length > 0) {
    const escapedQuery = escapeLikePattern(normalizedQuery);
    whereClauses.push("t.name LIKE ? ESCAPE '\\'");
    params.push(`%${escapedQuery}%`);
  }

  const rows = db
    .prepare(
      `
      SELECT
        t.name AS name,
        COUNT(DISTINCT p.id) AS count
      FROM tags t
      INNER JOIN post_tags pt ON pt.tag_id = t.id
      INNER JOIN posts p ON p.id = pt.post_id
      WHERE ${whereClauses.join(" AND ")}
      GROUP BY t.id
      ORDER BY count DESC, name ASC
      `,
    )
    .all(...params) as TagCountItem[];

  return rows.map((row) => ({ name: row.name, count: row.count }));
}

export function listActiveTags(
  statuses: readonly PostStatus[],
  limit = 10,
): ActiveTagItem[] {
  const db = getDb();
  const statusFilter = buildStatusFilter(statuses, "p");
  const rows = db
    .prepare(
      `
      SELECT
        t.name AS name,
        COUNT(DISTINCT p.id) AS count,
        MAX(datetime(COALESCE(p.published_at, p.created_at))) AS last_post_at
      FROM tags t
      INNER JOIN post_tags pt ON pt.tag_id = t.id
      INNER JOIN posts p ON p.id = pt.post_id
      WHERE ${statusFilter.clause}
      GROUP BY t.id
      ORDER BY datetime(last_post_at) DESC, count DESC, name ASC
      LIMIT ?
      `,
    )
    .all(...statusFilter.params, limit) as Array<{
    name: string;
    count: number;
    last_post_at: string | null;
  }>;

  return rows.map((row) => ({
    name: row.name,
    count: row.count,
    lastPostAt: row.last_post_at,
  }));
}
