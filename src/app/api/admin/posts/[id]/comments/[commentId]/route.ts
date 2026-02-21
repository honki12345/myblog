import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  adminErrorResponse,
  parsePositiveIntParam,
  requireAdminSessionWithCsrf,
} from "@/lib/admin-api";
import { validateCommentTagPath } from "@/lib/comment-tags";
import { getDb } from "@/lib/db";
import { collectWikiPathsForRevalidate, getAdminCommentById } from "@/lib/wiki";

type RouteContext = {
  params: Promise<{ id: string; commentId: string }>;
};

type PostSlugRow = {
  slug: string;
};

const patchCommentSchema = z
  .object({
    content: z
      .string()
      .max(5_000, "content must be 5000 characters or fewer")
      .refine((value) => value.trim().length > 0, {
        message: "content must not be empty",
      })
      .optional(),
    tagPath: z
      .string()
      .max(120, "tagPath must be 120 characters or fewer")
      .refine((value) => value.trim().length > 0, {
        message: "tagPath must not be empty",
      })
      .optional(),
    isHidden: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.content !== undefined ||
      input.tagPath !== undefined ||
      input.isHidden !== undefined,
    { message: "At least one field is required." },
  );

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

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireAdminSessionWithCsrf(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id, commentId } = await context.params;
  const postId = parsePositiveIntParam(id);
  const normalizedCommentId = parsePositiveIntParam(commentId);

  if (!postId) {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "id must be a positive integer.",
    );
  }
  if (!normalizedCommentId) {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "commentId must be a positive integer.",
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

  const parsed = patchCommentSchema.safeParse(payload);
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

  const current = getAdminCommentById(postId, normalizedCommentId);
  if (!current) {
    return adminErrorResponse(404, "NOT_FOUND", "Comment not found.");
  }

  let nextTagPath = current.tagPath;
  if (parsed.data.tagPath !== undefined) {
    const validatedTagPath = validateCommentTagPath(parsed.data.tagPath);
    if (!validatedTagPath.valid) {
      return adminErrorResponse(400, "INVALID_INPUT", validatedTagPath.message);
    }
    nextTagPath = validatedTagPath.normalizedPath;
  }

  const nextContent = parsed.data.content?.trim() ?? current.content;
  const nextIsHidden = parsed.data.isHidden ?? current.isHidden;

  const db = getDb();

  try {
    db.transaction(() => {
      db.prepare(
        `
        UPDATE post_comments
        SET
          content = ?,
          is_hidden = ?,
          updated_at = datetime('now')
        WHERE id = ? AND post_id = ? AND deleted_at IS NULL
        `,
      ).run(nextContent, nextIsHidden ? 1 : 0, normalizedCommentId, postId);

      if (nextTagPath !== current.tagPath) {
        db.prepare(
          `
          UPDATE comment_tags
          SET tag_path = ?
          WHERE comment_id = ?
          `,
        ).run(nextTagPath, normalizedCommentId);
      }
    })();

    const updated = getAdminCommentById(postId, normalizedCommentId);
    if (!updated) {
      return adminErrorResponse(
        500,
        "INTERNAL_ERROR",
        "Failed to load updated comment.",
      );
    }

    revalidateCommentRelatedPaths(postSlug, [current.tagPath, nextTagPath]);
    return NextResponse.json(updated);
  } catch {
    return adminErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to update comment.",
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireAdminSessionWithCsrf(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id, commentId } = await context.params;
  const postId = parsePositiveIntParam(id);
  const normalizedCommentId = parsePositiveIntParam(commentId);

  if (!postId) {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "id must be a positive integer.",
    );
  }
  if (!normalizedCommentId) {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "commentId must be a positive integer.",
    );
  }

  const postSlug = loadPostSlugById(postId);
  if (!postSlug) {
    return adminErrorResponse(404, "NOT_FOUND", "Post not found.");
  }

  const current = getAdminCommentById(postId, normalizedCommentId);
  if (!current) {
    return adminErrorResponse(404, "NOT_FOUND", "Comment not found.");
  }

  const db = getDb();

  try {
    const result = db
      .prepare(
        `
        UPDATE post_comments
        SET deleted_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND post_id = ? AND deleted_at IS NULL
        `,
      )
      .run(normalizedCommentId, postId);

    if (result.changes === 0) {
      return adminErrorResponse(404, "NOT_FOUND", "Comment not found.");
    }

    revalidateCommentRelatedPaths(postSlug, [current.tagPath]);
    return NextResponse.json({ ok: true });
  } catch {
    return adminErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to delete comment.",
    );
  }
}
