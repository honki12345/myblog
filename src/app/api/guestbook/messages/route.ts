import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  guestbookErrorResponse,
  getRateLimitIdentifier,
  requireGuestbookSession,
} from "@/lib/guestbook-api";
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

export async function POST(request: NextRequest) {
  const auth = requireGuestbookSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  const rate = checkRateLimit(
    `guestbook:messages:${getRateLimitIdentifier(request)}:${auth.session.thread_id}`,
    30,
    10 * 60 * 1000,
  );
  if (!rate.allowed) {
    const response = guestbookErrorResponse(
      429,
      "RATE_LIMITED",
      "Rate limit exceeded.",
      { retryAfterMs: rate.retryAfterMs },
    );
    response.headers.set(
      "Retry-After",
      String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))),
    );
    return response;
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return guestbookErrorResponse(
      400,
      "INVALID_INPUT",
      "Request body must be valid JSON object.",
    );
  }

  const parsed = createMessageSchema.safeParse(payload);
  if (!parsed.success) {
    return guestbookErrorResponse(
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
    return guestbookErrorResponse(400, "INVALID_INPUT", "content is required.");
  }

  const db = getDb();
  let messageId: number;
  try {
    const result = db
      .prepare(
        `
        INSERT INTO guestbook_messages (thread_id, role, content)
        VALUES (?, 'guest', ?)
        `,
      )
      .run(auth.session.thread_id, content);
    messageId = Number(result.lastInsertRowid);
  } catch {
    return guestbookErrorResponse(
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
    return guestbookErrorResponse(
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

