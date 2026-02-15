import MermaidDiagram from "@/components/MermaidDiagram";
import { renderMarkdown } from "@/lib/markdown";

type PostContentProps = {
  content: string;
};

export default async function PostContent({ content }: PostContentProps) {
  const html = await renderMarkdown(content);

  return (
    <>
      <article
        className="prose prose-slate max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <MermaidDiagram />
    </>
  );
}
