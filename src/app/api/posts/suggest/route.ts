import { NextResponse } from "next/server";
import { getAdminSessionFromRequest } from "@/lib/admin-auth";
import { isFtsQuerySyntaxError } from "@/lib/fts";
import { getDb } from "@/lib/db";
import {
  MAX_SEARCH_QUERY_LENGTH,
  POSTS_SUGGEST_LIMIT,
  POSTS_SUGGEST_MIN_QUERY_LENGTH,
} from "@/lib/posts-search";

type ApiErrorCode = "INTERNAL_ERROR";

type PostStatus = "draft" | "published";

type SuggestRow = {
  id: number;
  slug: string;
  title: string;
  status: PostStatus;
  published_at: string | null;
};

type SuggestItem = {
  id: number;
  slug: string;
  title: string;
  status: PostStatus;
  publishedAt: string | null;
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

function normalizeQuery(raw: string | null): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.length > MAX_SEARCH_QUERY_LENGTH
    ? trimmed.slice(0, MAX_SEARCH_QUERY_LENGTH)
    : trimmed;
}

function buildSuggestFtsQuery(input: string): string | null {
  const tokens: string[] = [];
  for (const rawToken of input.split(/\s+/)) {
    const normalized = rawToken.trim();
    if (!normalized) {
      continue;
    }

    const matches = normalized.match(/[\p{L}\p{N}]+/gu);
    if (!matches) {
      continue;
    }

    for (const value of matches) {
      if (value.length > 0) {
        tokens.push(value);
      }
    }
  }

  if (tokens.length === 0) {
    return null;
  }

  tokens[tokens.length - 1] = `${tokens[tokens.length - 1]}*`;
  return tokens.join(" ");
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const rawQ = requestUrl.searchParams.get("q");
  const normalizedQ = normalizeQuery(rawQ);

  if (
    !normalizedQ ||
    normalizedQ.length < POSTS_SUGGEST_MIN_QUERY_LENGTH ||
    normalizedQ.trim().length === 0
  ) {
    return NextResponse.json({
      items: [],
      meta: { q: normalizedQ ?? "", truncated: false },
    });
  }

  const ftsQuery = buildSuggestFtsQuery(normalizedQ);
  if (!ftsQuery) {
    return NextResponse.json({
      items: [],
      meta: { q: normalizedQ, truncated: false },
    });
  }

  const session = getAdminSessionFromRequest(request, { touch: false });
  const statuses: readonly PostStatus[] = session
    ? ["draft", "published"]
    : ["published"];

  const statusPlaceholders = statuses.map(() => "?").join(", ");
  const limit = POSTS_SUGGEST_LIMIT;

  try {
    const db = getDb();
    const rows = db
      .prepare(
        `
        SELECT
          p.id,
          p.slug,
          p.title,
          p.status,
          p.published_at
        FROM posts p
        INNER JOIN posts_fts ON posts_fts.rowid = p.id
        WHERE p.status IN (${statusPlaceholders}) AND posts_fts MATCH ?
        ORDER BY
          bm25(posts_fts, 5.0, 1.0) ASC,
          datetime(COALESCE(p.published_at, p.created_at)) DESC,
          p.id DESC
        LIMIT ?
        `,
      )
      .all(...statuses, ftsQuery, limit + 1) as SuggestRow[];

    const truncated = rows.length > limit;
    const items: SuggestItem[] = rows.slice(0, limit).map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      publishedAt: row.published_at,
    }));

    return NextResponse.json({
      items,
      meta: { q: normalizedQ, truncated },
    });
  } catch (error) {
    if (isFtsQuerySyntaxError(error)) {
      return NextResponse.json({
        items: [],
        meta: { q: normalizedQ, truncated: false },
      });
    }

    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to suggest posts.", {
        error,
        q: normalizedQ,
      });
    }

    return errorResponse(500, "INTERNAL_ERROR", "Failed to suggest posts.");
  }
}

