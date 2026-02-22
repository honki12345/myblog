export const COMMENT_TAG_PATH_PATTERN = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
export const COMMENT_TAG_PATH_MAX_DEPTH = 4;
export const COMMENT_TAG_PATH_MAX_SEGMENT_LENGTH = 32;
export const COMMENT_TAG_PATH_MAX_TOTAL_LENGTH = 120;

export type CommentTagPathValidationResult =
  | { valid: true; normalizedPath: string }
  | { valid: false; message: string };

export function normalizeCommentTagPath(input: string): string {
  return input.trim().toLowerCase();
}

export function validateCommentTagPath(
  input: string,
): CommentTagPathValidationResult {
  const normalizedPath = normalizeCommentTagPath(input);
  if (normalizedPath.length === 0) {
    return { valid: false, message: "tagPath is required." };
  }

  if (normalizedPath.length > COMMENT_TAG_PATH_MAX_TOTAL_LENGTH) {
    return {
      valid: false,
      message: `tagPath must be ${COMMENT_TAG_PATH_MAX_TOTAL_LENGTH} characters or fewer.`,
    };
  }

  if (!COMMENT_TAG_PATH_PATTERN.test(normalizedPath)) {
    return {
      valid: false,
      message:
        "tagPath must match ^[a-z0-9-]+(?:/[a-z0-9-]+)*$ (lowercase path segments).",
    };
  }

  const segments = normalizedPath.split("/");
  if (segments.length > COMMENT_TAG_PATH_MAX_DEPTH) {
    return {
      valid: false,
      message: `tagPath depth must be ${COMMENT_TAG_PATH_MAX_DEPTH} or fewer.`,
    };
  }

  for (const segment of segments) {
    if (segment.length > COMMENT_TAG_PATH_MAX_SEGMENT_LENGTH) {
      return {
        valid: false,
        message: `tagPath segment must be ${COMMENT_TAG_PATH_MAX_SEGMENT_LENGTH} characters or fewer.`,
      };
    }
  }

  return { valid: true, normalizedPath };
}

export function buildWikiPathHref(tagPath: string): string {
  const encodedPath = tagPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/wiki/${encodedPath}`;
}

export function normalizeWikiPathFromTagName(tag: string): string | null {
  const validated = validateCommentTagPath(tag);
  if (!validated.valid) {
    return null;
  }

  return validated.normalizedPath;
}

export function normalizeWikiPathFromSegments(
  rawSegments: readonly string[],
): string | null {
  const decodedSegments: string[] = [];

  for (const rawSegment of rawSegments) {
    try {
      decodedSegments.push(decodeURIComponent(rawSegment));
    } catch {
      return null;
    }
  }

  const joined = decodedSegments.join("/");
  const validated = validateCommentTagPath(joined);
  if (!validated.valid) {
    return null;
  }

  return validated.normalizedPath;
}
