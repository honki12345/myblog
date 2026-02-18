import Link from "next/link";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import { listTagCounts, type PostStatus } from "@/lib/post-list";

export const dynamic = "force-dynamic";

export default async function TagsIndexPage() {
  const session = await getAdminSessionFromServerCookies();
  const isAdmin = Boolean(session);
  const statuses: readonly PostStatus[] = session
    ? ["draft", "published"]
    : ["published"];
  const tags = listTagCounts(statuses);
  const label = isAdmin ? "글" : "공개 글";
  const suffix = isAdmin ? " (초안 포함)" : "";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">태그</h1>
        <p className="text-sm text-slate-600">
          {tags.length > 0
            ? `${label} 기준 ${tags.length}개의 태그가 있습니다${suffix}.`
            : `${label}에 연결된 태그가 없습니다.`}
        </p>
      </header>

      {tags.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-slate-800">빈 목록</h2>
          <p className="mt-2 text-sm text-slate-600">
            {isAdmin
              ? "글을 작성하고 태그를 추가하면 목록에 표시됩니다."
              : "공개 글이 생기면 태그 목록에 표시됩니다."}
          </p>
        </section>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tags.map((tag) => (
            <li key={tag.name}>
              <Link
                href={`/tags/${encodeURIComponent(tag.name)}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-slate-300"
              >
                <span className="text-sm font-semibold text-slate-900">
                  #{tag.name}
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {tag.count}개
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
