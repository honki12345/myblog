import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import { buildWikiPathHref } from "@/lib/comment-tags";
import { getWikiRootOverview } from "@/lib/wiki";

export const dynamic = "force-dynamic";

function buildLoginHref(nextPath: string): string {
  return `/admin/login?next=${encodeURIComponent(nextPath)}`;
}

export default async function Home() {
  const session = await getAdminSessionFromServerCookies();
  if (!session) {
    redirect(buildLoginHref("/"));
  }

  const overview = getWikiRootOverview();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Admin Home
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">홈</h1>
        <p className="max-w-3xl text-sm text-slate-600 sm:text-base">
          홈 기본 화면을 위키 루트 탐색 중심으로 전환했습니다. 댓글 경로를
          중심으로 카테고리를 탐색하고, 필요할 때 글 목록/작성 화면으로 이동할
          수 있습니다.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight">빠른 이동</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/wiki"
            className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            위키 루트
          </Link>
          <Link
            href="/posts"
            className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            글 목록
          </Link>
          <Link
            href="/admin/write"
            className="inline-flex rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            글 작성
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            위키 루트 카테고리
          </h2>
          <p className="text-xs text-slate-600">
            공개 댓글 {overview.totalComments}개 / 경로 {overview.totalPaths}개
          </p>
        </div>

        {overview.categories.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
            아직 공개된 위키 데이터가 없습니다.
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {overview.categories.map((category) => (
              <li key={category.path}>
                <Link
                  href={buildWikiPathHref(category.path)}
                  className="flex min-w-0 items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-slate-300"
                >
                  <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                    {category.segment}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {category.count}개
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
