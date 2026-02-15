import { NextResponse } from "next/server";
import { z } from "zod";
import { getBearerToken, verifyApiKey } from "@/lib/auth";
import { getDb } from "@/lib/db";

type ApiErrorCode = "INVALID_INPUT" | "UNAUTHORIZED" | "INTERNAL_ERROR";

const querySchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().url("url must be a valid URL").max(2048));

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
  const token = getBearerToken(request);
  if (!verifyApiKey(token)) {
    return errorResponse(401, "UNAUTHORIZED", "Invalid or missing API key.");
  }

  const requestUrl = new URL(request.url);
  const rawUrl = requestUrl.searchParams.get("url");

  if (!rawUrl) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter url is required.",
    );
  }

  const parsed = querySchema.safeParse(rawUrl);
  if (!parsed.success) {
    return errorResponse(400, "INVALID_INPUT", "Invalid url query parameter.", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  try {
    const db = getDb();
    const existing = db
      .prepare("SELECT id FROM posts WHERE source_url = ? LIMIT 1")
      .get(parsed.data) as { id: number } | undefined;

    if (existing) {
      return NextResponse.json({ exists: true, postId: existing.id });
    }

    return NextResponse.json({ exists: false });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to check source URL.");
  }
}
