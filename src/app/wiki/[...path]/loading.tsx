export default function WikiPathLoading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6 lg:px-8">
      <div className="h-8 w-28 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" />
        <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" />
      </div>
    </main>
  );
}
