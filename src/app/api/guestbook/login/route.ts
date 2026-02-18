import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verify as verifyArgon2 } from "@node-rs/argon2";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  guestbookErrorResponse,
  getRateLimitIdentifier,
} from "@/lib/guestbook-api";
import {
  createGuestbookSession,
  setGuestbookSessionCookie,
} from "@/lib/guestbook";
import { getDb } from "@/lib/db";

type ThreadAuthRow = {
  id: number;
  guest_username: string;
  guest_password_hash: string;
};

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(
    `guestbook:login:${getRateLimitIdentifier(request)}`,
    10,
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

  const parsed = loginSchema.safeParse(payload);
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

  const db = getDb();
  const thread = db
    .prepare(
      `
      SELECT id, guest_username, guest_password_hash
      FROM guestbook_threads
      WHERE guest_username = ?
      LIMIT 1
      `,
    )
    .get(username) as ThreadAuthRow | undefined;

  const isValid = thread
    ? await verifyArgon2(thread.guest_password_hash, parsed.data.password)
    : false;

  if (!isValid || !thread) {
    return guestbookErrorResponse(
      401,
      "UNAUTHORIZED",
      "Invalid username or password.",
    );
  }

  const { sessionId, maxAgeSeconds } = createGuestbookSession(
    request,
    thread.id,
  );
  const response = NextResponse.json(
    { ok: true, threadId: thread.id, username: thread.guest_username },
    { status: 200 },
  );
  setGuestbookSessionCookie(response, sessionId, maxAgeSeconds);
  return response;
}
