import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { editorExtensions } from "./editorExtensions";
import { parseMarkdown } from "./markdown";
import { docToMarkdown, markdownToDoc, type DocNode } from "./tiptapDoc";
import { SAMPLE_REPORT_MD } from "./fixtures";

const WITH_EXTRAS = `${SAMPLE_REPORT_MD}
---

\`\`\`text
A-0.1 | notes
\`\`\`

![Site plan](https://example.com/site.png)

Line one\\
line two with *italic* and ~~old~~ text and [a link](https://example.com).
`;

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("markdown and the editor document", () => {
  it("converts markdown to the editor document and back without losing blocks", () => {
    expect(parseMarkdown(docToMarkdown(markdownToDoc(WITH_EXTRAS)))).toEqual(parseMarkdown(WITH_EXTRAS));
  });

  it("builds real table nodes with a header row", () => {
    const doc = markdownToDoc(SAMPLE_REPORT_MD);
    const table = doc.content?.find((n) => n.type === "table");
    expect(table?.content?.[0].content?.[0].type).toBe("tableHeader");
    expect(table?.content?.[1].content?.[0].type).toBe("tableCell");
    expect(table?.content).toHaveLength(5);
  });

  it("round-trips through a real Tiptap editor, tables included", () => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: editorExtensions(),
      content: markdownToDoc(WITH_EXTRAS) as JSONContent,
    });
    const out = docToMarkdown(editor.getJSON() as DocNode);
    expect(parseMarkdown(out)).toEqual(parseMarkdown(WITH_EXTRAS));
    expect(out).toContain("| Sheet | Rule | Finding | Suggested fix |");
  });

  it("keeps edits made in the editor", () => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: editorExtensions(),
      content: markdownToDoc("## Findings\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n") as JSONContent,
    });
    editor.commands.setTextSelection(1);
    editor.commands.setHeading({ level: 3 });
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "Added." }] });
    const out = docToMarkdown(editor.getJSON() as DocNode);
    expect(out).toMatch(/^### Findings/);
    expect(out).toContain("| 1 | 2 |");
    expect(out.trim().endsWith("Added.")).toBe(true);
  });
});
