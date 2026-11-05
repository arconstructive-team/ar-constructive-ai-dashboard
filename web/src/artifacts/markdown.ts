/**
 * A small, strict markdown model for artifacts.
 *
 * Artifacts are stored as markdown (GitHub style, with tables). The document
 * view, the editor, the PDF export and the Word export all read the same block
 * list from `parseMarkdown`, so a heading or a table looks the same everywhere.
 * `serializeMarkdown` writes the block list back, so an edit round-trips.
 *
 * The parser accepts partial input: while an artifact is generating, the text
 * stops in the middle of a line, a table or a code fence, and the parser shows
 * what is there.
 */

export interface TextSpan {
  type: "text";
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
}

export interface LineBreak {
  type: "break";
}

export type Inline = TextSpan | LineBreak;

export type Align = "left" | "center" | "right" | null;

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type Block =
  | { type: "heading"; level: HeadingLevel; content: Inline[] }
  | { type: "paragraph"; content: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: Inline[][] }
  | { type: "tasks"; items: Array<{ checked: boolean; content: Inline[] }> }
  | { type: "table"; align: Align[]; header: Inline[][]; rows: Inline[][][] }
  | { type: "code"; lang: string; text: string }
  | { type: "quote"; content: Inline[] }
  | { type: "rule" }
  | { type: "image"; src: string; alt: string };

const HEADING = /^(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w+#.-]*)[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TASK = /^\s*[-*+][ \t]+\[([ xX])\](?:[ \t]+(.*))?$/;
const BULLET = /^\s*[-*+][ \t]+(.*)$/;
const ORDERED = /^\s*(\d{1,9})[.)][ \t]+(.*)$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const IMAGE = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/;
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

type ListKind = "task" | "bullet" | "ordered";

function listKind(line: string): ListKind | null {
  if (TASK.test(line)) return "task";
  if (BULLET.test(line)) return "bullet";
  if (ORDERED.test(line)) return "ordered";
  return null;
}

function isTableStart(line: string, next: string | undefined): boolean {
  return line.includes("|") && next !== undefined && next.includes("-") && DELIMITER.test(next);
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    HEADING.test(line) ||
    FENCE.test(line) ||
    RULE.test(line) ||
    listKind(line) !== null ||
    QUOTE.test(line) ||
    IMAGE.test(line) ||
    isTableStart(line, next)
  );
}

/** Splits one table row into its raw cell texts. Pipes inside code spans or escaped pipes stay in the cell. */
export function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  let inCode = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "|") {
      // GFM: an escaped pipe in a code span is a plain pipe.
      current += inCode ? "|" : "\\|";
      i++;
      continue;
    }
    if (ch === "`") inCode = !inCode;
    if (ch === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseAlign(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

function fit<T>(cells: T[], width: number, empty: () => T): T[] {
  const out = cells.slice(0, width);
  while (out.length < width) out.push(empty());
  return out;
}

/** Joins paragraph lines. A line that ends with a backslash or two spaces is a hard line break. */
function joinLines(lines: string[]): string {
  let out = "";
  lines.forEach((raw, index) => {
    let line = raw.trim();
    let hard = false;
    if (/ {2,}$/.test(raw) || (line.endsWith("\\") && !line.endsWith("\\\\"))) {
      hard = true;
      line = line.replace(/\\$/, "").trimEnd();
    }
    out += line;
    if (index < lines.length - 1) out += hard ? "\n" : " ";
  });
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const close = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as HeadingLevel,
        content: parseInline(heading[2] ?? ""),
      });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    const image = IMAGE.exec(line);
    if (image) {
      blocks.push({ type: "image", alt: image[1], src: image[2] });
      i++;
      continue;
    }

    if (isTableStart(line, lines[i + 1])) {
      const headerCells = splitRow(line);
      const align = fit(splitRow(lines[i + 1]).map(parseAlign), headerCells.length, () => null);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(fit(splitRow(lines[i]), headerCells.length, () => "").map((cell) => parseInline(cell)));
        i++;
      }
      blocks.push({ type: "table", align, header: headerCells.map((cell) => parseInline(cell)), rows });
      continue;
    }

    const kind = listKind(line);
    if (kind) {
      const items: string[][] = [];
      const checked: boolean[] = [];
      let start = 1;
      while (i < lines.length) {
        const current = lines[i];
        if (!current.trim()) {
          // A blank line inside a list: keep going only if the list goes on.
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && listKind(lines[j]) === kind) {
            i = j;
            continue;
          }
          break;
        }
        const currentKind = listKind(current);
        if (currentKind === kind) {
          if (kind === "task") {
            const match = TASK.exec(current)!;
            checked.push(match[1] !== " ");
            items.push([match[2] ?? ""]);
          } else if (kind === "ordered") {
            const match = ORDERED.exec(current)!;
            if (items.length === 0) start = Number(match[1]);
            items.push([match[2]]);
          } else {
            items.push([BULLET.exec(current)![1]]);
          }
          i++;
          continue;
        }
        if (currentKind === null && /^\s+\S/.test(current) && items.length > 0) {
          // An indented line continues the item above.
          items[items.length - 1].push(current);
          i++;
          continue;
        }
        break;
      }
      if (kind === "task") {
        blocks.push({
          type: "tasks",
          items: items.map((parts, index) => ({ checked: checked[index], content: parseInline(joinLines(parts)) })),
        });
      } else {
        blocks.push({
          type: "list",
          ordered: kind === "ordered",
          start,
          items: items.map((parts) => parseInline(joinLines(parts))),
        });
      }
      continue;
    }

    if (QUOTE.test(line)) {
      const parts: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        parts.push(QUOTE.exec(lines[i])![1]);
        i++;
      }
      blocks.push({ type: "quote", content: parseInline(joinLines(parts.filter((part) => part.trim()))) });
      continue;
    }

    const parts: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) {
      parts.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", content: parseInline(joinLines(parts)) });
  }

  return blocks;
}

type Marks = Omit<TextSpan, "type" | "text">;

const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const WORD = /[\p{L}\p{N}]/u;

function sameMarks(a: TextSpan, b: TextSpan): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.strike) === Boolean(b.strike) &&
    Boolean(a.code) === Boolean(b.code) &&
    a.href === b.href
  );
}

function span(text: string, marks: Marks): TextSpan {
  const out: TextSpan = { type: "text", text };
  if (marks.bold) out.bold = true;
  if (marks.italic) out.italic = true;
  if (marks.strike) out.strike = true;
  if (marks.code) out.code = true;
  if (marks.href !== undefined) out.href = marks.href;
  return out;
}

/** Merges neighbouring spans with the same marks and drops empty ones. */
export function normalizeInline(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      if (!node.text) continue;
      const last = out[out.length - 1];
      if (last && last.type === "text" && sameMarks(last, node)) {
        out[out.length - 1] = { ...last, text: last.text + node.text };
        continue;
      }
    }
    out.push(node);
  }
  return out;
}

/** Finds the closing delimiter for emphasis that starts at `from`. */
function findClose(text: string, delim: string, from: number): number {
  let index = from;
  while (index < text.length) {
    const found = text.indexOf(delim, index);
    if (found < 0) return -1;
    if (text[found - 1] === "\\") {
      index = found + 1;
      continue;
    }
    if (delim === "*" && text[found + 1] === "*") {
      // Skip a "**" pair inside single-star emphasis.
      const pair = text.indexOf("**", found + 2);
      index = pair < 0 ? found + 2 : pair + 2;
      continue;
    }
    if (delim === "_" && WORD.test(text[found + 1] ?? "")) {
      index = found + 1;
      continue;
    }
    if (found === from || /\s/.test(text[found - 1] ?? "")) {
      index = found + 1;
      continue;
    }
    return found;
  }
  return -1;
}

export function parseInline(text: string, marks: Marks = {}): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push(span(buffer, marks));
    buffer = "";
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "\\" && i + 1 < text.length && PUNCTUATION.test(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === "\n") {
      flush();
      out.push({ type: "break" });
      i++;
      continue;
    }

    if (ch === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      const fence = "`".repeat(run);
      let close = text.indexOf(fence, i + run);
      while (close >= 0 && text[close + run] === "`") close = text.indexOf(fence, close + run + 1);
      if (close >= 0) {
        flush();
        let code = text.slice(i + run, close);
        if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
        out.push(span(code, { code: true, href: marks.href }));
        i = close + run;
        continue;
      }
      buffer += fence;
      i += run;
      continue;
    }

    if (ch === "[" && marks.href === undefined) {
      const match = /^\[((?:\\.|[^\]\\])*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(text.slice(i));
      if (match) {
        flush();
        out.push(...parseInline(match[1], { ...marks, href: match[2] }));
        i += match[0].length;
        continue;
      }
    }

    if (ch === "!" && text[i + 1] === "[") {
      const match = /^!\[([^\]]*)\]\(([^)\s]*)\)/.exec(text.slice(i));
      if (match) {
        flush();
        out.push(span(match[1] || match[2], { ...marks, href: match[2] }));
        i += match[0].length;
        continue;
      }
    }

    if ((ch === "*" || ch === "_") && text[i + 1] === ch && !(ch === "_" && WORD.test(text[i - 1] ?? ""))) {
      const delim = ch + ch;
      const close = findClose(text, delim, i + 2);
      if (close > i + 2 && !/\s/.test(text[i + 2])) {
        flush();
        out.push(...parseInline(text.slice(i + 2, close), { ...marks, bold: true }));
        i = close + 2;
        continue;
      }
    }

    if (ch === "~" && text[i + 1] === "~") {
      const close = text.indexOf("~~", i + 2);
      if (close > i + 2) {
        flush();
        out.push(...parseInline(text.slice(i + 2, close), { ...marks, strike: true }));
        i = close + 2;
        continue;
      }
    }

    if ((ch === "*" || ch === "_") && text[i + 1] !== ch && !(ch === "_" && WORD.test(text[i - 1] ?? ""))) {
      const close = findClose(text, ch, i + 1);
      if (close > i + 1 && !/\s/.test(text[i + 1])) {
        flush();
        out.push(...parseInline(text.slice(i + 1, close), { ...marks, italic: true }));
        i = close + 1;
        continue;
      }
    }

    buffer += ch;
    i++;
  }
  flush();
  return normalizeInline(out);
}

/** The text of inline content without marks. Line breaks become spaces. */
export function plainText(nodes: Inline[]): string {
  return nodes.map((node) => (node.type === "text" ? node.text : " ")).join("");
}

function escapeText(text: string, inTable: boolean): string {
  let out = text.replace(/[\\`*[\]]/g, (m) => `\\${m}`);
  out = out.replace(/~~/g, "\\~\\~");
  // Escape "_" only where it could open or close emphasis.
  out = out.replace(/_/g, (m, offset: number, whole: string) => {
    const before = whole[offset - 1] ?? "";
    const after = whole[offset + 1] ?? "";
    return WORD.test(before) && WORD.test(after) ? m : `\\${m}`;
  });
  if (inTable) out = out.replace(/\|/g, "\\|");
  return out;
}

function codeSpan(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" ") && text.trim()) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function wrapMarks(node: TextSpan, inTable: boolean): string {
  if (node.code) {
    const code = codeSpan(node.text);
    return inTable ? code.replace(/\|/g, "\\|") : code;
  }
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.text)!;
  const [, lead, core, trail] = match;
  if (!core) return node.text;
  let body = escapeText(core, inTable);
  if (node.strike) body = `~~${body}~~`;
  if (node.italic) body = `*${body}*`;
  if (node.bold) body = `**${body}**`;
  return `${lead}${body}${trail}`;
}

export function serializeInline(nodes: Inline[], inTable = false): string {
  const parts: string[] = [];
  let i = 0;
  const list = normalizeInline(nodes);
  while (i < list.length) {
    const node = list[i];
    if (node.type === "break") {
      parts.push(inTable ? " " : "\\\n");
      i++;
      continue;
    }
    if (node.href !== undefined) {
      const href = node.href;
      const group: TextSpan[] = [];
      while (i < list.length) {
        const next = list[i];
        if (next.type !== "text" || next.href !== href) break;
        group.push({ ...next, href: undefined });
        i++;
      }
      parts.push(`[${group.map((g) => wrapMarks(g, inTable)).join("")}](${href})`);
      continue;
    }
    parts.push(wrapMarks(node, inTable));
    i++;
  }
  return parts.join("");
}

/** Escapes text at the start of a paragraph that would read as another block. */
function guardLineStart(text: string): string {
  if (/^(#{1,6})(\s|$)/.test(text) || /^[>+-](\s|$)/.test(text)) return `\\${text}`;
  const ordered = /^(\d{1,9})([.)])(\s|$)/.exec(text);
  if (ordered) return `${ordered[1]}\\${text.slice(ordered[1].length)}`;
  if (RULE.test(text)) return `\\${text}`;
  return text;
}

function fenceFor(text: string): string {
  let longest = 2;
  for (const run of text.match(/`{3,}/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(longest + 1);
}

function serializeBlock(block: Block): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.level)} ${serializeInline(block.content).replace(/\\\n/g, " ")}`.trimEnd();
    case "paragraph":
      return guardLineStart(serializeInline(block.content));
    case "list":
      return block.items
        .map((item, index) => {
          const marker = block.ordered ? `${block.start + index}.` : "-";
          return `${marker} ${serializeInline(item).replace(/\\\n/g, " ")}`.trimEnd();
        })
        .join("\n");
    case "tasks":
      return block.items
        .map((item) => `- [${item.checked ? "x" : " "}] ${serializeInline(item.content).replace(/\\\n/g, " ")}`.trimEnd())
        .join("\n");
    case "table": {
      const width = Math.max(block.header.length, 1);
      const row = (cells: Inline[][]) =>
        `| ${fit(cells, width, () => [] as Inline[]).map((cell) => serializeInline(cell, true) || " ").join(" | ")} |`;
      const delimiter = `| ${fit(block.align, width, () => null)
        .map((align) => (align === "center" ? ":---:" : align === "right" ? "---:" : align === "left" ? ":---" : "---"))
        .join(" | ")} |`;
      return [row(block.header), delimiter, ...block.rows.map(row)].join("\n");
    }
    case "code": {
      const fence = fenceFor(block.text);
      return `${fence}${block.lang}\n${block.text}\n${fence}`;
    }
    case "quote":
      return `> ${serializeInline(block.content).replace(/\\\n/g, "\\\n> ")}`;
    case "rule":
      return "---";
    case "image":
      return `![${block.alt.replace(/[[\]]/g, "")}](${block.src})`;
  }
}

export function serializeMarkdown(blocks: Block[]): string {
  const parts = blocks
    .filter((block) => !(block.type === "paragraph" && block.content.length === 0))
    .map(serializeBlock);
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}

/** The text of the last heading, for "Writing <section>…" while an artifact generates. */
export function lastHeading(blocks: Block[]): string | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.type === "heading") return plainText(block.content).trim() || null;
  }
  return null;
}
