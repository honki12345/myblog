import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logApiRequest, summarizeApiPayload } from "@/lib/api-log";
import { getBearerToken, verifyApiKey } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSlug, withSlugSuffix } from "@/lib/slug";

type ApiErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "DUPLICATE_SOURCE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

type PostRow = {
  id: number;
  title: string;
  slug: string;
  content: string;
  status: "draft" | "published";
  source_url: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

function optionalTrimmedString(maxLength: number, fieldName: string) {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    },
    z
      .string()
      .max(maxLength, `${fieldName} must be ${maxLength} characters or fewer`)
      .optional(),
  );
}

const createPostSchema = z.object({
  title: z
    .string()
    .max(200, "title must be 200 characters or fewer")
    .refine((value) => value.trim().length > 0, {
      message: "title is required",
    }),
  content: z
    .string()
    .max(100_000, "content must be 100000 characters or fewer")
    .refine((value) => value.trim().length > 0, {
      message: "content is required",
    }),
  tags: z
    .array(
      z
        .string()
        .max(30, "tag must be 30 characters or fewer")
        .refine((value) => value.trim().length > 0, {
          message: "tag must not be empty",
        }),
    )
    .max(10, "tags must be 10 items or fewer")
    .optional(),
  sourceUrl: z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }, z.string().url("sourceUrl must be a valid URL").max(2048, "sourceUrl must be 2048 characters or fewer").optional()),
  status: z.enum(["draft", "published"]).default("draft"),
  aiModel: optionalTrimmedString(120, "aiModel"),
  promptHint: optionalTrimmedString(1000, "promptHint"),
});

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

function parseRequestJson(request: Request) {
  return request.json().catch(() => null) as Promise<unknown | null>;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) {
    return [];
  }

  const unique = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.trim();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

function formatValidationIssues(
  error: z.ZodError,
): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function createUniqueSlug(title: string): string {
  const db = getDb();
  const baseSlug = createSlug(title);
  const statement = db.prepare("SELECT 1 FROM posts WHERE slug = ? LIMIT 1");

  for (let index = 1; index < 10_000; index += 1) {
    const candidate = withSlugSuffix(baseSlug, index);
    const exists = statement.get(candidate) as { 1: number } | undefined;
    if (!exists) {
      return candidate;
    }
  }

  throw new Error("failed to generate a unique slug");
}

function isDuplicateSourceError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const maybeCode = (error as { code?: string }).code;
  if (
    maybeCode !== "SQLITE_CONSTRAINT_UNIQUE" &&
    maybeCode !== "SQLITE_CONSTRAINT"
  ) {
    return false;
  }

  return error.message.includes("sources.url");
}

function revalidatePostRelatedPaths(slug: string, tags: string[]) {
  const paths = new Set<string>(["/", "/posts", `/posts/${slug}`]);
  for (const tag of tags) {
    paths.add(`/tags/${encodeURIComponent(tag)}`);
  }

  for (const path of paths) {
    revalidatePath(path);
  }
}

export const dynamic = "force-dynamic";

function parsePositiveIntegerEnv(
  envValue: string | undefined,
  fallback: number,
): number {
  if (!envValue) {
    return fallback;
  }

  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

const RATE_LIMIT_MAX_REQUESTS = parsePositiveIntegerEnv(
  process.env.RATE_LIMIT_MAX_REQUESTS,
  10,
);
const RATE_LIMIT_WINDOW_MS = parsePositiveIntegerEnv(
  process.env.RATE_LIMIT_WINDOW_MS,
  60_000,
);
const SINGLE_RATE_LIMIT_KEY_PREFIX = "posts:create:";

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT id, title, slug, content, status, source_url, created_at, updated_at, published_at
      FROM posts
      WHERE status = 'published'
      ORDER BY id DESC
      LIMIT 100
      `,
    )
    .all() as PostRow[];

  return NextResponse.json({ items: rows });
}

export async function POST(request: Request) {
  const route = "POST /api/posts";
  const startedAt = Date.now();
  let responseStatus = 500;
  let payloadSummary = summarizeApiPayload(null);

  const respondError = (
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: unknown,
  ) => {
    responseStatus = status;
    return errorResponse(status, code, message, details);
  };

  try {
    const token = getBearerToken(request);
    if (typeof token !== "string" || !verifyApiKey(token)) {
      return respondError(401, "UNAUTHORIZED", "Invalid or missing API key.");
    }

    const rate = checkRateLimit(
      `${SINGLE_RATE_LIMIT_KEY_PREFIX}${token}`,
      RATE_LIMIT_MAX_REQUESTS,
      RATE_LIMIT_WINDOW_MS,
    );
    if (!rate.allowed) {
      const response = respondError(
        429,
        "RATE_LIMITED",
        "Rate limit exceeded.",
        {
          retryAfterMs: rate.retryAfterMs,
        },
      );
      response.headers.set(
        "Retry-After",
        String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))),
      );
      return response;
    }

    const payload = await parseRequestJson(request);
    payloadSummary = summarizeApiPayload(payload);
    if (payload === null) {
      return respondError(
        400,
        "INVALID_INPUT",
        "Request body must be valid JSON.",
      );
    }

    const parsed = createPostSchema.safeParse(payload);
    if (!parsed.success) {
      return respondError(
        400,
        "INVALID_INPUT",
        "Request body validation failed.",
        {
          issues: formatValidationIssues(parsed.error),
        },
      );
    }

    const db = getDb();
    const input = parsed.data;
    const sourceUrl = input.sourceUrl ?? null;

    if (sourceUrl) {
      const existing = db
        .prepare("SELECT id FROM posts WHERE source_url = ? LIMIT 1")
        .get(sourceUrl) as { id: number } | undefined;
      if (existing) {
        return respondError(
          409,
          "DUPLICATE_SOURCE",
          "sourceUrl already exists.",
          {
            postId: existing.id,
          },
        );
      }
    }

    const slug = createUniqueSlug(input.title);
    const tags = normalizeTags(input.tags);

    try {
      const created = db.transaction(() => {
        const postResult = db
          .prepare(
            `
            INSERT INTO posts (title, slug, content, status, source_url, published_at)
            VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END)
            `,
          )
          .run(
            input.title.trim(),
            slug,
            input.content,
            input.status,
            sourceUrl,
            input.status,
          );

        const postId = Number(postResult.lastInsertRowid);

        for (const tag of tags) {
          db.prepare(
            "INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
          ).run(tag);
          const tagRow = db
            .prepare("SELECT id FROM tags WHERE name = ?")
            .get(tag) as { id: number } | undefined;

          if (!tagRow) {
            throw new Error(`failed to load tag id for ${tag}`);
          }

          db.prepare(
            "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
          ).run(postId, tagRow.id);
        }

        if (sourceUrl) {
          db.prepare(
            `
            INSERT INTO sources (url, post_id, ai_model, prompt_hint)
            VALUES (?, ?, ?, ?)
            `,
          ).run(
            sourceUrl,
            postId,
            input.aiModel ?? null,
            input.promptHint ?? null,
          );
        }

        return { postId };
      })();

      revalidatePostRelatedPaths(slug, tags);

      responseStatus = 201;
      return NextResponse.json({ id: created.postId, slug }, { status: 201 });
    } catch (error) {
      if (isDuplicateSourceError(error)) {
        const duplicate = db
          .prepare("SELECT id FROM posts WHERE source_url = ? LIMIT 1")
          .get(sourceUrl) as { id: number } | undefined;

        return respondError(
          409,
          "DUPLICATE_SOURCE",
          "sourceUrl already exists.",
          {
            postId: duplicate?.id ?? null,
          },
        );
      }

      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to create post.", { error });
      }

      return respondError(500, "INTERNAL_ERROR", "Failed to create post.");
    }
  } finally {
    logApiRequest({
      route,
      status: responseStatus,
      durationMs: Date.now() - startedAt,
      summary: payloadSummary,
    });
  }
}
