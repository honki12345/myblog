"use client";

type MermaidDiagramProps = {
  chart: string;
};

export default function MermaidDiagram({ chart }: MermaidDiagramProps) {
  // Step 1 placeholder: real Mermaid rendering is introduced in later steps.
  return (
    <pre
      className="overflow-x-auto rounded-lg bg-slate-100 p-3 text-sm"
      data-placeholder="mermaid-raw"
    >
      {chart}
    </pre>
  );
}
