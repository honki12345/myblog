export function createSlug(value: string) {
  const slug = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "post";
}

export function withSlugSuffix(baseSlug: string, index: number) {
  if (index <= 1) {
    return baseSlug;
  }

  return `${baseSlug}-${index}`;
}
