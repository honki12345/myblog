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

type ScheduleRow = {
  id: number;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  is_done: number;
  created_at: string;
  updated_at: string;
};

const patchScheduleSchema = z
  .object({
    title: z
      .string()
      .max(200, "title must be 200 characters or fewer")
      .refine((value) => value.trim().length > 0, {
        message: "title must not be empty",
      })
      .optional(),
    description: z.string().max(5_000, "description must be 5000 characters or fewer").optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).optional(),
    isDone: z.boolean().optional(),
  })
  .refine(
    (value) => {
      if (!value.startAt || !value.endAt) {
        return true;
      }
      return new Date(value.startAt).getTime() < new Date(value.endAt).getTime();
    },
    {
      message: "startAt must be earlier than endAt",
      path: ["endAt"],
    },
  )
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.startAt !== undefined ||
      value.endAt !== undefined ||
      value.isDone !== undefined,
    {
      message: "At least one field is required.",
    },
  );

function toResponseRow(row: ScheduleRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    isDone: row.is_done === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadSchedule(id: number): ScheduleRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT id, title, description, start_at, end_at, is_done, created_at, updated_at
      FROM admin_schedules
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(id) as ScheduleRow | undefined;
  return row ?? null;
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireAdminSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const scheduleId = parsePositiveIntParam(id);
  if (!scheduleId) {
    return adminErrorResponse(400, "INVALID_INPUT", "id must be a positive integer.");
  }

  const schedule = loadSchedule(scheduleId);
  if (!schedule) {
    return adminErrorResponse(404, "NOT_FOUND", "Schedule not found.");
  }

  return NextResponse.json(toResponseRow(schedule));
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireAdminSessionWithCsrf(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const scheduleId = parsePositiveIntParam(id);
  if (!scheduleId) {
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

  const parsed = patchScheduleSchema.safeParse(payload);
  if (!parsed.success) {
    return adminErrorResponse(400, "INVALID_INPUT", "Request validation failed.", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const current = loadSchedule(scheduleId);
  if (!current) {
    return adminErrorResponse(404, "NOT_FOUND", "Schedule not found.");
  }

  const nextTitle = parsed.data.title?.trim() ?? current.title;
  const nextDescription =
    parsed.data.description !== undefined
      ? parsed.data.description.trim() || null
      : current.description;
  const nextStartAt = parsed.data.startAt ?? current.start_at;
  const nextEndAt = parsed.data.endAt ?? current.end_at;
  const nextIsDone =
    parsed.data.isDone !== undefined ? (parsed.data.isDone ? 1 : 0) : current.is_done;

  if (new Date(nextStartAt).getTime() >= new Date(nextEndAt).getTime()) {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "startAt must be earlier than endAt.",
    );
  }

  const db = getDb();
  db.prepare(
    `
    UPDATE admin_schedules
    SET
      title = ?,
      description = ?,
      start_at = ?,
      end_at = ?,
      is_done = ?,
      updated_at = datetime('now')
    WHERE id = ?
    `,
  ).run(nextTitle, nextDescription, nextStartAt, nextEndAt, nextIsDone, scheduleId);

  const updated = loadSchedule(scheduleId);
  if (!updated) {
    return adminErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to load updated schedule.",
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
  const scheduleId = parsePositiveIntParam(id);
  if (!scheduleId) {
    return adminErrorResponse(400, "INVALID_INPUT", "id must be a positive integer.");
  }

  const db = getDb();
  const result = db
    .prepare("DELETE FROM admin_schedules WHERE id = ?")
    .run(scheduleId);
  if (result.changes === 0) {
    return adminErrorResponse(404, "NOT_FOUND", "Schedule not found.");
  }

  return NextResponse.json({ ok: true });
}

