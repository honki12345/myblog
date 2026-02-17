import PostCard from "@/components/PostCard";
import SearchBar from "@/components/SearchBar";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { extractThumbnailUrlFromMarkdownCached } from "@/lib/post-thumbnail";

type PostStatus = "draft" | "published";

const MAX_SEARCH_QUERY_LENGTH = 100;

type PageProps = {
  searchParams: Promise<{
    page?: string;
    per_page?: string;
    q?: string;
  }>;
};

type PostListRow = {
  id: number;
  slug: string;
  title: string;
  content: string;
  status: PostStatus;
  published_at: string | null;
  updated_at: string;
  tags_csv: string;
};

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[-*+]\s+/gm, " ")
    .replace(/^#{1,6}\s+/gm, " ")
    .replace(/[*_~>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createExcerpt(content: string, maxLength = 200): string {
  const plain = stripMarkdown(content);
  if (plain.length <= maxLength) {
    return plain;
  }

  return `${plain.slice(0, maxLength).trimEnd()}...`;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeSearchQuery(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.length > MAX_SEARCH_QUERY_LENGTH
    ? normalized.slice(0, MAX_SEARCH_QUERY_LENGTH)
    : normalized;
}

function isFtsQuerySyntaxError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  if (message.includes("fts5:")) {
    return true;
  }

  // Fallback heuristics: we only want to suppress user-facing MATCH parsing errors.
  return (
    message.includes("unterminated") ||
    message.includes("malformed match") ||
    (message.includes("match") && message.includes("syntax"))
  );
}

function buildPageHref(
  page: number,
  perPage: number,
  q: string | null,
): string {
  const search = new URLSearchParams();
  search.set("page", String(page));
  if (perPage !== 10) {
    search.set("per_page", String(perPage));
  }
  if (q) {
    search.set("q", q);
  }
  return `/posts?${search.toString()}`;
}

function buildStatusFilter(
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

function loadTotalPosts(
  statuses: readonly PostStatus[],
  q: string | null,
): number {
  const db = getDb();
  const statusFilter = buildStatusFilter(statuses, "p");

  const row = q
    ? (db
        .prepare(
          `
          SELECT COUNT(*) AS count
          FROM posts p
          JOIN posts_fts ON posts_fts.rowid = p.id
          WHERE ${statusFilter.clause}
            AND posts_fts MATCH ?
          `,
        )
        .get(...statusFilter.params, q) as { count: number } | undefined)
    : (db
        .prepare(
          `SELECT COUNT(*) AS count FROM posts p WHERE ${statusFilter.clause}`,
        )
        .get(...statusFilter.params) as { count: number } | undefined);
  return row?.count ?? 0;
}

function loadPosts(
  statuses: readonly PostStatus[],
  page: number,
  perPage: number,
  q: string | null,
) {
  const db = getDb();
  const statusFilter = buildStatusFilter(statuses, "p");
  const offset = (page - 1) * perPage;
  const rows = q
    ? (db
        .prepare(
          `
          SELECT
            p.id,
            p.slug,
            p.title,
            p.content,
            p.status,
            p.published_at,
            p.updated_at,
            COALESCE(GROUP_CONCAT(t.name, char(31)), '') AS tags_csv
          FROM posts p
          JOIN posts_fts ON posts_fts.rowid = p.id
          LEFT JOIN post_tags pt ON pt.post_id = p.id
          LEFT JOIN tags t ON t.id = pt.tag_id
          WHERE ${statusFilter.clause}
            AND posts_fts MATCH ?
          GROUP BY p.id
          ORDER BY COALESCE(p.published_at, p.created_at) DESC,
                   p.id DESC
          LIMIT ? OFFSET ?
          `,
        )
        .all(...statusFilter.params, q, perPage, offset) as PostListRow[])
    : (db
        .prepare(
          `
          SELECT
            p.id,
            p.slug,
            p.title,
            p.content,
            p.status,
            p.published_at,
            p.updated_at,
            COALESCE(GROUP_CONCAT(t.name, char(31)), '') AS tags_csv
          FROM posts p
          LEFT JOIN post_tags pt ON pt.post_id = p.id
          LEFT JOIN tags t ON t.id = pt.tag_id
          WHERE ${statusFilter.clause}
          GROUP BY p.id
          ORDER BY COALESCE(p.published_at, p.created_at) DESC,
                   p.id DESC
          LIMIT ? OFFSET ?
          `,
        )
        .all(...statusFilter.params, perPage, offset) as PostListRow[]);

  return rows.map((row) => ({
    thumbnailUrl: extractThumbnailUrlFromMarkdownCached(
      `post:${row.id}:${row.updated_at}`,
      row.content,
    ),
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: createExcerpt(row.content),
    tags:
      row.tags_csv.length > 0
        ? row.tags_csv.split("\u001f").filter((tag) => tag.length > 0)
        : [],
    publishedAt: row.published_at,
    status: row.status,
  }));
}

export default async function PostsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const session = await getAdminSessionFromServerCookies();
  const statuses: readonly PostStatus[] = session
    ? ["draft", "published"]
    : ["published"];
  const q = normalizeSearchQuery(params.q);
  const requestedPage = parsePositiveInteger(params.page, 1);
  const perPage = Math.min(50, parsePositiveInteger(params.per_page, 10));
  let totalCount = 0;
  let searchErrorMessage: string | null = null;

  try {
    totalCount = loadTotalPosts(statuses, q);
  } catch (error) {
    if (q && isFtsQuerySyntaxError(error)) {
      searchErrorMessage = "검색어가 올바르지 않습니다.";
      totalCount = 0;
    } else {
      throw error;
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const page = Math.min(requestedPage, totalPages);
  let posts = [] as ReturnType<typeof loadPosts>;

  if (searchErrorMessage) {
    posts = [];
  } else {
    try {
      posts = loadPosts(statuses, page, perPage, q);
    } catch (error) {
      if (q && isFtsQuerySyntaxError(error)) {
        searchErrorMessage = "검색어가 올바르지 않습니다.";
        posts = [];
        totalCount = 0;
      } else {
        throw error;
      }
    }
  }

  const startIndex = totalCount === 0 ? 0 : (page - 1) * perPage + 1;
  const endIndex = Math.min(page * perPage, totalCount);
  const pageNumbers = Array.from(
    { length: totalPages },
    (_, index) => index + 1,
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">글 목록</h1>
        <p className="text-sm text-slate-600">
          {totalCount > 0
            ? `${startIndex}-${endIndex} / 총 ${totalCount}개의 글`
            : searchErrorMessage
              ? searchErrorMessage
              : q
                ? "검색 결과가 없습니다."
                : "공개된 글이 없습니다."}
        </p>
        <SearchBar query={q} />
      </header>

      {posts.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-slate-800">
            {q
              ? searchErrorMessage
                ? "검색어가 올바르지 않습니다"
                : "검색 결과가 없습니다"
              : "아직 글이 없습니다"}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {q
              ? searchErrorMessage
                ? "따옴표 등 특수 문자가 포함되어 있지 않은지 확인해 주세요."
                : "다른 키워드로 다시 검색해 보세요."
              : "공개 상태로 저장된 글이 생기면 목록에 표시됩니다."}
          </p>
        </section>
      ) : (
        <div className="grid gap-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <nav
          className="flex flex-wrap items-center justify-center gap-2 pt-2"
          aria-label="페이지네이션"
        >
          <a
            href={buildPageHref(Math.max(1, page - 1), perPage, q)}
            aria-disabled={page <= 1}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 aria-disabled:pointer-events-none aria-disabled:opacity-40"
          >
            이전
          </a>
          {pageNumbers.map((value) => (
            <a
              key={value}
              href={buildPageHref(value, perPage, q)}
              aria-current={value === page ? "page" : undefined}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 aria-[current=page]:border-slate-900 aria-[current=page]:bg-slate-900 aria-[current=page]:text-white"
            >
              {value}
            </a>
          ))}
          <a
            href={buildPageHref(Math.min(totalPages, page + 1), perPage, q)}
            aria-disabled={page >= totalPages}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 aria-disabled:pointer-events-none aria-disabled:opacity-40"
          >
            다음
          </a>
        </nav>
      ) : null}
    </main>
  );
}
