import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminErrorResponse, requireAdminSession, requireAdminSessionWithCsrf } from "@/lib/admin-api";
import { getDb } from "@/lib/db";

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

const createScheduleSchema = z
  .object({
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
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    isDone: z.boolean().default(false),
  })
  .refine((value) => new Date(value.startAt).getTime() < new Date(value.endAt).getTime(), {
    message: "startAt must be earlier than endAt",
    path: ["endAt"],
  });

const querySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (value) => {
      if (!value.from || !value.to) {
        return true;
      }
      return new Date(value.from).getTime() <= new Date(value.to).getTime();
    },
    {
      message: "from must be earlier than or equal to to",
      path: ["to"],
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

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  const parsedQuery = querySchema.safeParse({
    from: request.nextUrl.searchParams.get("from") ?? undefined,
    to: request.nextUrl.searchParams.get("to") ?? undefined,
  });
  if (!parsedQuery.success) {
    return adminErrorResponse(400, "INVALID_INPUT", "Invalid query parameter.", {
      issues: parsedQuery.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const db = getDb();
  const where: string[] = [];
  const values: Array<string> = [];

  if (parsedQuery.data.from) {
    where.push("datetime(end_at) >= datetime(?)");
    values.push(parsedQuery.data.from);
  }
  if (parsedQuery.data.to) {
    where.push("datetime(start_at) <= datetime(?)");
    values.push(parsedQuery.data.to);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `
      SELECT id, title, description, start_at, end_at, is_done, created_at, updated_at
      FROM admin_schedules
      ${whereClause}
      ORDER BY datetime(start_at) ASC, id ASC
      `,
    )
    .all(...values) as ScheduleRow[];

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

  const parsed = createScheduleSchema.safeParse(payload);
  if (!parsed.success) {
    return adminErrorResponse(400, "INVALID_INPUT", "Request validation failed.", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  try {
    const db = getDb();
    const result = db
      .prepare(
        `
        INSERT INTO admin_schedules (title, description, start_at, end_at, is_done)
        VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        parsed.data.title.trim(),
        parsed.data.description?.trim() || null,
        parsed.data.startAt,
        parsed.data.endAt,
        parsed.data.isDone ? 1 : 0,
      );

    const id = Number(result.lastInsertRowid);
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

    if (!row) {
      return adminErrorResponse(
        500,
        "INTERNAL_ERROR",
        "Failed to load created schedule.",
      );
    }

    return NextResponse.json(toResponseRow(row), { status: 201 });
  } catch {
    return adminErrorResponse(500, "INTERNAL_ERROR", "Failed to create schedule.");
  }
}

