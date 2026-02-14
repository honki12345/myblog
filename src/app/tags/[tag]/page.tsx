type PageProps = {
  params: Promise<{ tag: string }>;
};

export default async function TagPage({ params }: PageProps) {
  const { tag } = await params;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Tag: {tag}</h1>
      <p className="mt-2 text-sm text-slate-600">Posts filtered by this tag will appear here.</p>
    </main>
  );
}
