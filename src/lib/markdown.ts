import rehypeShiki from "@shikijs/rehype";
import type { Element, Root, RootContent } from "hast";
import type { Schema } from "hast-util-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import type { BuiltinLanguage } from "shiki";
import type { Plugin } from "unified";
import { unified } from "unified";

const SHIKI_LANGUAGES: BuiltinLanguage[] = [
  "javascript",
  "typescript",
  "python",
  "bash",
  "json",
  "sql",
  "html",
  "css",
  "markdown",
  "yaml",
];

const CLASS_NAME_PATTERN = /^[-\w:]+$/;

const KATEX_MATHML_TAGS = [
  "math",
  "semantics",
  "mrow",
  "mi",
  "mn",
  "mo",
  "msup",
  "msub",
  "msubsup",
  "mfrac",
  "msqrt",
  "mroot",
  "mstyle",
  "mspace",
  "mtext",
  "mtable",
  "mtr",
  "mtd",
  "munder",
  "mover",
  "munderover",
  "annotation",
];

export const MERMAID_MAX_BLOCKS = 20;
export const MERMAID_MAX_CHART_BYTES = 20 * 1024;

const markdownSanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: Array.from(
    new Set([...(defaultSchema.tagNames ?? []), ...KATEX_MATHML_TAGS]),
  ),
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    pre: [...(defaultSchema.attributes?.pre ?? []), ["className", CLASS_NAME_PATTERN]],
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", CLASS_NAME_PATTERN],
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", CLASS_NAME_PATTERN],
      "style",
      "ariaHidden",
    ],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "mermaid-container"],
      "dataChart",
    ],
    math: [...(defaultSchema.attributes?.math ?? []), "xmlns", "display"],
    annotation: [...(defaultSchema.attributes?.annotation ?? []), "encoding"],
    mi: [...(defaultSchema.attributes?.mi ?? []), "mathVariant"],
    mo: [
      ...(defaultSchema.attributes?.mo ?? []),
      "accent",
      "fence",
      "form",
      "largeOp",
      "maxSize",
      "minSize",
      "movableLimits",
      "separator",
      "stretchy",
      "symmetric",
    ],
    mspace: [...(defaultSchema.attributes?.mspace ?? []), "width"],
    mstyle: [
      ...(defaultSchema.attributes?.mstyle ?? []),
      "displayStyle",
      "scriptLevel",
    ],
    mtable: [
      ...(defaultSchema.attributes?.mtable ?? []),
      "columnAlign",
      "columnSpacing",
      "rowSpacing",
    ],
    mtd: [
      ...(defaultSchema.attributes?.mtd ?? []),
      "columnAlign",
      "columnSpan",
      "rowSpan",
    ],
  },
};

function toClassList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean);
  }

  return [];
}

function getTextContent(node: RootContent): string {
  if (node.type === "text") {
    return node.value;
  }

  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map((child) => getTextContent(child as RootContent)).join("");
  }

  return "";
}

function extractMermaidChart(preNode: Element): string | null {
  if (preNode.tagName !== "pre") {
    return null;
  }

  const codeNode = preNode.children.find(
    (child): child is Element => child.type === "element" && child.tagName === "code",
  );

  if (!codeNode) {
    return null;
  }

  const classes = toClassList(codeNode.properties?.className);
  if (!classes.includes("language-mermaid")) {
    return null;
  }

  const chart = codeNode.children
    .map((child) => getTextContent(child as RootContent))
    .join("")
    .trim();

  return chart.length > 0 ? chart : null;
}

const rehypeMermaidPlaceholder: Plugin<[], Root> = () => {
  return (tree) => {
    let mermaidBlockCount = 0;

    const transform = (parent: Root | Element) => {
      parent.children = parent.children.map((child) => {
        if (child.type !== "element") {
          return child;
        }

        const chart = extractMermaidChart(child);
        if (chart !== null) {
          mermaidBlockCount += 1;
          const chartBytes = Buffer.byteLength(chart, "utf8");

          if (
            mermaidBlockCount <= MERMAID_MAX_BLOCKS &&
            chartBytes <= MERMAID_MAX_CHART_BYTES
          ) {
            return {
              type: "element",
              tagName: "div",
              properties: {
                className: ["mermaid-container"],
                dataChart: Buffer.from(chart, "utf8").toString("base64"),
              },
              children: [],
            };
          }
        }

        if (child.children.length > 0) {
          transform(child);
        }

        return child;
      });
    };

    transform(tree);
  };
};

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeShiki, {
    theme: "github-dark",
    langs: SHIKI_LANGUAGES,
  })
  .use(rehypeKatex)
  .use(rehypeMermaidPlaceholder)
  .use(rehypeSanitize, markdownSanitizeSchema)
  .use(rehypeStringify);

export async function renderMarkdown(markdown: string): Promise<string> {
  const result = await markdownProcessor.process(markdown);
  return String(result);
}
