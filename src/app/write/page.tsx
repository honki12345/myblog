export default function WritePage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Write</h1>
      <p className="mt-2 text-sm text-slate-600">
        API key protected write/edit UI will be implemented in later steps.
      </p>
      <form className="mt-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          type="text"
          placeholder="Title"
          disabled
        />
        <textarea
          className="min-h-40 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Markdown content"
          disabled
        />
        <button
          type="button"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled
        >
          Save Draft
        </button>
      </form>
    </main>
  );
}
