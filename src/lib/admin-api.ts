import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest, type AdminSessionRow } from "@/lib/admin-auth";
import { verifySignedDoubleSubmitCsrf } from "@/lib/admin-csrf";

export type AdminApiErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CSRF_FAILED"
  | "INTERNAL_ERROR"
  | "RATE_LIMITED";

export function adminErrorResponse(
  status: number,
  code: AdminApiErrorCode,
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

export function requireAdminSession(
  request: NextRequest,
): { session: AdminSessionRow } | { response: NextResponse } {
  const session = getAdminSessionFromRequest(request);
  if (!session) {
    return {
      response: adminErrorResponse(
        401,
        "UNAUTHORIZED",
        "Admin session is required.",
      ),
    };
  }

  return { session };
}

export function requireAdminSessionWithCsrf(
  request: NextRequest,
): { session: AdminSessionRow } | { response: NextResponse } {
  const required = requireAdminSession(request);
  if ("response" in required) {
    return required;
  }

  const csrf = verifySignedDoubleSubmitCsrf(request, required.session.id);
  if (!csrf.valid) {
    return {
      response: adminErrorResponse(403, "CSRF_FAILED", csrf.reason),
    };
  }

  return required;
}

export function parsePositiveIntParam(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

