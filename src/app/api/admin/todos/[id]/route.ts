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

const patchTodoSchema = z
  .object({
    title: z
      .string()
      .max(200, "title must be 200 characters or fewer")
      .refine((value) => value.trim().length > 0, {
        message: "title must not be empty",
      })
      .optional(),
    description: z.string().max(5_000, "description must be 5000 characters or fewer").optional(),
    status: z.enum(["todo", "doing", "done"]).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    dueAt: z
      .string()
      .datetime({ offset: true, message: "dueAt must be ISO datetime with timezone" })
      .nullable()
      .optional(),
  })
  .refine(
    (input) =>
      input.title !== undefined ||
      input.description !== undefined ||
      input.status !== undefined ||
      input.priority !== undefined ||
      input.dueAt !== undefined,
    { message: "At least one field is required." },
  );

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

function loadTodo(id: number): TodoRow | null {
  const db = getDb();
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
  return row ?? null;
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireAdminSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const todoId = parsePositiveIntParam(id);
  if (!todoId) {
    return adminErrorResponse(400, "INVALID_INPUT", "id must be a positive integer.");
  }

  const todo = loadTodo(todoId);
  if (!todo) {
    return adminErrorResponse(404, "NOT_FOUND", "Todo not found.");
  }

  return NextResponse.json(toResponseRow(todo));
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireAdminSessionWithCsrf(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const todoId = parsePositiveIntParam(id);
  if (!todoId) {
    return adminErrorResponse(400, "INVALID_INPUT", "id must be a positive integer.");
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "Request body must be valid JSON.",
    );
  }

  const parsed = patchTodoSchema.safeParse(payload);
  if (!parsed.success) {
    return adminErrorResponse(400, "INVALID_INPUT", "Request validation failed.", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const current = loadTodo(todoId);
  if (!current) {
    return adminErrorResponse(404, "NOT_FOUND", "Todo not found.");
  }

  const nextTitle = parsed.data.title?.trim() ?? current.title;
  const nextDescription =
    parsed.data.description !== undefined
      ? parsed.data.description.trim() || null
      : current.description;
  const nextStatus = parsed.data.status ?? current.status;
  const nextPriority = parsed.data.priority ?? current.priority;
  const nextDueAt = parsed.data.dueAt !== undefined ? parsed.data.dueAt : current.due_at;

  const db = getDb();
  db.prepare(
    `
    UPDATE admin_todos
    SET
      title = ?,
      description = ?,
      status = ?,
      priority = ?,
      due_at = ?,
      completed_at = CASE
        WHEN ? = 'done' AND completed_at IS NULL THEN datetime('now')
        WHEN ? != 'done' THEN NULL
        ELSE completed_at
      END,
      updated_at = datetime('now')
    WHERE id = ?
    `,
  ).run(
    nextTitle,
    nextDescription,
    nextStatus,
    nextPriority,
    nextDueAt,
    nextStatus,
    nextStatus,
    todoId,
  );

  const updated = loadTodo(todoId);
  if (!updated) {
    return adminErrorResponse(500, "INTERNAL_ERROR", "Failed to load updated todo.");
  }

  return NextResponse.json(toResponseRow(updated));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireAdminSessionWithCsrf(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const todoId = parsePositiveIntParam(id);
  if (!todoId) {
    return adminErrorResponse(400, "INVALID_INPUT", "id must be a positive integer.");
  }

  const db = getDb();
  const result = db.prepare("DELETE FROM admin_todos WHERE id = ?").run(todoId);
  if (result.changes === 0) {
    return adminErrorResponse(404, "NOT_FOUND", "Todo not found.");
  }

  return NextResponse.json({ ok: true });
}

