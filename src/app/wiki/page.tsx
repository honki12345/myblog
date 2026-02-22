import type { Metadata } from "next";
import WikiExplorerClient from "@/components/wiki/WikiExplorerClient";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import { getWikiRootOverview } from "@/lib/wiki";

export const metadata: Metadata = {
  title: "위키",
};

export const dynamic = "force-dynamic";

export default async function WikiIndexPage() {
  const adminSession = await getAdminSessionFromServerCookies();
  const overview = getWikiRootOverview();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">위키</h1>
        <p className="text-sm text-slate-600">
          {overview.totalComments > 0
            ? `${overview.totalComments}개의 공개 댓글이 ${overview.totalPaths}개 경로에 정리되어 있습니다.`
            : "아직 공개된 위키 데이터가 없습니다."}
        </p>
      </header>

      <WikiExplorerClient
        initialRootOverview={overview}
        initialPath={null}
        initialPathOverview={null}
        isAdmin={Boolean(adminSession)}
      />
    </main>
  );
}
