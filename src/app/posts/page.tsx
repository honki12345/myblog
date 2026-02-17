import PostCard from "@/components/PostCard";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import {
  listPostsWithTotalCount,
  type PostListItem,
  type PostStatus,
  type PostTypeFilter,
} from "@/lib/post-list";

type PageProps = {
  searchParams: Promise<{
    page?: string;
    per_page?: string;
    type?: string;
    q?: string;
    tag?: string;
  }>;
};

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

function parsePostType(value: string | undefined): PostTypeFilter {
  if (value === "original" || value === "ai" || value === "all") {
    return value;
  }
  return "all";
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalDecodedString(value: string | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(normalized).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return normalized;
  }
}

function buildFtsQuery(raw: string): string | null {
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .trim();

  const tokens = cleaned
    .split(/\s+/)
    .map((token) => token.replace(/^[-_]+|[-_]+$/g, ""))
    .filter((token) => token.length > 0)
    .slice(0, 10);

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" AND ");
}

function buildPageHref(options: {
  page: number;
  perPage: number;
  type: PostTypeFilter;
  q: string | null;
  tag: string | null;
}): string {
  const search = new URLSearchParams();
  search.set("page", String(options.page));
  if (options.perPage !== 10) {
    search.set("per_page", String(options.perPage));
  }
  if (options.type !== "all") {
    search.set("type", options.type);
  }
  if (options.q) {
    search.set("q", options.q);
  }
  if (options.tag) {
    search.set("tag", options.tag);
  }
  return `/posts?${search.toString()}`;
}

function toPostCardData(item: PostListItem) {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    excerpt: item.excerpt,
    tags: item.tags,
    publishedAt: item.publishedAt,
    status: item.status,
    thumbnailUrl: item.thumbnailUrl,
  };
}

export default async function PostsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const session = await getAdminSessionFromServerCookies();
  const statuses: readonly PostStatus[] = session
    ? ["draft", "published"]
    : ["published"];

  const type = parsePostType(params.type);
  const q = normalizeOptionalString(params.q);
  const tag = normalizeOptionalDecodedString(params.tag);
  const ftsQuery = q ? buildFtsQuery(q) : null;
  const invalidSearch = Boolean(q && !ftsQuery);

  const requestedPage = parsePositiveInteger(params.page, 1);
  const perPage = Math.min(50, parsePositiveInteger(params.per_page, 10));

  const { items, totalCount } = invalidSearch
    ? { items: [], totalCount: 0 }
    : listPostsWithTotalCount({
        statuses,
        type,
        tag,
        ftsQuery,
        limit: perPage,
        offset: (requestedPage - 1) * perPage,
      });

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * perPage;

  const { items: posts } =
    invalidSearch || offset === (requestedPage - 1) * perPage
      ? { items }
      : listPostsWithTotalCount({
          statuses,
          type,
          tag,
          ftsQuery,
          limit: perPage,
          offset,
        });

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
          {invalidSearch
            ? "검색어를 해석할 수 없습니다. 다른 검색어로 다시 시도해 주세요."
            : totalCount > 0
              ? `${startIndex}-${endIndex} / 총 ${totalCount}개의 글`
              : q || tag || type !== "all"
                ? "조건에 맞는 글이 없습니다."
                : "공개된 글이 없습니다."}
        </p>
      </header>

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <nav
          aria-label="글 유형"
          className="flex flex-wrap items-center gap-2"
        >
          {(
            [
              { value: "all", label: "전체" },
              { value: "original", label: "직접 작성" },
              { value: "ai", label: "AI 수집" },
            ] as const
          ).map((tab) => {
            const href =
              tab.value === "all"
                ? buildPageHref({
                    page: 1,
                    perPage,
                    type: "all",
                    q,
                    tag,
                  })
                : buildPageHref({
                    page: 1,
                    perPage,
                    type: tab.value,
                    q,
                    tag,
                  });

            const isActive = type === tab.value;

            return (
              <a
                key={tab.value}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 aria-[current=page]:border-slate-900 aria-[current=page]:bg-slate-900 aria-[current=page]:text-white"
              >
                {tab.label}
              </a>
            );
          })}
        </nav>

        <form method="get" action="/posts" className="grid gap-3">
          {type !== "all" ? (
            <input type="hidden" name="type" value={type} />
          ) : null}
          {perPage !== 10 ? (
            <input type="hidden" name="per_page" value={String(perPage)} />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              <span>검색</span>
              <input
                name="q"
                defaultValue={q ?? ""}
                placeholder="제목/본문 검색"
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              <span>태그</span>
              <input
                name="tag"
                defaultValue={tag ?? ""}
                placeholder="예: sample"
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="submit"
              className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700"
            >
              적용
            </button>
            <a
              href={buildPageHref({
                page: 1,
                perPage,
                type: "all",
                q: null,
                tag: null,
              })}
              className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              초기화
            </a>
          </div>
        </form>
      </section>

      {posts.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-slate-800">빈 목록</h2>
          <p className="mt-2 text-sm text-slate-600">
            {invalidSearch
              ? "검색어를 바꾸거나 필터를 초기화해 보세요."
              : "조건에 맞는 글이 없습니다."}
          </p>
        </section>
      ) : (
        <div className="grid gap-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={toPostCardData(post)} />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <nav
          className="flex flex-wrap items-center justify-center gap-2 pt-2"
          aria-label="페이지네이션"
        >
          <a
            href={buildPageHref({
              page: Math.max(1, page - 1),
              perPage,
              type,
              q,
              tag,
            })}
            aria-disabled={page <= 1}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 aria-disabled:pointer-events-none aria-disabled:opacity-40"
          >
            이전
          </a>
          {pageNumbers.map((value) => (
            <a
              key={value}
              href={buildPageHref({
                page: value,
                perPage,
                type,
                q,
                tag,
              })}
              aria-current={value === page ? "page" : undefined}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 aria-[current=page]:border-slate-900 aria-[current=page]:bg-slate-900 aria-[current=page]:text-white"
            >
              {value}
            </a>
          ))}
          <a
            href={buildPageHref({
              page: Math.min(totalPages, page + 1),
              perPage,
              type,
              q,
              tag,
            })}
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
