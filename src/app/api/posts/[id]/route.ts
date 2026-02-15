import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getBearerToken, verifyApiKey } from "@/lib/auth";
import { getDb } from "@/lib/db";

type ApiErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type PostRow = {
  id: number;
  title: string;
  slug: string;
  content: string;
  status: "draft" | "published";
  source_url: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

const patchPostSchema = z
  .object({
    title: z
      .string()
      .max(200, "title must be 200 characters or fewer")
      .refine((value) => value.trim().length > 0, {
        message: "title must not be empty",
      })
      .optional(),
    content: z
      .string()
      .max(100_000, "content must be 100000 characters or fewer")
      .refine((value) => value.trim().length > 0, {
        message: "content must not be empty",
      })
      .optional(),
    status: z.enum(["draft", "published"]).optional(),
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
  })
  .refine(
    (input) =>
      input.title !== undefined ||
      input.content !== undefined ||
      input.status !== undefined ||
      input.tags !== undefined,
    {
      message: "At least one field is required.",
    },
  );

function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details: details ?? null,
      },
    },
    { status },
  );
}

function parsePostId(rawId: string): number | null {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) {
    return undefined;
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

function loadPostById(postId: number): PostRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT id, title, slug, content, status, source_url, created_at, updated_at, published_at
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

function parseRequestJson(request: Request) {
  return request.json().catch(() => null) as Promise<Record<
    string,
    unknown
  > | null>;
}

function validateApiKey(request: Request): NextResponse | null {
  const token = getBearerToken(request);
  if (!verifyApiKey(token)) {
    return errorResponse(401, "UNAUTHORIZED", "Invalid or missing API key.");
  }

  return null;
}

function revalidatePostRelatedPaths(slug: string, tags: string[]) {
  const paths = new Set<string>(["/", "/posts", `/posts/${slug}`]);
  for (const tag of tags) {
    paths.add(`/tags/${encodeURIComponent(tag)}`);
  }

  for (const path of paths) {
    revalidatePath(path);
  }
}

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext) {
  const authError = validateApiKey(request);
  if (authError) {
    return authError;
  }

  const { id } = await context.params;
  const postId = parsePostId(id);
  if (!postId) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "id must be a positive integer.",
    );
  }

  try {
    const post = loadPostById(postId);
    if (!post) {
      return errorResponse(404, "NOT_FOUND", "Post not found.");
    }

    const tags = loadTagsForPost(postId);
    return NextResponse.json({ ...post, tags });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to load post.");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const authError = validateApiKey(request);
  if (authError) {
    return authError;
  }

  const { id } = await context.params;
  const postId = parsePostId(id);
  if (!postId) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "id must be a positive integer.",
    );
  }

  const payload = await parseRequestJson(request);
  if (!payload) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Request body must be valid JSON.",
    );
  }

  const parsed = patchPostSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(
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
    const current = loadPostById(postId);
    if (!current) {
      return errorResponse(404, "NOT_FOUND", "Post not found.");
    }
    const currentTags = loadTagsForPost(postId);

    const nextTitle = parsed.data.title?.trim() ?? current.title;
    const nextContent = parsed.data.content ?? current.content;
    const nextStatus = parsed.data.status ?? current.status;
    const nextTags = normalizeTags(parsed.data.tags);

    db.transaction(() => {
      db.prepare(
        `
        UPDATE posts
        SET
          title = ?,
          content = ?,
          status = ?,
          published_at = CASE
            WHEN ? = 'published' AND published_at IS NULL THEN datetime('now')
            ELSE published_at
          END,
          updated_at = datetime('now')
        WHERE id = ?
        `,
      ).run(nextTitle, nextContent, nextStatus, nextStatus, postId);

      if (nextTags !== undefined) {
        db.prepare("DELETE FROM post_tags WHERE post_id = ?").run(postId);

        for (const tag of nextTags) {
          db.prepare(
            "INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
          ).run(tag);

          const tagRow = db
            .prepare("SELECT id FROM tags WHERE name = ?")
            .get(tag) as { id: number } | undefined;

          if (!tagRow) {
            throw new Error(`failed to load tag id for ${tag}`);
          }

          db.prepare(
            "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
          ).run(postId, tagRow.id);
        }
      }
    })();

    const updatedPost = loadPostById(postId);
    if (!updatedPost) {
      return errorResponse(
        500,
        "INTERNAL_ERROR",
        "Failed to load updated post.",
      );
    }

    const tags = loadTagsForPost(postId);
    const tagsToRevalidate = new Set<string>([...currentTags, ...tags]);
    revalidatePostRelatedPaths(updatedPost.slug, Array.from(tagsToRevalidate));

    return NextResponse.json({ ...updatedPost, tags });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to update post.", { error, postId, payload });
    }

    return errorResponse(500, "INTERNAL_ERROR", "Failed to update post.");
  }
}
