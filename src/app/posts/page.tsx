import PostCard from "@/components/PostCard";

const samplePosts = [
  {
    id: 1,
    slug: "step-1-initialization",
    title: "Step 1 Initialization Complete",
    excerpt: "Project scaffold and configuration are in place.",
    tags: ["setup", "nextjs"],
  },
];

export default function PostsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Posts</h1>
      <div className="grid gap-4">
        {samplePosts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </main>
  );
}
