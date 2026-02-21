import { redirect } from "next/navigation";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

function normalizeOptionalString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildLoginHref(nextPath: string): string {
  return `/admin/login?next=${encodeURIComponent(nextPath)}`;
}

export default async function TagsIndexPage({ searchParams }: PageProps) {
  const [params, session] = await Promise.all([
    searchParams,
    getAdminSessionFromServerCookies(),
  ]);
  const q = normalizeOptionalString(params.q);
  const nextPath = q ? `/tags?q=${encodeURIComponent(q)}` : "/tags";

  if (!session) {
    redirect(buildLoginHref(nextPath));
  }

  redirect("/wiki");
}
