import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { normalizeWikiPathFromSegments } from "@/lib/comment-tags";
import WikiExplorerClient from "@/components/wiki/WikiExplorerClient";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import { getWikiPathOverview, getWikiRootOverview } from "@/lib/wiki";

const DEFAULT_COMMENT_LIMIT = 120;

type PageProps = {
  params: Promise<{ path: string[] }>;
};

function createCanonicalUrl(path: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) {
    return null;
  }

  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base.replace(/\/+$/, "")}/wiki/${encodedPath}`;
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

  const adminSession = await getAdminSessionFromServerCookies();
  const rootOverview = getWikiRootOverview();
  const overview = getWikiPathOverview(normalizedPath, DEFAULT_COMMENT_LIMIT);
  if (!overview) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">위키</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          경로 `/{overview.path}` 기준으로 정확히 매칭된 댓글{" "}
          {overview.exactCount}개, 하위 경로 포함 총 {overview.totalCount}개를
          탐색할 수 있습니다.
        </p>
      </header>

      <WikiExplorerClient
        initialRootOverview={rootOverview}
        initialPath={normalizedPath}
        initialPathOverview={overview}
        isAdmin={Boolean(adminSession)}
      />
    </main>
  );
}
