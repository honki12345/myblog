import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  adminErrorResponse,
  parsePositiveIntParam,
  requireAdminSession,
  requireAdminSessionWithCsrf,
} from "@/lib/admin-api";
import { validateCommentTagPath } from "@/lib/comment-tags";
import { getDb } from "@/lib/db";
import {
  collectWikiPathsForRevalidate,
  getAdminCommentById,
  listAdminCommentsForPost,
} from "@/lib/wiki";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type PostSlugRow = {
  slug: string;
};

const createCommentSchema = z.object({
  content: z
    .string()
    .max(5_000, "content must be 5000 characters or fewer")
    .refine((value) => value.trim().length > 0, {
      message: "content is required",
    }),
  tagPath: z
    .string()
    .max(120, "tagPath must be 120 characters or fewer")
    .refine((value) => value.trim().length > 0, {
      message: "tagPath is required",
    }),
  isHidden: z.boolean().optional().default(false),
});

function parseRequestJson(request: NextRequest) {
  return request.json().catch(() => null) as Promise<unknown | null>;
}

function loadPostSlugById(postId: number): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT slug
      FROM posts
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(postId) as PostSlugRow | undefined;

  return row?.slug ?? null;
}

function revalidateCommentRelatedPaths(postSlug: string, tagPaths: string[]) {
  const paths = new Set<string>([
    `/posts/${postSlug}`,
    ...collectWikiPathsForRevalidate(tagPaths),
  ]);

  for (const path of paths) {
    revalidatePath(path);
  }
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireAdminSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const postId = parsePositiveIntParam(id);
  if (!postId) {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "id must be a positive integer.",
    );
  }

  try {
    const postSlug = loadPostSlugById(postId);
    if (!postSlug) {
      return adminErrorResponse(404, "NOT_FOUND", "Post not found.");
    }

    const items = listAdminCommentsForPost(postId);
    return NextResponse.json({ items });
  } catch {
    return adminErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to load comments.",
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = requireAdminSessionWithCsrf(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const postId = parsePositiveIntParam(id);
  if (!postId) {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "id must be a positive integer.",
    );
  }

  const payload = await parseRequestJson(request);
  if (!payload || typeof payload !== "object") {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "Request body must be valid JSON.",
    );
  }

  const parsed = createCommentSchema.safeParse(payload);
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

  const postSlug = loadPostSlugById(postId);
  if (!postSlug) {
    return adminErrorResponse(404, "NOT_FOUND", "Post not found.");
  }

  const validatedTagPath = validateCommentTagPath(parsed.data.tagPath);
  if (!validatedTagPath.valid) {
    return adminErrorResponse(400, "INVALID_INPUT", validatedTagPath.message);
  }

  const content = parsed.data.content.trim();
  const tagPath = validatedTagPath.normalizedPath;
  const isHidden = parsed.data.isHidden ? 1 : 0;

  const db = getDb();

  try {
    const createdCommentId = db.transaction(() => {
      const insertResult = db
        .prepare(
          `
          INSERT INTO post_comments (post_id, content, is_hidden)
          VALUES (?, ?, ?)
          `,
        )
        .run(postId, content, isHidden);

      const commentId = Number(insertResult.lastInsertRowid);
      db.prepare(
        `
        INSERT INTO comment_tags (comment_id, tag_path)
        VALUES (?, ?)
        `,
      ).run(commentId, tagPath);

      return commentId;
    })();

    const created = getAdminCommentById(postId, createdCommentId);
    if (!created) {
      return adminErrorResponse(
        500,
        "INTERNAL_ERROR",
        "Failed to load created comment.",
      );
    }

    revalidateCommentRelatedPaths(postSlug, [tagPath]);
    return NextResponse.json(created, { status: 201 });
  } catch {
    return adminErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to create comment.",
    );
  }
}
