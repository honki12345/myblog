import PostCard from "@/components/PostCard";
import { getDb } from "@/lib/db";

type PageProps = {
  searchParams: Promise<{
    page?: string;
    per_page?: string;
  }>;
};

type PostListRow = {
  id: number;
  slug: string;
  title: string;
  content: string;
  published_at: string | null;
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

function buildPageHref(page: number, perPage: number): string {
  const search = new URLSearchParams();
  search.set("page", String(page));
  if (perPage !== 10) {
    search.set("per_page", String(perPage));
  }
  return `/posts?${search.toString()}`;
}

function loadTotalPublishedPosts(): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM posts WHERE status = 'published'")
    .get() as { count: number } | undefined;
  return row?.count ?? 0;
}

function loadPublishedPosts(page: number, perPage: number) {
  const db = getDb();
  const offset = (page - 1) * perPage;
  const rows = db
    .prepare(
      `
      SELECT
        p.id,
        p.slug,
        p.title,
        p.content,
        p.published_at,
        COALESCE(GROUP_CONCAT(t.name, char(31)), '') AS tags_csv
      FROM posts p
      LEFT JOIN post_tags pt ON pt.post_id = p.id
      LEFT JOIN tags t ON t.id = pt.tag_id
      WHERE p.status = 'published'
      GROUP BY p.id
      ORDER BY datetime(COALESCE(p.published_at, p.created_at)) DESC, p.id DESC
      LIMIT ? OFFSET ?
      `,
    )
    .all(perPage, offset) as PostListRow[];

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: createExcerpt(row.content),
    tags:
      row.tags_csv.length > 0
        ? row.tags_csv.split("\u001f").filter((tag) => tag.length > 0)
        : [],
    publishedAt: row.published_at,
  }));
}

export default async function PostsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const requestedPage = parsePositiveInteger(params.page, 1);
  const perPage = Math.min(50, parsePositiveInteger(params.per_page, 10));
  const totalCount = loadTotalPublishedPosts();
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const page = Math.min(requestedPage, totalPages);
  const posts = loadPublishedPosts(page, perPage);

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
            : "공개된 글이 없습니다."}
        </p>
      </header>

      {posts.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-slate-800">
            아직 글이 없습니다
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            공개 상태로 저장된 글이 생기면 목록에 표시됩니다.
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
            href={buildPageHref(Math.max(1, page - 1), perPage)}
            aria-disabled={page <= 1}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 aria-disabled:pointer-events-none aria-disabled:opacity-40"
          >
            이전
          </a>
          {pageNumbers.map((value) => (
            <a
              key={value}
              href={buildPageHref(value, perPage)}
              aria-current={value === page ? "page" : undefined}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 aria-[current=page]:border-slate-900 aria-[current=page]:bg-slate-900 aria-[current=page]:text-white"
            >
              {value}
            </a>
          ))}
          <a
            href={buildPageHref(Math.min(totalPages, page + 1), perPage)}
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
