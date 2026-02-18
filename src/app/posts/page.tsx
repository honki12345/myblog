import PostCard from "@/components/PostCard";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import {
  listPostsWithTotalCount,
  type PostListItem,
  type PostStatus,
  type PostTypeFilter,
} from "@/lib/post-list";

const MAX_SEARCH_QUERY_LENGTH = 100;

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

function normalizeSearchQuery(value: string | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  return normalized.length > MAX_SEARCH_QUERY_LENGTH
    ? normalized.slice(0, MAX_SEARCH_QUERY_LENGTH)
    : normalized;
}

function normalizeOptionalDecodedString(
  value: string | undefined,
): string | null {
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

function isFtsQuerySyntaxError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  if (message.includes("fts5:")) {
    return true;
  }

  return (
    message.includes("unterminated") ||
    message.includes("malformed match") ||
    (message.includes("match") && message.includes("syntax"))
  );
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
  const q = normalizeSearchQuery(params.q);
  const tag = normalizeOptionalDecodedString(params.tag);
  const ftsQuery = q;

  const requestedPage = parsePositiveInteger(params.page, 1);
  const perPage = Math.min(50, parsePositiveInteger(params.per_page, 10));

  const requestedOffset = (requestedPage - 1) * perPage;
  let items: PostListItem[] = [];
  let totalCount = 0;
  let searchErrorMessage: string | null = null;

  try {
    const result = listPostsWithTotalCount({
      statuses,
      type,
      tag,
      ftsQuery,
      limit: perPage,
      offset: requestedOffset,
    });
    items = result.items;
    totalCount = result.totalCount;
  } catch (error) {
    if (ftsQuery && isFtsQuerySyntaxError(error)) {
      searchErrorMessage = "검색어가 올바르지 않습니다";
      items = [];
      totalCount = 0;
    } else {
      throw error;
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * perPage;

  let posts: PostListItem[] = items;
  if (!searchErrorMessage && offset !== requestedOffset) {
    try {
      posts = listPostsWithTotalCount({
        statuses,
        type,
        tag,
        ftsQuery,
        limit: perPage,
        offset,
      }).items;
    } catch (error) {
      if (ftsQuery && isFtsQuerySyntaxError(error)) {
        searchErrorMessage = "검색어가 올바르지 않습니다";
        posts = [];
        totalCount = 0;
      } else {
        throw error;
      }
    }
  }

  const startIndex = totalCount === 0 ? 0 : (page - 1) * perPage + 1;
  const endIndex = Math.min(page * perPage, totalCount);
  const paginationItems = (() => {
    const windowRadius = 2;
    const pages = new Set<number>();
    pages.add(1);
    pages.add(totalPages);

    for (
      let candidate = page - windowRadius;
      candidate <= page + windowRadius;
      candidate += 1
    ) {
      if (candidate >= 1 && candidate <= totalPages) {
        pages.add(candidate);
      }
    }

    const sortedPages = Array.from(pages).sort((a, b) => a - b);
    const items: Array<
      { kind: "page"; value: number } | { kind: "ellipsis"; key: string }
    > = [];

    let previousPage: number | null = null;
    for (const value of sortedPages) {
      if (previousPage !== null) {
        const gap = value - previousPage;
        if (gap === 2) {
          items.push({ kind: "page", value: previousPage + 1 });
        } else if (gap > 2) {
          items.push({
            kind: "ellipsis",
            key: `ellipsis-${previousPage}-${value}`,
          });
        }
      }

      items.push({ kind: "page", value });
      previousPage = value;
    }

    return items;
  })();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">글 목록</h1>
        <p className="text-sm text-slate-600">
          {totalCount > 0
            ? `${startIndex}-${endIndex} / 총 ${totalCount}개의 글`
            : searchErrorMessage
              ? `${searchErrorMessage}.`
              : q
                ? "검색 결과가 없습니다."
                : tag || type !== "all"
                  ? "조건에 맞는 글이 없습니다."
                  : "아직 글이 없습니다."}
        </p>
      </header>

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <nav aria-label="글 유형" className="flex flex-wrap items-center gap-2">
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
          <h2 className="text-lg font-semibold text-slate-800">
            {q
              ? searchErrorMessage
                ? "검색어가 올바르지 않습니다"
                : "검색 결과가 없습니다"
              : tag || type !== "all"
                ? "조건에 맞는 글이 없습니다"
                : "아직 글이 없습니다"}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {q
              ? searchErrorMessage
                ? "따옴표 등 특수 문자가 포함되어 있지 않은지 확인해 주세요."
                : "다른 키워드로 다시 검색해 보세요."
              : tag || type !== "all"
                ? "필터를 초기화해 보세요."
                : "공개 상태로 저장된 글이 생기면 목록에 표시됩니다."}
          </p>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
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
          {paginationItems.map((item) => {
            if (item.kind === "ellipsis") {
              return (
                <span
                  key={item.key}
                  aria-hidden="true"
                  className="px-2 text-sm text-slate-500"
                >
                  ...
                </span>
              );
            }

            return (
              <a
                key={item.value}
                href={buildPageHref({
                  page: item.value,
                  perPage,
                  type,
                  q,
                  tag,
                })}
                aria-current={item.value === page ? "page" : undefined}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 aria-[current=page]:border-slate-900 aria-[current=page]:bg-slate-900 aria-[current=page]:text-white"
              >
                {item.value}
              </a>
            );
          })}
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
