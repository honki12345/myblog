import Link from "next/link";
import TagList from "@/components/TagList";
import PostCardThumbnail from "@/components/PostCardThumbnail";
import { formatDate } from "@/lib/date";

export type PostCardData = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  tags: string[];
  publishedAt: string | null;
  status: "draft" | "published";
  thumbnailUrl: string | null;
};

type PostCardProps = {
  post: PostCardData;
};

export default function PostCard({ post }: PostCardProps) {
  const publishedDate = formatDate(post.publishedAt);
  const href =
    post.status === "draft"
      ? `/admin/write?id=${post.id}`
      : `/posts/${post.slug}`;
  const thumbnailUrl = post.thumbnailUrl;
  const hasThumbnail = Boolean(thumbnailUrl);

  if (!hasThumbnail) {
    return (
      <article
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        data-post-card
      >
        <h2 className="text-lg font-semibold tracking-tight break-words">
          <Link href={href} className="hover:underline">
            {post.title}
          </Link>
        </h2>
        {publishedDate ? (
          <p className="mt-1 text-xs text-slate-500" data-post-date>
            발행일: {publishedDate}
          </p>
        ) : null}
        <p className="mt-2 text-sm break-words text-slate-600">
          {post.excerpt}
        </p>
        <div className="mt-3">
          <TagList tags={post.tags} />
        </div>
      </article>
    );
  }

  return (
    <article
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      data-post-card
      data-post-has-thumbnail
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Link href={href} className="block w-full sm:w-52 sm:shrink-0">
          <PostCardThumbnail
            src={thumbnailUrl ?? ""}
            alt={`${post.title} 썸네일`}
          />
        </Link>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight break-words">
            <Link href={href} className="hover:underline">
              {post.title}
            </Link>
          </h2>
          {publishedDate ? (
            <p className="mt-1 text-xs text-slate-500" data-post-date>
              발행일: {publishedDate}
            </p>
          ) : null}
          <p className="mt-2 text-sm break-words text-slate-600">
            {post.excerpt}
          </p>
          <div className="mt-3">
            <TagList tags={post.tags} />
          </div>
        </div>
      </div>
    </article>
  );
}
