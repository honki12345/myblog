type SearchBarProps = {
  query: string | null;
};

export default function SearchBar({ query }: SearchBarProps) {
  const normalizedQuery = query ?? "";
  const hasQuery = normalizedQuery.length > 0;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <form
        method="get"
        action="/posts"
        className="flex w-full max-w-xl items-stretch gap-2"
      >
        <label htmlFor="posts-search" className="sr-only">
          검색어
        </label>
        <input
          id="posts-search"
          name="q"
          type="search"
          defaultValue={normalizedQuery}
          placeholder="검색어를 입력하세요"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
        >
          검색
        </button>
      </form>

      {hasQuery ? (
        <a href="/posts" className="text-sm text-slate-600 hover:underline">
          초기화
        </a>
      ) : null}
    </div>
  );
}

