import { NextResponse } from "next/server";
import { normalizeWikiPathFromSegments } from "@/lib/comment-tags";
import {
  WIKI_SEARCH_LIMIT_DEFAULT,
  WIKI_SEARCH_LIMIT_MAX,
  type WikiSearchSort,
  getWikiPathOverview,
  searchWikiComments,
} from "@/lib/wiki";

type ApiErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "INTERNAL_ERROR";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

const WIKI_PATH_LIMIT_DEFAULT = 100;
const WIKI_PATH_LIMIT_MAX = 200;
const WIKI_SEARCH_QUERY_MAX_LENGTH = 120;

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

function parsePathLimit(rawLimit: string | null): number | null {
  if (rawLimit === null) {
    return WIKI_PATH_LIMIT_DEFAULT;
  }

  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(WIKI_PATH_LIMIT_MAX, parsed);
}

function parseSearchQuery(rawQuery: string | null): string | null {
  if (rawQuery === null) {
    return null;
  }

  const normalized = rawQuery.trim();
  if (normalized.length === 0) {
    return null;
  }

  if (normalized.length > WIKI_SEARCH_QUERY_MAX_LENGTH) {
    throw new Error(
      `q must be ${WIKI_SEARCH_QUERY_MAX_LENGTH} characters or fewer.`,
    );
  }

  return normalized;
}

function parseSearchLimit(rawLimit: string | null): number {
  if (rawLimit === null) {
    return WIKI_SEARCH_LIMIT_DEFAULT;
  }

  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("limit must be a positive integer.");
  }

  return Math.min(WIKI_SEARCH_LIMIT_MAX, parsed);
}

function parseSearchSort(
  rawSort: string | null,
  hasKeywordQuery: boolean,
): WikiSearchSort {
  if (rawSort === null) {
    return hasKeywordQuery ? "relevance" : "updated";
  }

  if (rawSort === "relevance" || rawSort === "updated") {
    return rawSort;
  }

  throw new Error("sort must be one of: relevance, updated.");
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
  if (url.searchParams.has("tagPath")) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "tagPath is not supported for /api/wiki/[...path].",
    );
  }

  const rawQ = url.searchParams.get("q");
  const rawSort = url.searchParams.get("sort");
  const rawLimit = url.searchParams.get("limit");

  let parsedQ: string | null;
  let parsedSort: WikiSearchSort;
  let hasSearchParams: boolean;
  let limit: number;

  try {
    parsedQ = parseSearchQuery(rawQ);
    hasSearchParams = parsedQ !== null || rawSort !== null;
    if (hasSearchParams) {
      parsedSort = parseSearchSort(rawSort, Boolean(parsedQ));
      limit = parseSearchLimit(rawLimit);
    } else {
      const parsedPathLimit = parsePathLimit(rawLimit);
      if (parsedPathLimit === null) {
        return errorResponse(
          400,
          "INVALID_INPUT",
          "limit must be a positive integer.",
        );
      }

      parsedSort = "updated";
      limit = parsedPathLimit;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid search parameters.";
    return errorResponse(400, "INVALID_INPUT", message);
  }

  try {
    if (hasSearchParams) {
      const exists = getWikiPathOverview(normalizedPath, 1);
      if (!exists) {
        return errorResponse(404, "NOT_FOUND", "Wiki path not found.");
      }

      const result = searchWikiComments({
        path: normalizedPath,
        q: parsedQ,
        sort: parsedSort,
        limit,
      });

      return NextResponse.json({
        path: normalizedPath,
        query: result.query,
        totalCount: result.totalCount,
        truncated: result.truncated,
        items: result.items,
      });
    }

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
