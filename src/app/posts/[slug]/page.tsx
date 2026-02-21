import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PostContent from "@/components/PostContent";
import TagList from "@/components/TagList";
import PostAdminActionsClient from "./PostAdminActionsClient";
import PostCommentsAdminClient from "./PostCommentsAdminClient";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/date";
import { createExcerpt } from "@/lib/excerpt";
import { normalizeSlugParam } from "@/lib/slug";

type PageProps = {
  params: Promise<{ slug: string }>;
};

type PostDetailRow = {
  id: number;
  title: string;
  slug: string;
  content: string;
  published_at: string | null;
  updated_at: string;
  tags_csv: string;
};

function buildLoginHref(nextPath: string): string {
  return `/admin/login?next=${encodeURIComponent(nextPath)}`;
}

function loadPublishedPostBySlug(slug: string): PostDetailRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT
        p.id,
        p.title,
        p.slug,
        p.content,
        p.published_at,
        p.updated_at,
        COALESCE(GROUP_CONCAT(t.name, char(31)), '') AS tags_csv
      FROM posts p
      LEFT JOIN post_tags pt ON pt.post_id = p.id
      LEFT JOIN tags t ON t.id = pt.tag_id
      WHERE p.slug = ? AND p.status = 'published'
      GROUP BY p.id
      LIMIT 1
      `,
    )
    .get(slug) as PostDetailRow | undefined;

  return row ?? null;
}

function createCanonicalUrl(slug: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) {
    return null;
  }

  return `${base.replace(/\/+$/, "")}/posts/${slug}`;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug: rawSlug } = await params;
  const slug = normalizeSlugParam(rawSlug);
  if (!slug) {
    return {
      title: "글을 찾을 수 없습니다",
    };
  }

  const post = loadPublishedPostBySlug(slug);

  if (!post) {
    return {
      title: "글을 찾을 수 없습니다",
    };
  }

  const canonical = createCanonicalUrl(post.slug);

  return {
    title: post.title,
    description: createExcerpt(post.content),
    alternates: canonical
      ? {
          canonical,
        }
      : undefined,
  };
}

export default async function PostDetailPage({ params }: PageProps) {
  const { slug: rawSlug } = await params;
  const slug = normalizeSlugParam(rawSlug);
  if (!slug) {
    notFound();
  }

  const adminSession = await getAdminSessionFromServerCookies();
  if (!adminSession) {
    redirect(buildLoginHref(`/posts/${encodeURIComponent(rawSlug)}`));
  }

  const post = loadPublishedPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const publishedDate = formatDate(post.published_at);
  const tags =
    post.tags_csv.length > 0
      ? post.tags_csv.split("\u001f").filter((tag) => tag.length > 0)
      : [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">{post.title}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm break-words text-slate-600">
          {publishedDate ? <span>발행일: {publishedDate}</span> : null}
          <span>slug: /posts/{post.slug}</span>
        </div>
        {tags.length > 0 ? <TagList tags={tags} /> : null}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Link
            href={`/admin/write?id=${post.id}`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            수정
          </Link>
          <PostAdminActionsClient postId={post.id} />
        </div>
      </header>
      <PostContent content={post.content} />
      <PostCommentsAdminClient postId={post.id} />
    </main>
  );
}
