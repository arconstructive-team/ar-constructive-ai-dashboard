import type { ReactNode } from "react";
import { plainText, type Align, type Block, type Inline } from "./markdown";

/** The document column: reading width, centred, with page-like margins. */
export const CANVAS_CLASS = "mx-auto w-full max-w-[760px] px-4 pt-10 pb-16 md:px-10 md:pt-14";

const SAFE_HREF = /^(https?:|mailto:|#|\/)/i;

function renderInline(content: Inline[]): ReactNode[] {
  return content.map((node, index) => {
    if (node.type === "break") return <br key={index} />;
    let out: ReactNode = node.text;
    if (node.code) out = <code>{out}</code>;
    if (node.strike) out = <s>{out}</s>;
    if (node.italic) out = <em>{out}</em>;
    if (node.bold) out = <strong>{out}</strong>;
    if (node.href !== undefined && SAFE_HREF.test(node.href)) {
      out = (
        <a href={node.href} target="_blank" rel="noreferrer noopener">
          {out}
        </a>
      );
    }
    return <span key={index}>{out}</span>;
  });
}

const alignStyle = (align: Align) => (align ? { textAlign: align } : undefined);

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case "heading": {
      // Same tags as the editor, so the view and the editor share one style sheet.
      const Tag = `h${block.level}` as "h2";
      return (
        <Tag key={key}>
          {renderInline(block.content)}
        </Tag>
      );
    }
    case "paragraph":
      return <p key={key}>{renderInline(block.content)}</p>;
    case "list":
      return block.ordered ? (
        <ol key={key} start={block.start}>
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key}>
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case "tasks":
      return (
        <ul key={key} data-type="taskList">
          {block.items.map((item, index) => (
            <li key={index} data-checked={item.checked}>
              <label>
                <input type="checkbox" checked={item.checked} readOnly disabled aria-label={plainText(item.content)} />
              </label>
              <div>{renderInline(item.content)}</div>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div key={key} className="tableWrapper">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} scope="col" style={alignStyle(block.align[index])}>
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} style={alignStyle(block.align[index])}>
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return <blockquote key={key}>{renderInline(block.content)}</blockquote>;
    case "rule":
      return <hr key={key} />;
    case "image":
      return SAFE_HREF.test(block.src) ? <img key={key} src={block.src} alt={block.alt} loading="lazy" /> : null;
  }
}

/**
 * The artifact body in the document style. While `streaming`, a caret marks
 * where the text is being written.
 */
export function DocumentView({ blocks, streaming = false }: { blocks: Block[]; streaming?: boolean }) {
  return (
    <div className="artifact-doc" data-streaming={streaming || undefined}>
      {blocks.map(renderBlock)}
      {streaming && <span aria-hidden className="artifact-caret" />}
    </div>
  );
}
