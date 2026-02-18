import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-api";
import { getDb } from "@/lib/db";

type ThreadListRow = {
  id: number;
  guest_username: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_at: string | null;
  last_role: "guest" | "admin" | null;
  last_content: string | null;
};

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
        t.id,
        t.guest_username,
        t.created_at,
        t.updated_at,
        (
          SELECT COUNT(1)
          FROM guestbook_messages m
          WHERE m.thread_id = t.id
        ) AS message_count,
        (
          SELECT m.created_at
          FROM guestbook_messages m
          WHERE m.thread_id = t.id
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_message_at,
        (
          SELECT m.role
          FROM guestbook_messages m
          WHERE m.thread_id = t.id
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_role,
        (
          SELECT m.content
          FROM guestbook_messages m
          WHERE m.thread_id = t.id
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_content
      FROM guestbook_threads t
      ORDER BY datetime(t.updated_at) DESC, t.id DESC
      LIMIT 200
      `,
    )
    .all() as ThreadListRow[];

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      guestUsername: row.guest_username,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      lastMessageAt: row.last_message_at,
      lastMessageRole: row.last_role,
      lastMessagePreview: row.last_content
        ? row.last_content.slice(0, 200)
        : null,
    })),
  });
}
