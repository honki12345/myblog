const IMAGE_MARKDOWN_PATTERN = /!\[[^\]]*\]\(\s*([^\)]+?)\s*\)/g;
const THUMBNAIL_CACHE_LIMIT = 500;
const thumbnailCache = new Map<string, string | null>();

function extractUrlToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Markdown allows URLs wrapped in angle brackets: ![](</path/to/image.png>)
  if (trimmed.startsWith("<")) {
    const endIndex = trimmed.indexOf(">", 1);
    if (endIndex === -1) {
      return null;
    }

    const url = trimmed.slice(1, endIndex).trim();
    return url.length > 0 ? url : null;
  }

  // Ignore optional title: ![](url "title")
  const firstToken = trimmed.split(/\s+/, 1)[0];
  return firstToken.length > 0 ? firstToken : null;
}

function isAllowedThumbnailUrl(url: string): boolean {
  return url.startsWith("/uploads/") || url.startsWith("https://");
}

// 옵션 A: 목록 렌더 시점에 마크다운에서 첫 번째 이미지 URL을 추출한다.
// 유효한 후보가 없으면 null을 반환한다.
export function extractThumbnailUrlFromMarkdown(markdown: string): string | null {
  if (markdown.trim().length === 0) {
    return null;
  }

  if (!markdown.includes("![")) {
    return null;
  }

  for (const match of markdown.matchAll(IMAGE_MARKDOWN_PATTERN)) {
    const raw = match[1];
    const url = extractUrlToken(raw);
    if (!url) {
      continue;
    }

    if (isAllowedThumbnailUrl(url)) {
      return url;
    }
  }

  return null;
}

function touchCacheEntry(key: string, value: string | null) {
  thumbnailCache.delete(key);
  thumbnailCache.set(key, value);

  if (thumbnailCache.size <= THUMBNAIL_CACHE_LIMIT) {
    return;
  }

  const firstKey = thumbnailCache.keys().next().value as string | undefined;
  if (firstKey) {
    thumbnailCache.delete(firstKey);
  }
}

export function extractThumbnailUrlFromMarkdownCached(
  cacheKey: string,
  markdown: string,
): string | null {
  const cached = thumbnailCache.get(cacheKey);
  if (cached !== undefined || thumbnailCache.has(cacheKey)) {
    touchCacheEntry(cacheKey, cached ?? null);
    return cached ?? null;
  }

  const extracted = extractThumbnailUrlFromMarkdown(markdown);
  touchCacheEntry(cacheKey, extracted);
  return extracted;
}
