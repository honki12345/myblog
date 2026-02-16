import PostCard from "@/components/PostCard";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";

type PostStatus = "draft" | "published";

type PageProps = {
  params: Promise<{ tag: string }>;
};

type TaggedPostRow = {
  id: number;
  slug: string;
  title: string;
  content: string;
  status: PostStatus;
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

function buildStatusFilter(statuses: readonly PostStatus[]): {
  clause: string;
  params: PostStatus[];
} {
  const placeholders = statuses.map(() => "?").join(", ");
  return {
    clause: `p.status IN (${placeholders})`,
    params: [...statuses],
  };
}

function loadPostsByTag(tag: string, statuses: readonly PostStatus[]) {
  const db = getDb();
  const statusFilter = buildStatusFilter(statuses);
  const rows = db
    .prepare(
      `
      SELECT
        p.id,
        p.slug,
        p.title,
        p.content,
        p.status,
        p.published_at,
        COALESCE(all_tags.tags_csv, '') AS tags_csv
      FROM posts p
      INNER JOIN post_tags pt ON pt.post_id = p.id
      INNER JOIN tags t ON t.id = pt.tag_id
      LEFT JOIN (
        SELECT
          pt2.post_id AS post_id,
          GROUP_CONCAT(t2.name, char(31)) AS tags_csv
        FROM post_tags pt2
        INNER JOIN tags t2 ON t2.id = pt2.tag_id
        GROUP BY pt2.post_id
      ) AS all_tags ON all_tags.post_id = p.id
      WHERE t.name = ? AND ${statusFilter.clause}
      ORDER BY datetime(COALESCE(p.published_at, p.created_at)) DESC, p.id DESC
      `,
    )
    .all(tag, ...statusFilter.params) as TaggedPostRow[];

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: createExcerpt(row.content),
    tags:
      row.tags_csv.length > 0
        ? row.tags_csv.split("\u001f").filter((item) => item.length > 0)
        : [],
    publishedAt: row.published_at,
    status: row.status,
  }));
}

export default async function TagPage({ params }: PageProps) {
  const { tag } = await params;
  const decodedTag = decodeURIComponent(tag);
  const session = await getAdminSessionFromServerCookies();
  const statuses: readonly PostStatus[] = session
    ? ["draft", "published"]
    : ["published"];
  const posts = loadPostsByTag(decodedTag, statuses);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          태그: {decodedTag}
        </h1>
        <p className="text-sm text-slate-600">
          {posts.length > 0
            ? `${posts.length}개의 공개 글이 있습니다.`
            : "해당 태그의 공개 글이 없습니다."}
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
        <div className="grid gap-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </main>
  );
}
