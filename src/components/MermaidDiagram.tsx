"use client";

import { useEffect } from "react";

function decodeBase64Utf8(value: string): string {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export default function MermaidDiagram() {
  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      const containers = Array.from(
        document.querySelectorAll<HTMLElement>(".mermaid-container[data-chart]"),
      );

      if (containers.length === 0) {
        return;
      }

      const mermaidModule = await import("mermaid");
      if (cancelled) {
        return;
      }

      const mermaid = mermaidModule.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "default",
      });

      for (const [index, container] of containers.entries()) {
        if (cancelled || container.dataset.mermaidRendered === "true") {
          continue;
        }

        const encoded = container.dataset.chart;
        if (!encoded) {
          continue;
        }

        container.textContent = "Rendering diagram...";

        try {
          const chart = decodeBase64Utf8(encoded);
          const id = `mermaid-${Date.now()}-${index}`;
          const { svg } = await mermaid.render(id, chart);

          if (cancelled) {
            return;
          }

          container.innerHTML = svg;
          container.dataset.mermaidRendered = "true";
        } catch {
          container.textContent = "Mermaid diagram could not be rendered.";
          container.dataset.mermaidRendered = "error";
        }
      }
    };

    render().catch(() => {
      const containers = document.querySelectorAll<HTMLElement>(
        ".mermaid-container[data-chart]",
      );
      for (const container of containers) {
        container.textContent = "Mermaid diagram could not be rendered.";
        container.dataset.mermaidRendered = "error";
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
