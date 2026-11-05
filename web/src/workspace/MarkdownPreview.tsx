// A plain preview of artifact markdown: headings, paragraphs, lists, quotes and tables.
// It stands in until the artifact canvas (live render, editing, export) lands.
import type { ReactNode } from "react";

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

/** Splits one table row into cells, keeping escaped pipes. */
export function tableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && inner[i + 1] === "|") {
      current += "|";
      i++;
    } else if (inner[i] === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += inner[i];
    }
  }
  cells.push(current.trim());
  return cells;
}

const isTableRule = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const head = tableCells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(tableCells(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    const listItem = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line);
    if (listItem) {
      const ordered = Boolean(listItem[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(lines[i]);
        if (!m || Boolean(m[2]) !== ordered) break;
        items.push(m[3]);
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (line.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        parts.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: parts.join(" ") });
      continue;
    }
    const parts: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|\s*\|)/.test(lines[i])) {
      parts.push(lines[i]);
      i++;
    }
    if (parts.length === 0) {
      parts.push(line);
      i++;
    }
    blocks.push({ kind: "paragraph", text: parts.join(" ") });
  }
  return blocks;
}

/** Renders **bold** and `code`; everything else stays plain text. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="bg-surface px-1 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

const HEADING_CLASS = [
  "",
  "font-display text-[32px] font-semibold leading-[1.15]",
  "mt-8 font-display text-2xl font-semibold leading-[1.25]",
  "mt-6 font-display text-lg font-semibold",
  "mt-4 text-base font-semibold",
];

export function MarkdownPreview({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(markdown);
  return (
    <div className="grid max-w-[760px] gap-4 text-base leading-[1.55]">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading": {
            const Tag = (["h1", "h2", "h3", "h4"] as const)[block.level - 1];
            return (
              <Tag key={i} className={HEADING_CLASS[block.level]}>
                {inline(block.text)}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote key={i} className="border-l-4 border-accent pl-4">
                {inline(block.text)}
              </blockquote>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={`grid gap-1 pl-6 ${block.ordered ? "list-decimal" : "list-disc"}`}>
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </Tag>
            );
          }
          case "table":
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {block.head.map((h, j) => (
                        <th key={j} scope="col" className="border border-border bg-surface px-3 py-2 text-left font-semibold">
                          {inline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((c, j) => (
                          <td key={j} className="border border-border px-3 py-2 align-top">
                            {inline(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={i}>{inline(block.text)}</p>;
        }
      })}
    </div>
  );
}
