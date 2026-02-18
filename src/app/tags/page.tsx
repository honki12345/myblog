import Link from "next/link";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import { listTagCounts, type PostStatus } from "@/lib/post-list";

export const dynamic = "force-dynamic";

const MAX_SEARCH_QUERY_LENGTH = 100;
const TOP_TAG_LIMIT = 10;
const TAG_PREVIEW_LIMIT = 10;

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

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

function buildTagHref(name: string): string {
  return `/tags/${encodeURIComponent(name)}`;
}

export default async function TagsIndexPage({ searchParams }: PageProps) {
  const [params, session] = await Promise.all([
    searchParams,
    getAdminSessionFromServerCookies(),
  ]);
  const q = normalizeSearchQuery(params.q);
  const isAdmin = Boolean(session);
  const statuses: readonly PostStatus[] = session
    ? ["draft", "published"]
    : ["published"];
  const tags = listTagCounts(statuses, q);
  const label = isAdmin ? "글" : "공개 글";
  const suffix = isAdmin ? " (초안 포함)" : "";
  const isSearching = Boolean(q);
  const topTags = isSearching ? [] : tags.slice(0, TOP_TAG_LIMIT);
  const previewTags = isSearching ? [] : tags.slice(0, TAG_PREVIEW_LIMIT);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">태그</h1>
          <p className="text-sm text-slate-600">
            {tags.length > 0
              ? isSearching
                ? `"${q}" 검색 결과 ${tags.length}개의 태그가 있습니다. (${label} 기준${suffix})`
                : `${label} 기준 ${tags.length}개의 태그가 있습니다${suffix}.`
              : isSearching
                ? `"${q}"에 해당하는 태그가 없습니다. (${label} 기준${suffix})`
                : `${label}에 연결된 태그가 없습니다.`}
          </p>
        </div>

        <form method="get" data-tags-search-form className="space-y-2">
          <label htmlFor="tags-query" className="sr-only">
            태그 검색
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-slate-400 focus-within:ring-offset-2 focus-within:ring-offset-white">
              <input
                id="tags-query"
                name="q"
                type="search"
                autoComplete="off"
                defaultValue={q ?? ""}
                placeholder="태그 검색… (예: sample)"
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="submit"
                className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none"
              >
                검색
              </button>
            </div>
            {isSearching ? (
              <Link
                href="/tags"
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none"
              >
                초기화
              </Link>
            ) : null}
          </div>
        </form>
      </header>

      {tags.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-slate-800">빈 목록</h2>
          <p className="mt-2 text-sm text-slate-600">
            {isSearching
              ? "검색어를 바꾸거나 초기화해 보세요."
              : isAdmin
                ? "글을 작성하고 태그를 추가하면 목록에 표시됩니다."
                : "공개 글이 생기면 태그 목록에 표시됩니다."}
          </p>
          {isSearching ? (
            <Link
              href="/tags"
              className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none"
            >
              전체 태그 보기
            </Link>
          ) : null}
        </section>
      ) : (
        <>
          {!isSearching ? (
            <section
              data-tags-top
              aria-labelledby="top-tags-heading"
              className="space-y-3"
            >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2
                  id="top-tags-heading"
                  className="text-lg font-semibold tracking-tight"
                >
                  Top tags
                </h2>
                <p className="text-xs text-slate-600">
                  상위 {topTags.length}개
                </p>
              </div>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {topTags.map((tag) => (
                  <li key={tag.name}>
                    <Link
                      href={buildTagHref(tag.name)}
                      className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none"
                    >
                      <span className="min-w-0 truncate text-base font-semibold text-slate-900">
                        #{tag.name}
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700 tabular-nums">
                        {tag.count}개
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section
            data-tags-drawer-section
            aria-labelledby="tags-drawer-heading"
            className="space-y-3"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2
                id="tags-drawer-heading"
                className="text-lg font-semibold tracking-tight"
              >
                전체 태그
              </h2>
              {isSearching ? (
                <p className="text-xs text-slate-600">검색 결과만 표시합니다</p>
              ) : (
                <p className="text-xs text-slate-600">
                  접어두면 상위 {previewTags.length}개만 미리 보여요
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <details data-tags-drawer open={isSearching}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                  <span className="text-sm font-semibold text-slate-900">
                    전체 태그{" "}
                    <span className="font-medium text-slate-500 tabular-nums">
                      (총 {tags.length}개)
                    </span>
                  </span>
                  <span className="text-sm font-medium text-slate-700">
                    전체 보기
                  </span>
                </summary>

                <div data-tags-drawer-grid className="mt-3">
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {tags.map((tag) => (
                      <li key={tag.name}>
                        <Link
                          href={buildTagHref(tag.name)}
                          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                            #{tag.name}
                          </span>
                          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 tabular-nums">
                            {tag.count}개
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>

              {!isSearching ? (
                <div
                  data-tags-drawer-preview
                  className="mt-3 flex flex-wrap gap-2"
                >
                  {previewTags.map((tag) => (
                    <Link
                      key={tag.name}
                      href={buildTagHref(tag.name)}
                      className="inline-flex max-w-full items-center rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none"
                      title={`#${tag.name} (${tag.count}개)`}
                    >
                      <span className="min-w-0 truncate">#{tag.name}</span>
                    </Link>
                  ))}
                  {tags.length > previewTags.length ? (
                    <span className="inline-flex items-center rounded-full bg-white px-2 py-1 text-xs font-medium text-slate-500 tabular-nums">
                      +{tags.length - previewTags.length}개
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
