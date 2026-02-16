import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  adminErrorResponse,
  parsePositiveIntParam,
  requireAdminSession,
  requireAdminSessionWithCsrf,
} from "@/lib/admin-api";
import { getDb } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type NoteRow = {
  id: number;
  title: string;
  content: string;
  is_pinned: number;
  created_at: string;
  updated_at: string;
};

const patchNoteSchema = z
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
      .optional(),
    isPinned: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.title !== undefined ||
      input.content !== undefined ||
      input.isPinned !== undefined,
    { message: "At least one field is required." },
  );

function toResponseRow(row: NoteRow) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    isPinned: row.is_pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadNote(id: number): NoteRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT id, title, content, is_pinned, created_at, updated_at
      FROM admin_notes
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(id) as NoteRow | undefined;
  return row ?? null;
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireAdminSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const noteId = parsePositiveIntParam(id);
  if (!noteId) {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "id must be a positive integer.",
    );
  }

  const note = loadNote(noteId);
  if (!note) {
    return adminErrorResponse(404, "NOT_FOUND", "Note not found.");
  }

  return NextResponse.json(toResponseRow(note));
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireAdminSessionWithCsrf(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const noteId = parsePositiveIntParam(id);
  if (!noteId) {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "id must be a positive integer.",
    );
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "Request body must be valid JSON.",
    );
  }

  const parsed = patchNoteSchema.safeParse(payload);
  if (!parsed.success) {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "Request validation failed.",
      {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  }

  const current = loadNote(noteId);
  if (!current) {
    return adminErrorResponse(404, "NOT_FOUND", "Note not found.");
  }

  const nextTitle = parsed.data.title?.trim() ?? current.title;
  const nextContent = parsed.data.content ?? current.content;
  const nextPinned =
    parsed.data.isPinned !== undefined
      ? parsed.data.isPinned
        ? 1
        : 0
      : current.is_pinned;

  const db = getDb();
  db.prepare(
    `
    UPDATE admin_notes
    SET title = ?, content = ?, is_pinned = ?, updated_at = datetime('now')
    WHERE id = ?
    `,
  ).run(nextTitle, nextContent, nextPinned, noteId);

  const updated = loadNote(noteId);
  if (!updated) {
    return adminErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to load updated note.",
    );
  }

  return NextResponse.json(toResponseRow(updated));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireAdminSessionWithCsrf(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const noteId = parsePositiveIntParam(id);
  if (!noteId) {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "id must be a positive integer.",
    );
  }

  const db = getDb();
  const result = db.prepare("DELETE FROM admin_notes WHERE id = ?").run(noteId);
  if (result.changes === 0) {
    return adminErrorResponse(404, "NOT_FOUND", "Note not found.");
  }

  return NextResponse.json({ ok: true });
}
