import { NextRequest, NextResponse } from "next/server";
import { guestbookErrorResponse, requireGuestbookSession } from "@/lib/guestbook-api";
import {
  clearGuestbookSessionCookie,
  deleteGuestbookSessionById,
} from "@/lib/guestbook";
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

export async function GET(request: NextRequest) {
  const auth = requireGuestbookSession(request);
  if ("response" in auth) {
    return auth.response;
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
    .get(auth.session.thread_id) as ThreadRow | undefined;

  if (!thread) {
    deleteGuestbookSessionById(auth.session.id);
    const response = guestbookErrorResponse(
      404,
      "NOT_FOUND",
      "Guestbook thread not found.",
    );
    clearGuestbookSessionCookie(response);
    return response;
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
    .all(thread.id) as MessageRow[];

  return NextResponse.json({
    threadId: thread.id,
    username: thread.guest_username,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    messages: messages.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    })),
  });
}

