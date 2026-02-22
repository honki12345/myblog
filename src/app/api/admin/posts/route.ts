import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  adminErrorResponse,
  requireAdminSession,
  requireAdminSessionWithCsrf,
} from "@/lib/admin-api";
import {
  buildWikiPathHref,
  normalizeWikiPathFromTagName,
} from "@/lib/comment-tags";
import { getDb } from "@/lib/db";
import { createSlug, withSlugSuffix } from "@/lib/slug";

type PostRow = {
  id: number;
  title: string;
  slug: string;
  content: string;
  status: "draft" | "published";
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

const createPostSchema = z.object({
  title: z
    .string()
    .max(200, "title must be 200 characters or fewer")
    .refine((value) => value.trim().length > 0, {
      message: "title is required",
    }),
  content: z
    .string()
    .max(100_000, "content must be 100000 characters or fewer")
    .refine((value) => value.trim().length > 0, {
      message: "content is required",
    }),
  tags: z
    .array(
      z
        .string()
        .max(30, "tag must be 30 characters or fewer")
        .refine((value) => value.trim().length > 0, {
          message: "tag must not be empty",
        }),
    )
    .max(10, "tags must be 10 items or fewer")
    .optional(),
  status: z.enum(["draft", "published"]).default("draft"),
});

function parseRequestJson(request: NextRequest) {
  return request.json().catch(() => null) as Promise<unknown | null>;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) {
    return [];
  }

  const unique = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.trim();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }
  return Array.from(unique);
}

function createUniqueSlug(title: string): string {
  const db = getDb();
  const baseSlug = createSlug(title);
  const statement = db.prepare("SELECT 1 FROM posts WHERE slug = ? LIMIT 1");

  for (let index = 1; index < 10_000; index += 1) {
    const candidate = withSlugSuffix(baseSlug, index);
    const exists = statement.get(candidate) as { 1: number } | undefined;
    if (!exists) {
      return candidate;
    }
  }

  throw new Error("failed to generate a unique slug");
}

function loadPostById(postId: number): PostRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT id, title, slug, content, status, created_at, updated_at, published_at
      FROM posts
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(postId) as PostRow | undefined;
  return row ?? null;
}

function loadTagsForPost(postId: number): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT t.name
      FROM tags t
      INNER JOIN post_tags pt ON pt.tag_id = t.id
      WHERE pt.post_id = ?
      ORDER BY t.name ASC
      `,
    )
    .all(postId) as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

function revalidatePostRelatedPaths(slug: string, tags: string[]) {
  const paths = new Set<string>(["/", "/wiki", "/posts", `/posts/${slug}`]);
  for (const tag of tags) {
    const wikiPath = normalizeWikiPathFromTagName(tag);
    if (wikiPath) {
      paths.add(buildWikiPathHref(wikiPath));
    }
  }

  for (const path of paths) {
    revalidatePath(path);
  }
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT id, title, slug, content, status, created_at, updated_at, published_at
      FROM posts
      ORDER BY id DESC
      LIMIT 100
      `,
    )
    .all() as PostRow[];

  return NextResponse.json({ items: rows });
}

export async function POST(request: NextRequest) {
  const auth = requireAdminSessionWithCsrf(request);
  if ("response" in auth) {
    return auth.response;
  }

  const payload = await parseRequestJson(request);
  if (payload === null) {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "Request body must be valid JSON.",
    );
  }

  const parsed = createPostSchema.safeParse(payload);
  if (!parsed.success) {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "Request body validation failed.",
      {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  }

  const db = getDb();

  try {
    const normalizedTags = normalizeTags(parsed.data.tags);
    const slug = createUniqueSlug(parsed.data.title);
    const postId = db.transaction(() => {
      const postResult = db
        .prepare(
          `
          INSERT INTO posts (title, slug, content, status, source_url, published_at)
          VALUES (?, ?, ?, ?, NULL, CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END)
          `,
        )
        .run(
          parsed.data.title.trim(),
          slug,
          parsed.data.content,
          parsed.data.status,
          parsed.data.status,
        );

      const id = Number(postResult.lastInsertRowid);
      for (const tag of normalizedTags) {
        db.prepare(
          "INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
        ).run(tag);

        const tagRow = db
          .prepare("SELECT id FROM tags WHERE name = ? LIMIT 1")
          .get(tag) as { id: number } | undefined;
        if (!tagRow) {
          throw new Error(`Failed to resolve tag id for ${tag}`);
        }

        db.prepare(
          "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
        ).run(id, tagRow.id);
      }

      return id;
    })();

    const post = loadPostById(postId);
    if (!post) {
      return adminErrorResponse(
        500,
        "INTERNAL_ERROR",
        "Failed to load created post.",
      );
    }

    const tags = loadTagsForPost(postId);
    revalidatePostRelatedPaths(post.slug, tags);

    return NextResponse.json({ ...post, tags }, { status: 201 });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to create admin post.", { error });
    }
    return adminErrorResponse(500, "INTERNAL_ERROR", "Failed to create post.");
  }
}
