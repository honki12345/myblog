import { NextResponse } from "next/server";
import { validateCommentTagPath } from "@/lib/comment-tags";
import {
  WIKI_SEARCH_LIMIT_DEFAULT,
  WIKI_SEARCH_LIMIT_MAX,
  type WikiSearchSort,
  getWikiRootOverview,
  searchWikiComments,
} from "@/lib/wiki";

type ApiErrorCode = "INVALID_INPUT" | "INTERNAL_ERROR";
type ParsedSearchParams = {
  hasSearchParams: boolean;
  q: string | null;
  tagPath: string | null;
  limit: number;
  sort: WikiSearchSort;
};

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

function parseSearchTagPath(rawTagPath: string | null): string | null {
  if (rawTagPath === null) {
    return null;
  }

  const normalized = rawTagPath.trim();
  if (normalized.length === 0) {
    return null;
  }

  const validated = validateCommentTagPath(normalized);
  if (!validated.valid) {
    throw new Error(validated.message);
  }

  return validated.normalizedPath;
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

function parseSearchParams(requestUrl: URL): ParsedSearchParams {
  const rawQ = requestUrl.searchParams.get("q");
  const rawTagPath = requestUrl.searchParams.get("tagPath");
  const rawLimit = requestUrl.searchParams.get("limit");
  const rawSort = requestUrl.searchParams.get("sort");

  const q = parseSearchQuery(rawQ);
  const tagPath = parseSearchTagPath(rawTagPath);
  const hasSearchParams = q !== null || tagPath !== null || rawSort !== null;
  const limit = hasSearchParams
    ? parseSearchLimit(rawLimit)
    : WIKI_SEARCH_LIMIT_DEFAULT;
  const sort = parseSearchSort(rawSort, Boolean(q));

  return {
    hasSearchParams,
    q,
    tagPath,
    limit,
    sort,
  };
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let parsedSearchParams: ParsedSearchParams;
  try {
    parsedSearchParams = parseSearchParams(new URL(request.url));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid search parameters.";
    return errorResponse(400, "INVALID_INPUT", message);
  }

  try {
    if (parsedSearchParams.hasSearchParams) {
      const result = searchWikiComments({
        q: parsedSearchParams.q,
        tagPath: parsedSearchParams.tagPath,
        sort: parsedSearchParams.sort,
        limit: parsedSearchParams.limit,
      });

      return NextResponse.json({
        query: result.query,
        totalCount: result.totalCount,
        truncated: result.truncated,
        items: result.items,
      });
    }

    const overview = getWikiRootOverview();
    return NextResponse.json({
      summary: {
        totalComments: overview.totalComments,
        totalPaths: overview.totalPaths,
        totalCategories: overview.categories.length,
      },
      categories: overview.categories,
    });
  } catch {
    const message = parsedSearchParams.hasSearchParams
      ? "Failed to perform wiki search."
      : "Failed to load wiki root overview.";
    return errorResponse(500, "INTERNAL_ERROR", message);
  }
}
