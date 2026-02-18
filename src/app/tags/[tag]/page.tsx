import PostCard from "@/components/PostCard";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import {
  listPostsWithTotalCount,
  type PostListItem,
  type PostStatus,
} from "@/lib/post-list";

const TAG_PAGE_LIMIT = 5000;

type PageProps = {
  params: Promise<{ tag: string }>;
};

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

export default async function TagPage({ params }: PageProps) {
  const { tag } = await params;
  const decodedTag = decodeURIComponent(tag);
  const session = await getAdminSessionFromServerCookies();
  const isAdmin = Boolean(session);
  const statuses: readonly PostStatus[] = session
    ? ["draft", "published"]
    : ["published"];
  const { items: posts, totalCount } = listPostsWithTotalCount({
    statuses,
    tag: decodedTag,
    limit: TAG_PAGE_LIMIT,
    offset: 0,
  });
  const includesDraft =
    isAdmin && posts.some((post) => post.status === "draft");
  const label = isAdmin ? "글" : "공개 글";
  const draftSuffix = includesDraft ? " (초안 포함)" : "";
  const isTruncated = totalCount > posts.length;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          태그: {decodedTag}
        </h1>
        <p className="text-sm text-slate-600">
          {totalCount > 0
            ? isTruncated
              ? `${totalCount}개의 ${label}이 있습니다${draftSuffix}. 상위 ${posts.length}개만 표시합니다.`
              : `${totalCount}개의 ${label}이 있습니다${draftSuffix}.`
            : `해당 태그의 ${label}이 없습니다.`}
        </p>
      </header>

      {posts.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-slate-800">빈 목록</h2>
          <p className="mt-2 text-sm text-slate-600">
            다른 태그를 선택하거나 새로운 글을 작성해 보세요.
          </p>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
          {posts.map((post) => (
            <PostCard key={post.id} post={toPostCardData(post)} />
          ))}
        </div>
      )}
    </main>
  );
}
