import { redirect } from "next/navigation";

type WritePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function WriteRedirectPage({
  searchParams,
}: WritePageProps) {
  const params = await searchParams;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      query.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        query.append(key, item);
      }
    }
  }

  const target =
    query.size > 0 ? `/admin/write?${query.toString()}` : "/admin/write";
  redirect(target);
}
