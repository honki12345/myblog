import Link from "next/link";
import TagList from "@/components/TagList";

export type PostCardData = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  tags: string[];
  publishedAt: string | null;
};

type PostCardProps = {
  post: PostCardData;
};

export default function PostCard({ post }: PostCardProps) {
  const publishedDate = post.publishedAt
    ? new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(post.publishedAt))
    : null;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">
        <Link href={`/posts/${post.slug}`} className="hover:underline">
          {post.title}
        </Link>
      </h2>
      {publishedDate ? (
        <p className="mt-1 text-xs text-slate-500" data-post-date>
          발행일: {publishedDate}
        </p>
      ) : null}
      <p className="mt-2 text-sm text-slate-600">{post.excerpt}</p>
      <div className="mt-3">
        <TagList tags={post.tags} />
      </div>
    </article>
  );
}
