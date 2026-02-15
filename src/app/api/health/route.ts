import { NextResponse } from "next/server";
import { getBearerToken, verifyApiKey } from "@/lib/auth";
import { getDb } from "@/lib/db";

type ApiErrorCode = "UNAUTHORIZED" | "INTERNAL_ERROR";

function errorResponse(
  status: number,
  code: ApiErrorCode,
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

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const hasAuthorizationHeader = request.headers.get("authorization") !== null;

  if (hasAuthorizationHeader) {
    const token = getBearerToken(request);
    if (!verifyApiKey(token)) {
      return errorResponse(401, "UNAUTHORIZED", "Invalid or missing API key.");
    }
  }

  try {
    const db = getDb();
    db.prepare("SELECT 1 AS ok").get();

    if (hasAuthorizationHeader) {
      return NextResponse.json({
        status: "ok",
        db: "connected",
        auth: "valid",
      });
    }

    return NextResponse.json({ status: "ok", db: "connected" });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Health check failed.");
  }
}
