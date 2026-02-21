import { NextResponse } from "next/server";
import { normalizeWikiPathFromSegments } from "@/lib/comment-tags";
import { getWikiPathOverview } from "@/lib/wiki";

type ApiErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "INTERNAL_ERROR";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

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

function parseLimit(rawLimit: string | null): number | null {
  if (rawLimit === null) {
    return 100;
  }

  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(200, parsed);
}

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext) {
  const { path: rawPathSegments } = await context.params;
  const normalizedPath = normalizeWikiPathFromSegments(rawPathSegments);
  if (!normalizedPath) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "path must match ^[a-z0-9-]+(?:/[a-z0-9-]+)*$.",
    );
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  if (limit === null) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "limit must be a positive integer.",
    );
  }

  try {
    const overview = getWikiPathOverview(normalizedPath, limit);
    if (!overview) {
      return errorResponse(404, "NOT_FOUND", "Wiki path not found.");
    }

    return NextResponse.json({
      path: overview.path,
      exactCount: overview.exactCount,
      totalCount: overview.totalCount,
      truncated: overview.truncated,
      categories: overview.categories,
      comments: overview.comments,
    });
  } catch {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to load wiki path overview.",
    );
  }
}
