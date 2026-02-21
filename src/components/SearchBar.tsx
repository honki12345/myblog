import Link from "next/link";

type SearchBarProps = {
  query: string | null;
  isAdmin?: boolean;
};

export default function SearchBar({ query, isAdmin = false }: SearchBarProps) {
  const normalizedQuery = query ?? "";
  const hasQuery = normalizedQuery.length > 0;
  const postsPath = hasQuery
    ? `/posts?q=${encodeURIComponent(normalizedQuery)}`
    : "/posts";
  const loginHref = `/admin/login?next=${encodeURIComponent(postsPath)}`;
  const action = isAdmin ? "/posts" : "/admin/login";

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <form
        method="get"
        action={action}
        className="flex w-full max-w-xl items-stretch gap-2"
      >
        {!isAdmin ? (
          <input type="hidden" name="next" value={postsPath} />
        ) : null}
        <label htmlFor="posts-search" className="sr-only">
          검색어
        </label>
        <input
          id="posts-search"
          name="q"
          type="search"
          defaultValue={normalizedQuery}
          autoComplete="off"
          placeholder="예: Kubernetes…"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-900 focus:ring-2 focus:ring-slate-200 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
        >
          검색
        </button>
      </form>

      {hasQuery ? (
        <Link
          href={isAdmin ? "/posts" : loginHref}
          className="text-sm text-slate-600 hover:underline"
        >
          초기화
        </Link>
      ) : null}
    </div>
  );
}
