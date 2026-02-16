import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminErrorResponse, requireAdminSession, requireAdminSessionWithCsrf } from "@/lib/admin-api";
import { getDb } from "@/lib/db";

type TodoStatus = "todo" | "doing" | "done";
type TodoPriority = "low" | "medium" | "high";

type TodoRow = {
  id: number;
  title: string;
  description: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const createTodoSchema = z.object({
  title: z
    .string()
    .max(200, "title must be 200 characters or fewer")
    .refine((value) => value.trim().length > 0, {
      message: "title is required",
    }),
  description: z
    .string()
    .max(5_000, "description must be 5000 characters or fewer")
    .optional(),
  status: z.enum(["todo", "doing", "done"]).default("todo"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  dueAt: z
    .string()
    .datetime({ offset: true, message: "dueAt must be ISO datetime with timezone" })
    .optional(),
});

function toResponseRow(row: TodoRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at,
    completedAt: row.completed_at,
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
      SELECT
        id,
        title,
        description,
        status,
        priority,
        due_at,
        completed_at,
        created_at,
        updated_at
      FROM admin_todos
      ORDER BY
        CASE status WHEN 'doing' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END ASC,
        CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
        datetime(COALESCE(due_at, '9999-12-31T23:59:59Z')) ASC,
        id DESC
      `,
    )
    .all() as TodoRow[];

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

  const parsed = createTodoSchema.safeParse(payload);
  if (!parsed.success) {
    return adminErrorResponse(400, "INVALID_INPUT", "Request validation failed.", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const db = getDb();

  try {
    const result = db
      .prepare(
        `
        INSERT INTO admin_todos (title, description, status, priority, due_at, completed_at)
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          CASE WHEN ? = 'done' THEN datetime('now') ELSE NULL END
        )
        `,
      )
      .run(
        parsed.data.title.trim(),
        parsed.data.description?.trim() || null,
        parsed.data.status,
        parsed.data.priority,
        parsed.data.dueAt ?? null,
        parsed.data.status,
      );

    const id = Number(result.lastInsertRowid);
    const row = db
      .prepare(
        `
        SELECT
          id,
          title,
          description,
          status,
          priority,
          due_at,
          completed_at,
          created_at,
          updated_at
        FROM admin_todos
        WHERE id = ?
        LIMIT 1
        `,
      )
      .get(id) as TodoRow | undefined;

    if (!row) {
      return adminErrorResponse(500, "INTERNAL_ERROR", "Failed to load created todo.");
    }

    return NextResponse.json(toResponseRow(row), { status: 201 });
  } catch {
    return adminErrorResponse(500, "INTERNAL_ERROR", "Failed to create todo.");
  }
}

