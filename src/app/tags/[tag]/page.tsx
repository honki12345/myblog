import { notFound, redirect } from "next/navigation";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";
import {
  buildWikiPathHref,
  normalizeWikiPathFromTagName,
} from "@/lib/comment-tags";

type PageProps = {
  params: Promise<{ tag: string }>;
};

function buildLoginHref(nextPath: string): string {
  return `/admin/login?next=${encodeURIComponent(nextPath)}`;
}

function decodeTag(rawTag: string): string | null {
  try {
    return decodeURIComponent(rawTag);
  } catch {
    return null;
  }
}

export default async function TagPage({ params }: PageProps) {
  const { tag: rawTag } = await params;
  const decodedTag = decodeTag(rawTag);
  if (!decodedTag) {
    notFound();
  }

  const wikiPath = normalizeWikiPathFromTagName(decodedTag);
  if (!wikiPath) {
    notFound();
  }

  const session = await getAdminSessionFromServerCookies();
  if (!session) {
    redirect(buildLoginHref(`/tags/${encodeURIComponent(decodedTag)}`));
  }

  redirect(buildWikiPathHref(wikiPath));
}
