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
        // Tailwind preflight resets heading/list styles, so we use our own
        // markdown styling class instead of relying on @tailwindcss/typography.
        className="markdown-preview"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {hasMermaid ? <MermaidDiagram /> : null}
    </>
  );
}
