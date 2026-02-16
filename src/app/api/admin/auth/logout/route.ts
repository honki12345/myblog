import { NextRequest, NextResponse } from "next/server";
import {
  clearAdminSessionCookie,
  deleteAdminSessionById,
  getAdminSessionFromRequest,
  getAdminSessionIdFromRequest,
} from "@/lib/admin-auth";
import { clearCsrfCookie, verifySignedDoubleSubmitCsrf } from "@/lib/admin-csrf";

type ApiErrorCode = "UNAUTHORIZED" | "CSRF_FAILED";

function errorResponse(status: number, code: ApiErrorCode, message: string) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = getAdminSessionFromRequest(request, { touch: false });
  const sessionId = getAdminSessionIdFromRequest(request);

  if (!session || !sessionId) {
    return errorResponse(401, "UNAUTHORIZED", "Admin session is required.");
  }

  const csrf = verifySignedDoubleSubmitCsrf(request, session.id);
  if (!csrf.valid) {
    return errorResponse(403, "CSRF_FAILED", csrf.reason);
  }

  deleteAdminSessionById(sessionId);
  const response = NextResponse.json({ ok: true }, { status: 200 });
  clearAdminSessionCookie(response);
  clearCsrfCookie(response);
  return response;
}

