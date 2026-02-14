import Link from "next/link";

const links = [
  { href: "/posts", label: "Posts" },
  { href: "/write", label: "Write" },
  { href: "/tags/sample", label: "Tag Sample" },
];

export default function Home() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <header className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Step 1 Ready
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Honki Blog Scaffold
          </h1>
          <p className="max-w-2xl text-sm text-slate-600 sm:text-base">
            Next.js standalone build and foundational routes are prepared for the following
            implementation steps.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          {links.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
