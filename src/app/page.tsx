import Link from "next/link";
import PostCard, { type PostCardData } from "@/components/PostCard";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import { formatDate } from "@/lib/date";
import {
  listActiveTags,
  listPostsWithTotalCount,
  type PostListItem,
  type PostStatus,
} from "@/lib/post-list";

export const dynamic = "force-dynamic";

function toPostCardData(item: PostListItem): PostCardData {
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

function buildPostHref(item: Pick<PostListItem, "id" | "slug" | "status">) {
  return item.status === "draft"
    ? `/admin/write?id=${item.id}`
    : `/posts/${item.slug}`;
}

export default async function Home() {
  const session = await getAdminSessionFromServerCookies();
  const isAdmin = Boolean(session);
  const statuses: readonly PostStatus[] = session
    ? ["draft", "published"]
    : ["published"];

  const tags = listActiveTags(statuses, 10);
  const originalPosts = listPostsWithTotalCount({
    statuses,
    type: "original",
    limit: 5,
    offset: 0,
  }).items;
  const aiPosts = listPostsWithTotalCount({
    statuses,
    type: "ai",
    limit: 5,
    offset: 0,
  }).items;
  const hasAnyPosts = originalPosts.length > 0 || aiPosts.length > 0;

  const includesDraft =
    isAdmin &&
    [...originalPosts, ...aiPosts].some((post) => post.status === "draft");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Explore
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {isAdmin ? (includesDraft ? "홈 (초안 포함)" : "홈") : "홈"}
        </h1>
        <p className="max-w-2xl text-sm text-slate-600 sm:text-base">
          태그로 탐색하거나, 직접 작성 글과 AI 수집 글을 분리해서 최신 글을
          확인할 수 있습니다.
        </p>
      </header>

      {!hasAnyPosts ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          <p>
            아직 글이 없습니다. 아래의 태그 허브나 아카이브 링크로 탐색을 시작해
            보세요.
          </p>
          {isAdmin ? (
            <Link
              href="/admin/write"
              className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              글 작성하기
            </Link>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">태그 허브</h2>
          <Link
            href="/tags"
            className="text-sm font-medium text-slate-700 hover:underline"
          >
            전체 태그 보기
          </Link>
        </div>

        {tags.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
            아직 글에 연결된 태그가 없습니다.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            최신 직접 작성
          </h2>
          <Link
            href="/posts?type=original"
            className="text-sm font-medium text-slate-700 hover:underline"
          >
            직접 작성 아카이브
          </Link>
        </div>

        {originalPosts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
            아직 직접 작성 글이 없습니다.
          </div>
        ) : (
          <div className="grid gap-4">
            {originalPosts.map((post) => (
              <PostCard key={post.id} post={toPostCardData(post)} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">최신 AI 수집</h2>
          <Link
            href="/posts?type=ai"
            className="text-sm font-medium text-slate-700 hover:underline"
          >
            AI 수집 아카이브
          </Link>
        </div>

        {aiPosts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
            아직 AI 수집 글이 없습니다.
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm">
            {aiPosts.map((post) => {
              const publishedDate = formatDate(post.publishedAt);
              const label = post.sourceDomain ?? "unknown";

              return (
                <li
                  key={post.id}
                  className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <Link
                    href={buildPostHref(post)}
                    className="min-w-0 text-sm font-semibold text-slate-900 hover:underline"
                  >
                    <span className="line-clamp-1">{post.title}</span>
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">
                      {label}
                    </span>
                    {publishedDate ? <span>{publishedDate}</span> : null}
                    {post.status === "draft" ? (
                      <span className="rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-800">
                        draft
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <Link
          href="/posts"
          className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          전체 아카이브
        </Link>
        <Link
          href="/posts?type=original"
          className="inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          직접 작성만 보기
        </Link>
        <Link
          href="/posts?type=ai"
          className="inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          AI 수집만 보기
        </Link>
      </section>
    </main>
  );
}
