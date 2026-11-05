import {
  normalizeInline,
  parseMarkdown,
  serializeMarkdown,
  type Block,
  type HeadingLevel,
  type Inline,
  type TextSpan,
} from "./markdown";

/** The editor's JSON document shape (ProseMirror JSON, as Tiptap's getJSON returns it). */
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

function inlineToNodes(content: Inline[]): DocNode[] {
  const nodes: DocNode[] = [];
  for (const node of normalizeInline(content)) {
    if (node.type === "break") {
      nodes.push({ type: "hardBreak" });
      continue;
    }
    const marks: NonNullable<DocNode["marks"]> = [];
    if (node.href !== undefined) marks.push({ type: "link", attrs: { href: node.href } });
    if (node.code) {
      // The code mark excludes every other mark except the link.
      marks.push({ type: "code" });
    } else {
      if (node.bold) marks.push({ type: "bold" });
      if (node.italic) marks.push({ type: "italic" });
      if (node.strike) marks.push({ type: "strike" });
    }
    nodes.push(marks.length ? { type: "text", text: node.text, marks } : { type: "text", text: node.text });
  }
  return nodes;
}

function paragraph(content: Inline[]): DocNode {
  const nodes = inlineToNodes(content);
  return nodes.length ? { type: "paragraph", content: nodes } : { type: "paragraph" };
}

function cell(type: "tableHeader" | "tableCell", content: Inline[]): DocNode {
  return { type, attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [paragraph(content)] };
}

function blockToNode(block: Block): DocNode {
  switch (block.type) {
    case "heading": {
      const nodes = inlineToNodes(block.content);
      return { type: "heading", attrs: { level: Math.min(block.level, 4) }, ...(nodes.length ? { content: nodes } : {}) };
    }
    case "paragraph":
      return paragraph(block.content);
    case "list":
      return {
        type: block.ordered ? "orderedList" : "bulletList",
        ...(block.ordered ? { attrs: { start: block.start } } : {}),
        content: block.items.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
      };
    case "tasks":
      return {
        type: "taskList",
        content: block.items.map((item) => ({
          type: "taskItem",
          attrs: { checked: item.checked },
          content: [paragraph(item.content)],
        })),
      };
    case "table":
      return {
        type: "table",
        content: [
          { type: "tableRow", content: block.header.map((c) => cell("tableHeader", c)) },
          ...block.rows.map((row) => ({ type: "tableRow", content: row.map((c) => cell("tableCell", c)) })),
        ],
      };
    case "code":
      return {
        type: "codeBlock",
        attrs: { language: block.lang || null },
        ...(block.text ? { content: [{ type: "text", text: block.text }] } : {}),
      };
    case "quote":
      return { type: "blockquote", content: [paragraph(block.content)] };
    case "rule":
      return { type: "horizontalRule" };
    case "image":
      return { type: "image", attrs: { src: block.src, alt: block.alt || null } };
  }
}

export function blocksToDoc(blocks: Block[]): DocNode {
  const content = blocks.map(blockToNode);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

function nodesToInline(nodes: DocNode[] | undefined): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "hardBreak") {
      out.push({ type: "break" });
      continue;
    }
    if (node.type !== "text" || !node.text) continue;
    const span: TextSpan = { type: "text", text: node.text };
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") span.bold = true;
      else if (mark.type === "italic") span.italic = true;
      else if (mark.type === "strike") span.strike = true;
      else if (mark.type === "code") span.code = true;
      else if (mark.type === "link" && typeof mark.attrs?.href === "string") span.href = mark.attrs.href;
    }
    out.push(span);
  }
  return normalizeInline(out);
}

/** All inline content under a node, with paragraphs joined by spaces. */
function flattenInline(node: DocNode): Inline[] {
  if (node.type === "paragraph" || node.type === "heading") return nodesToInline(node.content);
  if (node.type === "text" || node.type === "hardBreak") return nodesToInline([node]);
  const parts = (node.content ?? []).map(flattenInline).filter((part) => part.length);
  const out: Inline[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push({ type: "text", text: " " });
    out.push(...part);
  });
  return normalizeInline(out);
}

function plainOf(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(plainOf).join("");
}

function nodeToBlocks(node: DocNode): Block[] {
  switch (node.type) {
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6) as HeadingLevel;
      return [{ type: "heading", level, content: nodesToInline(node.content) }];
    }
    case "paragraph":
      return [{ type: "paragraph", content: nodesToInline(node.content) }];
    case "bulletList":
    case "orderedList": {
      // Nested lists are flattened into the parent list.
      const items: Inline[][] = [];
      const collect = (list: DocNode) => {
        for (const item of list.content ?? []) {
          const own = (item.content ?? []).filter((c) => c.type !== "bulletList" && c.type !== "orderedList");
          items.push(flattenInline({ type: "listItem", content: own }));
          for (const child of item.content ?? []) {
            if (child.type === "bulletList" || child.type === "orderedList") collect(child);
          }
        }
      };
      collect(node);
      return [
        {
          type: "list",
          ordered: node.type === "orderedList",
          start: Number(node.attrs?.start) || 1,
          items,
        },
      ];
    }
    case "taskList":
      return [
        {
          type: "tasks",
          items: (node.content ?? []).map((item) => ({
            checked: Boolean(item.attrs?.checked),
            content: flattenInline(item),
          })),
        },
      ];
    case "table": {
      const rows = (node.content ?? []).map((row) => (row.content ?? []).map(flattenInline));
      if (rows.length === 0) return [];
      const width = Math.max(...rows.map((row) => row.length), 1);
      const pad = (row: Inline[][]) => {
        const out = row.slice(0, width);
        while (out.length < width) out.push([]);
        return out;
      };
      return [
        {
          type: "table",
          align: Array.from({ length: width }, () => null),
          header: pad(rows[0]),
          rows: rows.slice(1).map(pad),
        },
      ];
    }
    case "codeBlock":
      return [{ type: "code", lang: typeof node.attrs?.language === "string" ? node.attrs.language : "", text: plainOf(node) }];
    case "blockquote":
      return [{ type: "quote", content: flattenInline(node) }];
    case "horizontalRule":
      return [{ type: "rule" }];
    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      return src ? [{ type: "image", src, alt }] : [];
    }
    default: {
      const content = flattenInline(node);
      return content.length ? [{ type: "paragraph", content }] : [];
    }
  }
}

export function docToBlocks(doc: DocNode): Block[] {
  return (doc.content ?? []).flatMap(nodeToBlocks);
}

export const markdownToDoc = (markdown: string): DocNode => blocksToDoc(parseMarkdown(markdown));
export const docToMarkdown = (doc: DocNode): string => serializeMarkdown(docToBlocks(doc));
