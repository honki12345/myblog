import { buildWikiPathHref } from "@/lib/comment-tags";
import { getDb } from "@/lib/db";

type PostOrigin = "original" | "ai";

type PathCountRow = {
  tag_path: string;
  count: number;
};

type WikiCommentRow = {
  comment_id: number;
  post_id: number;
  content: string;
  tag_path: string;
  created_at: string;
  updated_at: string;
  post_slug: string;
  post_title: string;
  post_origin: PostOrigin;
  post_published_at: string | null;
  source_url: string | null;
};

type PostCommentRow = {
  id: number;
  post_id: number;
  content: string;
  is_hidden: number;
  tag_path: string;
  created_at: string;
  updated_at: string;
};

export type WikiCategory = {
  path: string;
  segment: string;
  count: number;
  hasChildren: boolean;
};

export type WikiRootOverview = {
  totalComments: number;
  totalPaths: number;
  categories: WikiCategory[];
};

export type WikiCommentItem = {
  commentId: number;
  postId: number;
  content: string;
  tagPath: string;
  createdAt: string;
  updatedAt: string;
  postSlug: string;
  postTitle: string;
  postOrigin: PostOrigin;
  postPublishedAt: string | null;
  sourceUrl: string | null;
};

export type WikiPathOverview = {
  path: string;
  exactCount: number;
  totalCount: number;
  categories: WikiCategory[];
  comments: WikiCommentItem[];
  truncated: boolean;
};

export type AdminPostComment = {
  id: number;
  postId: number;
  content: string;
  tagPath: string;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PublicPostComment = {
  id: number;
  postId: number;
  content: string;
  tagPath: string;
  createdAt: string;
  updatedAt: string;
};

const SOURCE_URL_JOIN_SQL = `
LEFT JOIN (
  SELECT
    post_id,
    MIN(url) AS url
  FROM sources
  WHERE post_id IS NOT NULL
  GROUP BY post_id
) AS source_url_fallback ON source_url_fallback.post_id = p.id
`;

function mapWikiCommentRow(row: WikiCommentRow): WikiCommentItem {
  return {
    commentId: row.comment_id,
    postId: row.post_id,
    content: row.content,
    tagPath: row.tag_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    postSlug: row.post_slug,
    postTitle: row.post_title,
    postOrigin: row.post_origin,
    postPublishedAt: row.post_published_at,
    sourceUrl: row.source_url,
  };
}

function mapAdminCommentRow(row: PostCommentRow): AdminPostComment {
  return {
    id: row.id,
    postId: row.post_id,
    content: row.content,
    tagPath: row.tag_path,
    isHidden: row.is_hidden === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPublicCommentRow(row: PostCommentRow): PublicPostComment {
  return {
    id: row.id,
    postId: row.post_id,
    content: row.content,
    tagPath: row.tag_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sortWikiCategories(categories: WikiCategory[]): WikiCategory[] {
  return categories.sort((a, b) => {
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    return a.path.localeCompare(b.path);
  });
}

function sumPathCounts(rows: PathCountRow[]): number {
  return rows.reduce((sum, row) => sum + row.count, 0);
}

function buildImmediateCategories(
  rows: PathCountRow[],
  currentPath: string | null,
): WikiCategory[] {
  const map = new Map<string, WikiCategory>();

  for (const row of rows) {
    const fullPath = row.tag_path;

    if (currentPath) {
      if (!fullPath.startsWith(`${currentPath}/`)) {
        continue;
      }

      const remainder = fullPath.slice(currentPath.length + 1);
      if (remainder.length === 0) {
        continue;
      }

      const segments = remainder.split("/");
      const segment = segments[0];
      const categoryPath = `${currentPath}/${segment}`;
      const existing = map.get(categoryPath);

      if (existing) {
        existing.count += row.count;
        existing.hasChildren = existing.hasChildren || segments.length > 1;
      } else {
        map.set(categoryPath, {
          path: categoryPath,
          segment,
          count: row.count,
          hasChildren: segments.length > 1,
        });
      }
      continue;
    }

    const segments = fullPath.split("/");
    const segment = segments[0];
    const categoryPath = segment;
    const existing = map.get(categoryPath);

    if (existing) {
      existing.count += row.count;
      existing.hasChildren = existing.hasChildren || segments.length > 1;
    } else {
      map.set(categoryPath, {
        path: categoryPath,
        segment,
        count: row.count,
        hasChildren: segments.length > 1,
      });
    }
  }

  return sortWikiCategories(Array.from(map.values()));
}

function loadVisiblePathCounts(path: string | null): PathCountRow[] {
  const db = getDb();

  if (!path) {
    return db
      .prepare(
        `
        SELECT
          ct.tag_path,
          COUNT(*) AS count
        FROM comment_tags ct
        INNER JOIN post_comments pc ON pc.id = ct.comment_id
        WHERE pc.is_hidden = 0 AND pc.deleted_at IS NULL
        GROUP BY ct.tag_path
        ORDER BY ct.tag_path ASC
        `,
      )
      .all() as PathCountRow[];
  }

  return db
    .prepare(
      `
      SELECT
        ct.tag_path,
        COUNT(*) AS count
      FROM comment_tags ct
      INNER JOIN post_comments pc ON pc.id = ct.comment_id
      WHERE pc.is_hidden = 0
        AND pc.deleted_at IS NULL
        AND (ct.tag_path = ? OR ct.tag_path LIKE ?)
      GROUP BY ct.tag_path
      ORDER BY ct.tag_path ASC
      `,
    )
    .all(path, `${path}/%`) as PathCountRow[];
}

export function getWikiRootOverview(): WikiRootOverview {
  const rows = loadVisiblePathCounts(null);
  return {
    totalComments: sumPathCounts(rows),
    totalPaths: rows.length,
    categories: buildImmediateCategories(rows, null),
  };
}

export function getWikiPathOverview(
  path: string,
  limit = 100,
): WikiPathOverview | null {
  const rows = loadVisiblePathCounts(path);
  if (rows.length === 0) {
    return null;
  }

  const exactCount = rows.find((row) => row.tag_path === path)?.count ?? 0;
  const totalCount = sumPathCounts(rows);
  const categories = buildImmediateCategories(rows, path);
  const db = getDb();
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const commentRows = db
    .prepare(
      `
      SELECT
        pc.id AS comment_id,
        pc.post_id,
        pc.content,
        ct.tag_path,
        pc.created_at,
        pc.updated_at,
        p.slug AS post_slug,
        p.title AS post_title,
        p.origin AS post_origin,
        p.published_at AS post_published_at,
        COALESCE(p.source_url, source_url_fallback.url) AS source_url
      FROM comment_tags ct
      INNER JOIN post_comments pc ON pc.id = ct.comment_id
      INNER JOIN posts p ON p.id = pc.post_id
      ${SOURCE_URL_JOIN_SQL}
      WHERE pc.is_hidden = 0
        AND pc.deleted_at IS NULL
        AND (ct.tag_path = ? OR ct.tag_path LIKE ?)
      ORDER BY datetime(pc.updated_at) DESC, pc.id DESC
      LIMIT ?
      `,
    )
    .all(path, `${path}/%`, boundedLimit + 1) as WikiCommentRow[];

  const truncated = commentRows.length > boundedLimit;
  const comments = commentRows.slice(0, boundedLimit).map(mapWikiCommentRow);

  return {
    path,
    exactCount,
    totalCount,
    categories,
    comments,
    truncated,
  };
}

export function listAdminCommentsForPost(postId: number): AdminPostComment[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT
        pc.id,
        pc.post_id,
        pc.content,
        pc.is_hidden,
        pc.created_at,
        pc.updated_at,
        ct.tag_path
      FROM post_comments pc
      INNER JOIN comment_tags ct ON ct.comment_id = pc.id
      WHERE pc.post_id = ? AND pc.deleted_at IS NULL
      ORDER BY pc.id DESC
      `,
    )
    .all(postId) as PostCommentRow[];

  return rows.map(mapAdminCommentRow);
}

export function getAdminCommentById(
  postId: number,
  commentId: number,
): AdminPostComment | null {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT
        pc.id,
        pc.post_id,
        pc.content,
        pc.is_hidden,
        pc.created_at,
        pc.updated_at,
        ct.tag_path
      FROM post_comments pc
      INNER JOIN comment_tags ct ON ct.comment_id = pc.id
      WHERE pc.id = ? AND pc.post_id = ? AND pc.deleted_at IS NULL
      LIMIT 1
      `,
    )
    .get(commentId, postId) as PostCommentRow | undefined;

  return row ? mapAdminCommentRow(row) : null;
}

export function listVisibleCommentsForPost(postId: number): PublicPostComment[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT
        pc.id,
        pc.post_id,
        pc.content,
        pc.is_hidden,
        pc.created_at,
        pc.updated_at,
        ct.tag_path
      FROM post_comments pc
      INNER JOIN comment_tags ct ON ct.comment_id = pc.id
      WHERE pc.post_id = ?
        AND pc.is_hidden = 0
        AND pc.deleted_at IS NULL
      ORDER BY datetime(pc.updated_at) DESC, pc.id DESC
      `,
    )
    .all(postId) as PostCommentRow[];

  return rows.map(mapPublicCommentRow);
}

export function collectWikiPathsForRevalidate(tagPaths: readonly string[]): string[] {
  const paths = new Set<string>(["/wiki"]);

  for (const tagPath of tagPaths) {
    const segments = tagPath
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      paths.add(buildWikiPathHref(currentPath));
    }
  }

  return Array.from(paths);
}
