import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import { ChevronDown, Code, ImagePlus, ListChecks, Plus, Table } from "lucide-react";
import { editorExtensions } from "./editorExtensions";
import { Menu, focusRing } from "./Menu";
import { docToMarkdown, markdownToDoc, type DocNode } from "./tiptapDoc";
import { CANVAS_CLASS } from "./DocumentView";

export interface ArtifactEditorProps {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  /** True while the artifact generates: the text cannot change. */
  locked: boolean;
  /** The title and chips, shown above the text. */
  header: ReactNode;
}

const toolButton =
  "inline-flex size-11 shrink-0 items-center justify-center gap-0.5 rounded-control text-ink hover:bg-surface aria-pressed:bg-surface disabled:opacity-40";

type TextStyle = "p" | "h1" | "h2" | "h3" | "h4";

const TEXT_STYLES: Array<[TextStyle, string]> = [
  ["p", "Paragraph"],
  ["h1", "Heading 1"],
  ["h2", "Heading 2"],
  ["h3", "Heading 3"],
  ["h4", "Heading 4"],
];

function currentStyle(editor: Editor): TextStyle {
  for (const level of [1, 2, 3, 4] as const) {
    if (editor.isActive("heading", { level })) return `h${level}`;
  }
  return "p";
}

function setStyle(editor: Editor, style: TextStyle) {
  const chain = editor.chain().focus();
  if (style === "p") chain.setParagraph().run();
  else chain.setHeading({ level: Number(style.slice(1)) as 1 | 2 | 3 | 4 }).run();
}

/** The rich text editor for an artifact. Loaded only when someone edits. */
export default function ArtifactEditor({ initialMarkdown, onChange, locked, header }: ArtifactEditorProps) {
  const [imageOpen, setImageOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imageError, setImageError] = useState<string | null>(null);

  const editor = useEditor({
    extensions: editorExtensions(),
    content: markdownToDoc(initialMarkdown) as JSONContent,
    editable: !locked,
    editorProps: {
      attributes: {
        class: "artifact-doc min-h-[40vh] focus:outline-none",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Artifact text",
      },
    },
    onUpdate: ({ editor: current }) => onChange(docToMarkdown(current.getJSON() as DocNode)),
  });

  useEffect(() => {
    editor?.setEditable(!locked);
  }, [editor, locked]);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            style: currentStyle(current),
            code: current.isActive("code"),
            tasks: current.isActive("taskList"),
            table: current.isActive("table"),
          }
        : { style: "p" as TextStyle, code: false, tasks: false, table: false },
  });

  const disabled = locked || !editor;

  function insertImage(event: FormEvent) {
    event.preventDefault();
    const src = imageUrl.trim();
    if (!/^https:\/\/\S+$/i.test(src)) {
      setImageError("Paste an image address that starts with https://");
      return;
    }
    editor?.chain().focus().setImage({ src, alt: "" }).run();
    setImageUrl("");
    setImageError(null);
    setImageOpen(false);
  }

  const run = (action: (e: Editor) => void) => () => {
    if (editor) action(editor);
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label="Formatting"
        className="sticky top-0 z-20 flex flex-wrap items-center gap-1 border-b border-border bg-bg px-2 py-1 md:px-4"
      >
        <label className="sr-only" htmlFor="artifact-text-style">
          Text style
        </label>
        <select
          id="artifact-text-style"
          disabled={disabled}
          value={state?.style ?? "p"}
          onChange={(event) => editor && setStyle(editor, event.target.value as TextStyle)}
          className={`h-11 rounded-control border border-border bg-bg px-2 text-sm text-ink disabled:opacity-40 ${focusRing}`}
        >
          {TEXT_STYLES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Code"
          title="Code"
          aria-pressed={state?.code ?? false}
          disabled={disabled}
          onClick={run((e) => e.chain().focus().toggleCode().run())}
          className={`${toolButton} ${focusRing}`}
        >
          <Code aria-hidden className="size-5" strokeWidth={1.5} />
        </button>
        <span aria-hidden className="mx-1 h-6 w-px bg-border" />
        <Menu
          label="Table"
          disabled={disabled}
          buttonClassName={toolButton}
          trigger={
            <>
              <Table aria-hidden className="size-5" strokeWidth={1.5} />
              <ChevronDown aria-hidden className="size-3" strokeWidth={1.5} />
            </>
          }
          items={[
            {
              key: "insert",
              label: "Insert table",
              onSelect: run((e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
            },
            { key: "row", label: "Add row below", disabled: !state?.table, onSelect: run((e) => e.chain().focus().addRowAfter().run()) },
            {
              key: "column",
              label: "Add column right",
              disabled: !state?.table,
              onSelect: run((e) => e.chain().focus().addColumnAfter().run()),
            },
            { key: "delete-row", label: "Delete row", disabled: !state?.table, onSelect: run((e) => e.chain().focus().deleteRow().run()) },
            {
              key: "delete-column",
              label: "Delete column",
              disabled: !state?.table,
              onSelect: run((e) => e.chain().focus().deleteColumn().run()),
            },
            { key: "delete", label: "Delete table", disabled: !state?.table, onSelect: run((e) => e.chain().focus().deleteTable().run()) },
          ]}
        />
        <button
          type="button"
          aria-label="Image"
          title="Image"
          aria-pressed={imageOpen}
          disabled={disabled}
          onClick={() => setImageOpen(!imageOpen)}
          className={`${toolButton} ${focusRing}`}
        >
          <ImagePlus aria-hidden className="size-5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Checklist"
          title="Checklist"
          aria-pressed={state?.tasks ?? false}
          disabled={disabled}
          onClick={run((e) => e.chain().focus().toggleTaskList().run())}
          className={`${toolButton} ${focusRing}`}
        >
          <ListChecks aria-hidden className="size-5" strokeWidth={1.5} />
        </button>
        <Menu
          label="Insert"
          disabled={disabled}
          buttonClassName={toolButton}
          trigger={
            <>
              <Plus aria-hidden className="size-5" strokeWidth={1.5} />
              <ChevronDown aria-hidden className="size-3" strokeWidth={1.5} />
            </>
          }
          items={[
            { key: "bullets", label: "Bulleted list", onSelect: run((e) => e.chain().focus().toggleBulletList().run()) },
            { key: "numbers", label: "Numbered list", onSelect: run((e) => e.chain().focus().toggleOrderedList().run()) },
            { key: "quote", label: "Quote", onSelect: run((e) => e.chain().focus().toggleBlockquote().run()) },
            { key: "code", label: "Code block", onSelect: run((e) => e.chain().focus().toggleCodeBlock().run()) },
            { key: "divider", label: "Divider", onSelect: run((e) => e.chain().focus().setHorizontalRule().run()) },
          ]}
        />
        {imageOpen && (
          <form onSubmit={insertImage} className="flex w-full flex-wrap items-start gap-2 py-2" aria-label="Insert an image">
            <div className="grid min-w-0 flex-1 gap-1">
              <label htmlFor="artifact-image-url" className="text-sm font-medium">
                Image address
              </label>
              <input
                id="artifact-image-url"
                type="url"
                inputMode="url"
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                aria-invalid={Boolean(imageError)}
                aria-describedby={imageError ? "artifact-image-error" : undefined}
                className={`h-11 w-full rounded-control border bg-surface px-3 text-base text-ink focus:border-accent ${
                  imageError ? "border-danger" : "border-border"
                } ${focusRing}`}
              />
              {imageError && (
                <p id="artifact-image-error" className="text-sm text-danger">
                  {imageError}
                </p>
              )}
            </div>
            <button
              type="submit"
              className={`mt-6 h-11 rounded-control border border-border bg-surface px-4 text-[15px] font-semibold text-ink ${focusRing}`}
            >
              Insert image
            </button>
          </form>
        )}
      </div>
      <div className={CANVAS_CLASS}>
        {header}
        <div className="mt-8">
          <EditorContent editor={editor} />
        </div>
      </div>
    </>
  );
}
