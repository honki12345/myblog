import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PostContent from "@/components/PostContent";
import TagList from "@/components/TagList";
import { getDb } from "@/lib/db";

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

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[-*+]\s+/gm, " ")
    .replace(/^#{1,6}\s+/gm, " ")
    .replace(/[*_~>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createExcerpt(content: string, maxLength = 200): string {
  const plain = stripMarkdown(content);
  if (plain.length <= maxLength) {
    return plain;
  }

  return `${plain.slice(0, maxLength).trimEnd()}...`;
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

function formatDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function createCanonicalUrl(slug: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) {
    return null;
  }

  return `${base.replace(/\/+$/, "")}/posts/${slug}`;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
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
  const { slug } = await params;
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
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          {publishedDate ? <span>발행일: {publishedDate}</span> : null}
          <span>slug: /posts/{post.slug}</span>
        </div>
        {tags.length > 0 ? <TagList tags={tags} /> : null}
      </header>
      <PostContent content={post.content} />
    </main>
  );
}
