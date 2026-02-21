import Link from "next/link";
import { buildWikiPathHref } from "@/lib/comment-tags";
import { getWikiRootOverview } from "@/lib/wiki";

export const dynamic = "force-dynamic";

export default function WikiIndexPage() {
  const overview = getWikiRootOverview();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">댓글 위키</h1>
        <p className="text-sm text-slate-600">
          {overview.totalComments > 0
            ? `${overview.totalComments}개의 공개 댓글이 ${overview.totalPaths}개 경로에 정리되어 있습니다.`
            : "아직 공개된 댓글 위키 데이터가 없습니다."}
        </p>
      </header>

      {overview.categories.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-slate-800">빈 위키</h2>
          <p className="mt-2 text-sm text-slate-600">
            관리자가 댓글에 태그 경로를 추가하면 카테고리가 표시됩니다.
          </p>
        </section>
      ) : (
        <section aria-labelledby="wiki-root-categories" className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2
              id="wiki-root-categories"
              className="text-lg font-semibold tracking-tight"
            >
              카테고리 트리
            </h2>
            <p className="text-xs text-slate-600">
              루트 카테고리 {overview.categories.length}개
            </p>
          </div>

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {overview.categories.map((category) => (
              <li key={category.path}>
                <Link
                  href={buildWikiPathHref(category.path)}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-base font-semibold text-slate-900">
                      {category.segment}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      /{category.path}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 tabular-nums">
                      {category.count}개
                    </span>
                    {category.hasChildren ? (
                      <span className="text-[11px] font-medium text-slate-500">
                        하위 있음
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-slate-400">
                        leaf
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
