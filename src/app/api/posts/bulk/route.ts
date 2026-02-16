import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logApiRequest, summarizeApiPayload } from "@/lib/api-log";
import { getBearerToken, verifyApiKey } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSlug, withSlugSuffix } from "@/lib/slug";

type BulkErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "DUPLICATE_SOURCE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

type BulkCreateItem = {
  id: number;
  slug: string;
};

type BulkErrorItem = {
  index: number;
  message: string;
};

class IndexedBulkError extends Error {
  index: number;
  cause: unknown;

  constructor(index: number, message: string, cause: unknown) {
    super(message);
    this.index = index;
    this.cause = cause;
  }
}

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

const bulkPostSchema = z.object({
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

const createBulkPostsSchema = z.object({
  posts: z
    .array(bulkPostSchema)
    .min(1, "posts must contain at least one item")
    .max(10, "posts must be 10 items or fewer"),
});

type BulkPostInput = z.infer<typeof bulkPostSchema>;

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

function formatValidationErrors(error: z.ZodError): BulkErrorItem[] {
  const issues = error.issues.map((issue) => {
    const maybeIndex =
      issue.path[0] === "posts" && typeof issue.path[1] === "number"
        ? issue.path[1]
        : -1;
    const path = issue.path.join(".");
    const message = path ? `${path}: ${issue.message}` : issue.message;

    return {
      index: maybeIndex,
      message,
    };
  });

  return issues.length > 0
    ? issues
    : [{ index: -1, message: "Request body validation failed." }];
}

function collectSourceUrlByIndex(posts: BulkPostInput[]): Map<number, string> {
  const mapping = new Map<number, string>();

  for (const [index, post] of posts.entries()) {
    if (!post.sourceUrl) {
      continue;
    }
    mapping.set(index, post.sourceUrl);
  }

  return mapping;
}

function findDuplicateSourceInRequest(
  sourceUrlByIndex: Map<number, string>,
): BulkErrorItem[] {
  const seen = new Map<string, number>();
  const duplicates: BulkErrorItem[] = [];

  for (const [index, sourceUrl] of sourceUrlByIndex.entries()) {
    const existing = seen.get(sourceUrl);
    if (existing === undefined) {
      seen.set(sourceUrl, index);
      continue;
    }

    duplicates.push({
      index,
      message: `sourceUrl duplicates request index ${existing}.`,
    });
  }

  return duplicates;
}

function findExistingSourceConflicts(
  sourceUrlByIndex: Map<number, string>,
): BulkErrorItem[] {
  const sourceUrls = Array.from(new Set(sourceUrlByIndex.values()));
  if (sourceUrls.length === 0) {
    return [];
  }

  const db = getDb();
  const placeholders = sourceUrls.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
      SELECT source_url AS url FROM posts WHERE source_url IN (${placeholders})
      UNION
      SELECT url FROM sources WHERE url IN (${placeholders})
      `,
    )
    .all(...sourceUrls, ...sourceUrls) as Array<{ url: string | null }>;

  const existingUrls = new Set(
    rows
      .map((row) => row.url)
      .filter((row): row is string => typeof row === "string"),
  );

  const errors: BulkErrorItem[] = [];
  for (const [index, sourceUrl] of sourceUrlByIndex.entries()) {
    if (existingUrls.has(sourceUrl)) {
      errors.push({ index, message: "sourceUrl already exists." });
    }
  }

  return errors;
}

function revalidateBulkPostPaths(
  created: Array<{ slug: string; tags: string[] }>,
): void {
  const paths = new Set<string>(["/", "/posts"]);

  for (const item of created) {
    paths.add(`/posts/${item.slug}`);

    for (const tag of item.tags) {
      paths.add(`/tags/${encodeURIComponent(tag)}`);
    }
  }

  for (const path of paths) {
    revalidatePath(path);
  }
}

function bulkErrorResponse(
  status: number,
  code: BulkErrorCode,
  errors: BulkErrorItem[],
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    {
      created: [],
      errors,
      code,
      ...(details ?? {}),
    },
    { status },
  );
}

function bulkSuccessResponse(created: BulkCreateItem[]) {
  return NextResponse.json(
    {
      created,
      errors: [],
    },
    { status: 201 },
  );
}

export const dynamic = "force-dynamic";

const BULK_RATE_LIMIT_MAX_REQUESTS = parsePositiveIntegerEnv(
  process.env.RATE_LIMIT_BULK_MAX_REQUESTS,
  3,
);
const BULK_RATE_LIMIT_WINDOW_MS = parsePositiveIntegerEnv(
  process.env.RATE_LIMIT_BULK_WINDOW_MS,
  60_000,
);
const BULK_RATE_LIMIT_KEY_PREFIX = "posts:bulk:";

export async function POST(request: Request) {
  const route = "POST /api/posts/bulk";
  const startedAt = Date.now();
  let responseStatus = 500;
  let payloadSummary = summarizeApiPayload(null);

  const respondError = (
    status: number,
    code: BulkErrorCode,
    errors: BulkErrorItem[],
    details?: Record<string, unknown>,
  ) => {
    responseStatus = status;
    return bulkErrorResponse(status, code, errors, details);
  };

  try {
    const token = getBearerToken(request);
    if (typeof token !== "string" || !verifyApiKey(token)) {
      return respondError(401, "UNAUTHORIZED", [
        { index: -1, message: "Invalid or missing API key." },
      ]);
    }

    const rate = checkRateLimit(
      `${BULK_RATE_LIMIT_KEY_PREFIX}${token}`,
      BULK_RATE_LIMIT_MAX_REQUESTS,
      BULK_RATE_LIMIT_WINDOW_MS,
    );
    if (!rate.allowed) {
      const response = respondError(
        429,
        "RATE_LIMITED",
        [{ index: -1, message: "Rate limit exceeded." }],
        { retryAfterMs: rate.retryAfterMs },
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
      return respondError(400, "INVALID_INPUT", [
        { index: -1, message: "Request body must be valid JSON." },
      ]);
    }

    const parsed = createBulkPostsSchema.safeParse(payload);
    if (!parsed.success) {
      return respondError(
        400,
        "INVALID_INPUT",
        formatValidationErrors(parsed.error),
      );
    }

    const input = parsed.data;
    const sourceUrlByIndex = collectSourceUrlByIndex(input.posts);

    const duplicateInRequest = findDuplicateSourceInRequest(sourceUrlByIndex);
    if (duplicateInRequest.length > 0) {
      return respondError(409, "DUPLICATE_SOURCE", duplicateInRequest);
    }

    const existingSourceErrors = findExistingSourceConflicts(sourceUrlByIndex);
    if (existingSourceErrors.length > 0) {
      return respondError(409, "DUPLICATE_SOURCE", existingSourceErrors);
    }

    const db = getDb();

    try {
      const created = db.transaction(() => {
        const insertPostStatement = db.prepare(
          `
          INSERT INTO posts (title, slug, content, status, source_url, published_at)
          VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END)
          `,
        );
        const insertTagStatement = db.prepare(
          "INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
        );
        const selectTagStatement = db.prepare(
          "SELECT id FROM tags WHERE name = ?",
        );
        const insertPostTagStatement = db.prepare(
          "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
        );
        const insertSourceStatement = db.prepare(
          `
          INSERT INTO sources (url, post_id, ai_model, prompt_hint)
          VALUES (?, ?, ?, ?)
          `,
        );

        const results: Array<{ id: number; slug: string; tags: string[] }> = [];

        for (const [index, post] of input.posts.entries()) {
          try {
            const slug = createUniqueSlug(post.title);
            const tags = normalizeTags(post.tags);

            const postResult = insertPostStatement.run(
              post.title.trim(),
              slug,
              post.content,
              post.status,
              post.sourceUrl ?? null,
              post.status,
            );
            const postId = Number(postResult.lastInsertRowid);

            for (const tag of tags) {
              insertTagStatement.run(tag);
              const tagRow = selectTagStatement.get(tag) as
                | { id: number }
                | undefined;
              if (!tagRow) {
                throw new Error(`failed to load tag id for ${tag}`);
              }
              insertPostTagStatement.run(postId, tagRow.id);
            }

            if (post.sourceUrl) {
              insertSourceStatement.run(
                post.sourceUrl,
                postId,
                post.aiModel ?? null,
                post.promptHint ?? null,
              );
            }

            results.push({ id: postId, slug, tags });
          } catch (error) {
            throw new IndexedBulkError(
              index,
              "Failed to insert bulk post.",
              error,
            );
          }
        }

        return results;
      })();

      revalidateBulkPostPaths(created);

      responseStatus = 201;
      return bulkSuccessResponse(
        created.map((item) => ({ id: item.id, slug: item.slug })),
      );
    } catch (error) {
      const duplicateIndex =
        error instanceof IndexedBulkError && isDuplicateSourceError(error.cause)
          ? error.index
          : -1;
      const duplicateConflict =
        isDuplicateSourceError(error) ||
        (error instanceof IndexedBulkError &&
          isDuplicateSourceError(error.cause));
      if (duplicateConflict) {
        const conflicts = findExistingSourceConflicts(sourceUrlByIndex);
        const normalizedConflicts =
          conflicts.length > 0
            ? conflicts
            : [{ index: duplicateIndex, message: "sourceUrl already exists." }];

        return respondError(409, "DUPLICATE_SOURCE", normalizedConflicts);
      }

      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to create bulk posts.", { error });
      }

      return respondError(500, "INTERNAL_ERROR", [
        { index: -1, message: "Failed to create posts." },
      ]);
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
