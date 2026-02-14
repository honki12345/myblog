"use client";

import { useEffect, useState } from "react";

type MermaidDiagramProps = {
  chart: string;
};

export default function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="rounded-lg bg-slate-100 p-3 text-sm text-slate-500">Loading diagram...</div>;
  }

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
