import { describe, expect, it } from "vitest";
import { lastHeading, parseMarkdown, plainText, serializeMarkdown, type Block } from "./markdown";
import { SAMPLE_REPORT_MD } from "./fixtures";

const roundTrip = (md: string) => parseMarkdown(serializeMarkdown(parseMarkdown(md)));

describe("parseMarkdown", () => {
  it("reads headings, paragraphs, code chips, tables, tasks, lists and quotes", () => {
    const blocks = parseMarkdown(SAMPLE_REPORT_MD);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "heading",
      "paragraph",
      "heading",
      "table",
      "heading",
      "tasks",
      "heading",
      "list",
      "quote",
    ]);
    const summary = blocks[2] as Extract<Block, { type: "paragraph" }>;
    expect(summary.content.some((n) => n.type === "text" && n.code && n.text === "high")).toBe(true);
    expect(summary.content.some((n) => n.type === "text" && n.bold && n.text === "52 sheets")).toBe(true);

    const table = blocks[4] as Extract<Block, { type: "table" }>;
    expect(table.header.map(plainText)).toEqual(["Sheet", "Rule", "Finding", "Suggested fix"]);
    expect(table.rows).toHaveLength(4);
    expect(plainText(table.rows[0][0])).toBe("A-0.1");

    const tasks = blocks[6] as Extract<Block, { type: "tasks" }>;
    expect(tasks.items.map((i) => i.checked)).toEqual([false, false, true]);
  });

  it("keeps the same blocks after serializing and reading again", () => {
    expect(roundTrip(SAMPLE_REPORT_MD)).toEqual(parseMarkdown(SAMPLE_REPORT_MD));
  });

  it("keeps pipes, stars and links inside table cells", () => {
    const md = "| Name | Note |\n| :-- | --: |\n| a \\| b | **bold** and [link](https://example.com) |\n";
    const blocks = parseMarkdown(md);
    const table = blocks[0] as Extract<Block, { type: "table" }>;
    expect(table.align).toEqual(["left", "right"]);
    expect(plainText(table.rows[0][0])).toBe("a | b");
    expect(roundTrip(md)).toEqual(blocks);
  });

  it("escapes text that would otherwise become markup", () => {
    const blocks: Block[] = [
      { type: "paragraph", content: [{ type: "text", text: "# not a heading *and* `not code` 1. here" }] },
    ];
    expect(parseMarkdown(serializeMarkdown(blocks))).toEqual(blocks);
  });

  it("reads partial text while an artifact streams", () => {
    expect(() => parseMarkdown("## Findi")).not.toThrow();
    expect(parseMarkdown("## Findi")[0]).toMatchObject({ type: "heading", level: 2 });

    const halfTable = parseMarkdown("| Sheet | Rule |\n| --- | --- |\n| A-0.1 | B");
    expect(halfTable[0]).toMatchObject({ type: "table" });

    const openFence = parseMarkdown("```js\nconst a = 1");
    expect(openFence[0]).toMatchObject({ type: "code", lang: "js", text: "const a = 1" });

    expect(() => parseMarkdown("**bold with no end")).not.toThrow();
  });

  it("finds the last heading for the generating status", () => {
    expect(lastHeading(parseMarkdown(SAMPLE_REPORT_MD))).toBe("Method");
    expect(lastHeading([])).toBeNull();
  });
});
