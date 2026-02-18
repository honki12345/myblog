import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  adminErrorResponse,
  parsePositiveIntParam,
  requireAdminSessionWithCsrf,
} from "@/lib/admin-api";
import { getDb } from "@/lib/db";

type MessageRow = {
  id: number;
  role: "guest" | "admin";
  content: string;
  created_at: string;
};

const createMessageSchema = z.object({
  content: z.string().max(5_000),
});

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireAdminSessionWithCsrf(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const threadId = parsePositiveIntParam(id);
  if (!threadId) {
    return adminErrorResponse(400, "INVALID_INPUT", "Invalid thread id.");
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "Request body must be valid JSON.",
    );
  }

  const parsed = createMessageSchema.safeParse(payload);
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

  const content = parsed.data.content.trim();
  if (!content) {
    return adminErrorResponse(400, "INVALID_INPUT", "content is required.");
  }

  const db = getDb();
  const exists = db
    .prepare("SELECT 1 AS ok FROM guestbook_threads WHERE id = ? LIMIT 1")
    .get(threadId) as { ok: number } | undefined;
  if (!exists) {
    return adminErrorResponse(404, "NOT_FOUND", "Thread not found.");
  }

  let messageId: number;
  try {
    const inserted = db
      .prepare(
        `
        INSERT INTO guestbook_messages (thread_id, role, content)
        VALUES (?, 'admin', ?)
        `,
      )
      .run(threadId, content);
    messageId = Number(inserted.lastInsertRowid);
  } catch {
    return adminErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to create message.",
    );
  }

  const row = db
    .prepare(
      `
      SELECT id, role, content, created_at
      FROM guestbook_messages
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(messageId) as MessageRow | undefined;

  if (!row) {
    return adminErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to load created message.",
    );
  }

  return NextResponse.json(
    {
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    },
    { status: 201 },
  );
}

