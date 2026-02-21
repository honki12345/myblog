import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  buildWikiPathHref,
  normalizeWikiPathFromSegments,
} from "@/lib/comment-tags";
import { formatDate } from "@/lib/date";
import { getWikiPathOverview } from "@/lib/wiki";

const DEFAULT_COMMENT_LIMIT = 120;

type PageProps = {
  params: Promise<{ path: string[] }>;
};

type BreadcrumbItem = {
  label: string;
  href: string;
};

function buildBreadcrumbs(path: string): BreadcrumbItem[] {
  const segments = path.split("/");
  const items: BreadcrumbItem[] = [];
  let current = "";

  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    items.push({
      label: segment,
      href: buildWikiPathHref(current),
    });
  }

  return items;
}

function createCanonicalUrl(path: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) {
    return null;
  }

  return `${base.replace(/\/+$/, "")}${buildWikiPathHref(path)}`;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { path: rawPathSegments } = await params;
  const normalizedPath = normalizeWikiPathFromSegments(rawPathSegments);
  if (!normalizedPath) {
    return {
      title: "위키 경로를 찾을 수 없습니다",
    };
  }

  const overview = getWikiPathOverview(normalizedPath, 1);
  if (!overview) {
    return {
      title: "위키 경로를 찾을 수 없습니다",
    };
  }

  const canonical = createCanonicalUrl(normalizedPath);

  return {
    title: `위키: ${normalizedPath}`,
    description: `${overview.totalCount}개의 댓글이 /${normalizedPath} 경로에 연결되어 있습니다.`,
    alternates: canonical
      ? {
          canonical,
        }
      : undefined,
  };
}

export const dynamic = "force-dynamic";

export default async function WikiPathPage({ params }: PageProps) {
  const { path: rawPathSegments } = await params;
  const normalizedPath = normalizeWikiPathFromSegments(rawPathSegments);
  if (!normalizedPath) {
    notFound();
  }

  const overview = getWikiPathOverview(normalizedPath, DEFAULT_COMMENT_LIMIT);
  if (!overview) {
    notFound();
  }

  const breadcrumbs = buildBreadcrumbs(normalizedPath);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <nav aria-label="브레드크럼">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
            <li>
              <Link
                href="/wiki"
                className="rounded px-1 py-0.5 hover:bg-slate-100 hover:text-slate-900"
              >
                wiki
              </Link>
            </li>
            {breadcrumbs.map((item) => (
              <li key={item.href} className="flex items-center gap-1">
                <span>/</span>
                <Link
                  href={item.href}
                  className="rounded px-1 py-0.5 hover:bg-slate-100 hover:text-slate-900"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        <h1 className="text-2xl font-semibold tracking-tight">
          위키 경로: /{overview.path}
        </h1>
        <p className="text-sm text-slate-600">
          정확히 매칭된 댓글 {overview.exactCount}개, 하위 경로 포함 총{" "}
          {overview.totalCount}개
        </p>
      </header>

      {overview.categories.length > 0 ? (
        <section aria-labelledby="wiki-child-categories" className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2
              id="wiki-child-categories"
              className="text-lg font-semibold tracking-tight"
            >
              하위 카테고리
            </h2>
            <p className="text-xs text-slate-600">
              {overview.categories.length}개
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {overview.categories.map((category) => (
              <li key={category.path}>
                <Link
                  href={buildWikiPathHref(category.path)}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {category.segment}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      /{category.path}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 tabular-nums">
                    {category.count}개
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="wiki-comments-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="wiki-comments-heading" className="text-lg font-semibold">
            연결된 댓글
          </h2>
          {overview.truncated ? (
            <p className="text-xs text-slate-600">
              최신 {DEFAULT_COMMENT_LIMIT}개만 표시합니다.
            </p>
          ) : null}
        </div>

        {overview.comments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm text-slate-600">
              이 경로에 노출 가능한 댓글이 없습니다.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {overview.comments.map((comment) => (
              <li
                key={comment.commentId}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Link
                    href={buildWikiPathHref(comment.tagPath)}
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                  >
                    /{comment.tagPath}
                  </Link>
                  <span className="text-xs text-slate-500">
                    업데이트: {formatDate(comment.updatedAt)}
                  </span>
                </div>

                <p className="text-sm leading-6 whitespace-pre-wrap text-slate-800">
                  {comment.content}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                  <Link
                    href={`/posts/${comment.postSlug}`}
                    className="font-medium text-slate-700 hover:underline"
                  >
                    블로그 글 보기
                  </Link>
                  {comment.sourceUrl ? (
                    <a
                      href={comment.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-slate-700 hover:underline"
                    >
                      원문 링크
                    </a>
                  ) : null}
                  <span>{comment.postTitle}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
