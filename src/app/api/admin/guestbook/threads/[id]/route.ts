import { NextRequest, NextResponse } from "next/server";
import {
  adminErrorResponse,
  parsePositiveIntParam,
  requireAdminSession,
} from "@/lib/admin-api";
import { getDb } from "@/lib/db";

type ThreadRow = {
  id: number;
  guest_username: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: number;
  role: "guest" | "admin";
  content: string;
  created_at: string;
};

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireAdminSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const threadId = parsePositiveIntParam(id);
  if (!threadId) {
    return adminErrorResponse(400, "INVALID_INPUT", "Invalid thread id.");
  }

  const db = getDb();
  const thread = db
    .prepare(
      `
      SELECT id, guest_username, created_at, updated_at
      FROM guestbook_threads
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(threadId) as ThreadRow | undefined;

  if (!thread) {
    return adminErrorResponse(404, "NOT_FOUND", "Thread not found.");
  }

  const messages = db
    .prepare(
      `
      SELECT id, role, content, created_at
      FROM guestbook_messages
      WHERE thread_id = ?
      ORDER BY id ASC
      `,
    )
    .all(threadId) as MessageRow[];

  return NextResponse.json({
    thread: {
      id: thread.id,
      guestUsername: thread.guest_username,
      createdAt: thread.created_at,
      updatedAt: thread.updated_at,
    },
    messages: messages.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    })),
  });
}
