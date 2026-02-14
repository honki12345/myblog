import { markdownToHtml } from "@/lib/markdown";

type PostContentProps = {
  content: string;
};

export default function PostContent({ content }: PostContentProps) {
  return (
    <article
      className="prose prose-slate max-w-none"
      dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
    />
  );
}
