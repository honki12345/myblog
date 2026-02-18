import { NextRequest, NextResponse } from "next/server";
import {
  getGuestbookSessionFromRequest,
  type GuestbookSessionRow,
} from "@/lib/guestbook";

export type GuestbookApiErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "RATE_LIMITED";

export function guestbookErrorResponse(
  status: number,
  code: GuestbookApiErrorCode,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details: details ?? null,
      },
    },
    { status },
  );
}

export function requireGuestbookSession(
  request: NextRequest,
): { session: GuestbookSessionRow } | { response: NextResponse } {
  const session = getGuestbookSessionFromRequest(request);
  if (!session) {
    return {
      response: guestbookErrorResponse(
        401,
        "UNAUTHORIZED",
        "Guestbook session is required.",
      ),
    };
  }

  return { session };
}

export function getRateLimitIdentifier(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}
