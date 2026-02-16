import Link from "next/link";
import PostCard, { type PostCardData } from "@/components/PostCard";
import { getDb } from "@/lib/db";

type HomePostRow = {
  id: number;
  slug: string;
  title: string;
  content: string;
  published_at: string | null;
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

function toPostCardData(row: HomePostRow): PostCardData {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: createExcerpt(row.content),
    tags:
      row.tags_csv.length > 0
        ? row.tags_csv.split("\u001f").filter((tag) => tag.length > 0)
        : [],
    publishedAt: row.published_at,
  };
}

function loadLatestPublishedPosts(limit = 10): PostCardData[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT
        p.id,
        p.slug,
        p.title,
        p.content,
        p.published_at,
        COALESCE(GROUP_CONCAT(t.name, char(31)), '') AS tags_csv
      FROM posts p
      LEFT JOIN post_tags pt ON pt.post_id = p.id
      LEFT JOIN tags t ON t.id = pt.tag_id
      WHERE p.status = 'published'
      GROUP BY p.id
      ORDER BY datetime(COALESCE(p.published_at, p.created_at)) DESC, p.id DESC
      LIMIT ?
      `,
    )
    .all(limit) as HomePostRow[];

  return rows.map(toPostCardData);
}

export default function Home() {
  const posts = loadLatestPublishedPosts(10);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Latest Posts
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          최신 공개 글
        </h1>
        <p className="max-w-2xl text-sm text-slate-600 sm:text-base">
          AI 수집 글과 직접 작성한 글을 최신 순으로 보여줍니다.
        </p>
      </header>

      {posts.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-slate-800">
            아직 글이 없습니다
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            첫 글을 작성하면 이곳에 최신 글이 표시됩니다.
          </p>
          <Link
            href="/admin/write"
            className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            글 작성하기
          </Link>
        </section>
      ) : (
        <section className="grid gap-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </section>
      )}
    </main>
  );
}
