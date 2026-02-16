import { createHash } from "node:crypto";

export type ApiPayloadSummary = {
  postCount: number;
  contentLengthSum: number;
  sourceUrlCount: number;
  payloadHash: string;
};

type ApiLogInput = {
  route: string;
  status: number;
  durationMs: number;
  summary: ApiPayloadSummary;
};

type PostShape = {
  titleLength: number;
  contentLength: number;
  tagCount: number;
  sourceUrlLength: number;
  status: "draft" | "published" | "other" | "unknown";
  aiModelLength: number;
  promptHintLength: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toSafeLength(value: unknown): number {
  return typeof value === "string" ? value.length : 0;
}

function toTagCount(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }

  return value.filter((tag) => typeof tag === "string" && tag.length > 0)
    .length;
}

function toStatusShape(value: unknown): PostShape["status"] {
  if (value === "draft" || value === "published") {
    return value;
  }

  if (typeof value === "string") {
    return "other";
  }

  return "unknown";
}

function toPostShape(value: unknown): PostShape {
  if (!isRecord(value)) {
    return {
      titleLength: 0,
      contentLength: 0,
      tagCount: 0,
      sourceUrlLength: 0,
      status: "unknown",
      aiModelLength: 0,
      promptHintLength: 0,
    };
  }

  return {
    titleLength: toSafeLength(value.title),
    contentLength: toSafeLength(value.content),
    tagCount: toTagCount(value.tags),
    sourceUrlLength: toSafeLength(value.sourceUrl),
    status: toStatusShape(value.status),
    aiModelLength: toSafeLength(value.aiModel),
    promptHintLength: toSafeLength(value.promptHint),
  };
}

function normalizePostsPayload(payload: unknown): unknown[] {
  if (!isRecord(payload)) {
    return [];
  }

  if (Array.isArray(payload.posts)) {
    return payload.posts;
  }

  return [payload];
}

export function summarizeApiPayload(payload: unknown): ApiPayloadSummary {
  const postShapes = normalizePostsPayload(payload).map(toPostShape);
  const contentLengthSum = postShapes.reduce(
    (sum, post) => sum + post.contentLength,
    0,
  );
  const sourceUrlCount = postShapes.reduce(
    (sum, post) => sum + (post.sourceUrlLength > 0 ? 1 : 0),
    0,
  );
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(postShapes))
    .digest("hex");

  return {
    postCount: postShapes.length,
    contentLengthSum,
    sourceUrlCount,
    payloadHash,
  };
}

export function logApiRequest(input: ApiLogInput): void {
  const entry = {
    timestamp: new Date().toISOString(),
    route: input.route,
    status: input.status,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    postCount: input.summary.postCount,
    contentLengthSum: input.summary.contentLengthSum,
    sourceUrlCount: input.summary.sourceUrlCount,
    payloadHash: input.summary.payloadHash,
  };

  console.log(JSON.stringify(entry));
}
