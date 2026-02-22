import Link from "next/link";
import WikiExplorerClient from "@/components/wiki/WikiExplorerClient";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import { getWikiRootOverview } from "@/lib/wiki";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getAdminSessionFromServerCookies();
  const overview = getWikiRootOverview();
  const isAdmin = Boolean(session);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">위키</h1>
        <p className="max-w-3xl text-sm text-slate-600 sm:text-base">
          댓글 태그 경로 기반 위키를 홈에서 바로 탐색할 수 있습니다. 경로를
          선택하면 `/wiki/[...path]` 딥링크로 이어지고 새로고침 후에도 동일한
          경로를 복원합니다.
        </p>
      </header>

      {isAdmin ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">
              관리자 빠른 이동
            </h2>
            <p className="text-xs text-slate-600">
              공개 댓글 {overview.totalComments}개 / 경로 {overview.totalPaths}
              개
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
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
      ) : null}

      <WikiExplorerClient
        initialRootOverview={overview}
        initialPath={null}
        initialPathOverview={null}
        enableInPlaceNavigation={false}
      />
    </main>
  );
}
