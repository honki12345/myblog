import PostContent from "@/components/PostContent";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function PostDetailPage({ params }: PageProps) {
  const { slug } = await params;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">{slug}</h1>
      <PostContent content={`# ${slug}\n\nStep 1 placeholder content.`} />
    </main>
  );
}
