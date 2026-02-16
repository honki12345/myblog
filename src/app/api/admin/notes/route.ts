import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  adminErrorResponse,
  requireAdminSession,
  requireAdminSessionWithCsrf,
} from "@/lib/admin-api";
import { getDb } from "@/lib/db";

type NoteRow = {
  id: number;
  title: string;
  content: string;
  is_pinned: number;
  created_at: string;
  updated_at: string;
};

const createNoteSchema = z.object({
  title: z
    .string()
    .max(200, "title must be 200 characters or fewer")
    .refine((value) => value.trim().length > 0, {
      message: "title is required",
    }),
  content: z
    .string()
    .max(100_000, "content must be 100000 characters or fewer")
    .default(""),
  isPinned: z.boolean().default(false),
});

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
      SELECT id, title, content, is_pinned, created_at, updated_at
      FROM admin_notes
      ORDER BY is_pinned DESC, datetime(updated_at) DESC, id DESC
      `,
    )
    .all() as NoteRow[];

  return NextResponse.json({ items: rows.map(toResponseRow) });
}

export async function POST(request: NextRequest) {
  const auth = requireAdminSessionWithCsrf(request);
  if ("response" in auth) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "Request body must be valid JSON.",
    );
  }

  const parsed = createNoteSchema.safeParse(payload);
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

  try {
    const db = getDb();
    const result = db
      .prepare(
        `
        INSERT INTO admin_notes (title, content, is_pinned)
        VALUES (?, ?, ?)
        `,
      )
      .run(
        parsed.data.title.trim(),
        parsed.data.content,
        parsed.data.isPinned ? 1 : 0,
      );

    const id = Number(result.lastInsertRowid);
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

    if (!row) {
      return adminErrorResponse(
        500,
        "INTERNAL_ERROR",
        "Failed to load created note.",
      );
    }

    return NextResponse.json(toResponseRow(row), { status: 201 });
  } catch {
    return adminErrorResponse(500, "INTERNAL_ERROR", "Failed to create note.");
  }
}
