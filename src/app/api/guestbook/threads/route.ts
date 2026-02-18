import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hash as hashArgon2 } from "@node-rs/argon2";
import { checkRateLimit } from "@/lib/rate-limit";
import { guestbookErrorResponse, getRateLimitIdentifier } from "@/lib/guestbook-api";
import {
  createGuestbookSession,
  setGuestbookSessionCookie,
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

const createThreadSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8).max(64),
  content: z.string().max(5_000),
});

function isSqliteConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      (error as { code: string }).code.startsWith("SQLITE_CONSTRAINT"),
  );
}

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(
    `guestbook:threads:${getRateLimitIdentifier(request)}`,
    3,
    60 * 60 * 1000,
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

  const parsed = createThreadSchema.safeParse(payload);
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

  const username = parsed.data.username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return guestbookErrorResponse(
      400,
      "INVALID_INPUT",
      "username must be 3-20 chars and match /^[a-z0-9_]+$/ (lowercase).",
    );
  }

  const content = parsed.data.content.trim();
  if (!content) {
    return guestbookErrorResponse(400, "INVALID_INPUT", "content is required.");
  }

  let passwordHash: string;
  try {
    passwordHash = await hashArgon2(parsed.data.password, {
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  } catch {
    return guestbookErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to hash password.",
    );
  }

  const db = getDb();
  let threadId: number;

  try {
    threadId = db.transaction(() => {
      const inserted = db
        .prepare(
          `
          INSERT INTO guestbook_threads (guest_username, guest_password_hash)
          VALUES (?, ?)
          `,
        )
        .run(username, passwordHash);

      const createdThreadId = Number(inserted.lastInsertRowid);
      db.prepare(
        `
        INSERT INTO guestbook_messages (thread_id, role, content)
        VALUES (?, 'guest', ?)
        `,
      ).run(createdThreadId, content);

      return createdThreadId;
    })();
  } catch (error) {
    if (isSqliteConstraintError(error)) {
      return guestbookErrorResponse(
        409,
        "CONFLICT",
        "Username is already taken.",
      );
    }
    return guestbookErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to create guestbook thread.",
    );
  }

  const { sessionId, maxAgeSeconds } = createGuestbookSession(request, threadId);

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

  const response = NextResponse.json(
    {
      threadId: thread?.id ?? threadId,
      username: thread?.guest_username ?? username,
      createdAt: thread?.created_at ?? null,
      updatedAt: thread?.updated_at ?? null,
      messages: messages.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
      })),
    },
    { status: 201 },
  );

  setGuestbookSessionCookie(response, sessionId, maxAgeSeconds);
  return response;
}
