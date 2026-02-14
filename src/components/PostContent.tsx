import { markdownToHtml } from "@/lib/markdown";

type PostContentProps = {
  content: string;
};

export default function PostContent({ content }: PostContentProps) {
  return (
    <article
      className="prose prose-slate max-w-none"
      // Step 1 uses escaped placeholder HTML from markdownToHtml only.
      dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
    />
  );
}
