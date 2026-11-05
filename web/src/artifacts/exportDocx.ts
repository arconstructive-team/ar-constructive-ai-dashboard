import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import type { Block, Inline } from "./markdown";
import { metaLine, type ExportMeta } from "./exportMeta";

// Word colours as hex without "#". They are the DESIGN.md tokens muted, border and surface.
const MUTED = "6E6E6A";
const BORDER = "D4D4D2";
const SURFACE = "E6E6E3";
const NUMBERED = "arco-numbered";

const HEADINGS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
} as const;

function runs(content: Inline[], extra: { bold?: boolean; italics?: boolean; color?: string } = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const node of content) {
    if (node.type === "break") {
      out.push(new TextRun({ text: "", break: 1 }));
      continue;
    }
    const run = new TextRun({
      text: node.text,
      bold: node.bold || extra.bold,
      italics: node.italic || extra.italics,
      strike: node.strike,
      color: extra.color,
      font: node.code ? "Consolas" : undefined,
      shading: node.code ? { type: ShadingType.CLEAR, color: "auto", fill: SURFACE } : undefined,
      style: node.href ? "Hyperlink" : undefined,
    });
    out.push(node.href ? new ExternalHyperlink({ link: node.href, children: [run] }) : run);
  }
  return out;
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: BORDER };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function table(block: Extract<Block, { type: "table" }>): Table {
  const header = new TableRow({
    tableHeader: true,
    children: block.header.map(
      (cell) =>
        new TableCell({
          borders,
          shading: { type: ShadingType.CLEAR, color: "auto", fill: SURFACE },
          children: [new Paragraph({ children: runs(cell, { bold: true }) })],
        }),
    ),
  });
  const rows = block.rows.map(
    (row) =>
      new TableRow({
        children: row.map((cell) => new TableCell({ borders, children: [new Paragraph({ children: runs(cell) })] })),
      }),
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] });
}

/** Builds a Word document with real heading styles and real Word tables. */
export function buildDocxDocument(blocks: Block[], meta: ExportMeta): Document {
  const children: Array<Paragraph | Table> = [
    new Paragraph({ children: [new TextRun({ text: meta.projectName.toUpperCase(), size: 16, bold: true, color: MUTED })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: meta.title })] }),
    new Paragraph({
      children: [new TextRun({ text: metaLine(meta), size: 18, color: MUTED })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "111111", space: 6 } },
      spacing: { after: 240 },
    }),
  ];
  let orderedLists = 0;

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        children.push(new Paragraph({ heading: HEADINGS[block.level], children: runs(block.content) }));
        break;
      case "paragraph":
        children.push(new Paragraph({ children: runs(block.content), spacing: { after: 160 } }));
        break;
      case "list": {
        const instance = orderedLists++;
        for (const item of block.items) {
          children.push(
            block.ordered
              ? new Paragraph({ children: runs(item), numbering: { reference: NUMBERED, level: 0, instance } })
              : new Paragraph({ children: runs(item), bullet: { level: 0 } }),
          );
        }
        break;
      }
      case "tasks":
        for (const item of block.items) {
          children.push(
            new Paragraph({ children: [new TextRun({ text: item.checked ? "☒ " : "☐ " }), ...runs(item.content)] }),
          );
        }
        break;
      case "table":
        children.push(table(block));
        children.push(new Paragraph({ children: [] }));
        break;
      case "code":
        for (const line of block.text.split("\n")) {
          children.push(
            new Paragraph({
              shading: { type: ShadingType.CLEAR, color: "auto", fill: SURFACE },
              spacing: { after: 0 },
              children: [new TextRun({ text: line, font: "Consolas", size: 18 })],
            }),
          );
        }
        children.push(new Paragraph({ children: [] }));
        break;
      case "quote":
        children.push(
          new Paragraph({
            indent: { left: 360 },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: BORDER, space: 8 } },
            children: runs(block.content, { italics: true, color: MUTED }),
          }),
        );
        break;
      case "rule":
        children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER, space: 1 } }, children: [] }));
        break;
      case "image":
        children.push(
          new Paragraph({ children: [new TextRun({ text: `[Image: ${block.alt || block.src}]`, italics: true, color: MUTED })] }),
        );
        break;
    }
  }

  return new Document({
    creator: "arconstructive",
    title: meta.title,
    description: `${meta.projectName}, version ${meta.version}`,
    numbering: {
      config: [
        {
          reference: NUMBERED,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
        children,
      },
    ],
  });
}

export async function buildDocx(blocks: Block[], meta: ExportMeta): Promise<Blob> {
  return Packer.toBlob(buildDocxDocument(blocks, meta));
}
