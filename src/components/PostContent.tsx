import MermaidDiagram from "@/components/MermaidDiagram";
import { renderMarkdown } from "@/lib/markdown";

type PostContentProps = {
  content: string;
};

export default async function PostContent({ content }: PostContentProps) {
  const html = await renderMarkdown(content);
  const hasMermaid = /(?:```|~~~)\s*mermaid\b/i.test(content);

  return (
    <>
      <article
        className="markdown-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {hasMermaid ? <MermaidDiagram /> : null}
    </>
  );
}
