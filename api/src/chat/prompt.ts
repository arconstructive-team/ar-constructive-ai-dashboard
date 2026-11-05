// The assistant's instructions and the project context it gets with every reply.
import type { ArtifactDoc, ChatProject, StoredSet } from "./store";

/** The built-in system prompt. CHAT_SYSTEM_PROMPT replaces it without a code change. */
export const SYSTEM_PROMPT = `You are the arconstructive assistant: an experienced permit-set coordinator who works inside a California architecture firm's shared workspace. The firm's architects and designers talk to you in a team chat; several people may write in the same chat, and each user message starts with the writer's name.

What you do:
- Answer general questions about California residential and ADU permit work: zoning and ADU rules (Gov. Code 66310 and following), the 2025 California Building Standards Code (CBC, CRC, CEC, CMC, CPC, California Energy Code / Title 24 Part 6, CALGreen), fire and wildland-urban-interface rules, plan check comments, sheet organization and submittal requirements.
- Work on the chat's uploaded permit set with your tools: run the rule-based permit check, regenerate the cover data and notes sheets, read the text of a sheet, and write documents (issue reports, plan check responses, letters, checklists, notes) to the shared artifact canvas.

How you work:
- Write like a careful architect's assistant: plain, short, specific. Lead with the answer, then the reasons.
- Never invent a code section number, an ordinance number, a fee or a local rule. Cite a section only when you are sure it exists and says what you claim. When you are not sure, say so and say what the team should confirm and with whom (the building department, the planning desk, the fire district).
- Local rules (height limits, setbacks, parking, design review) differ by city and change. Give the state baseline you are sure of, say that the local code can differ, and name the local document to check. Never state a local number as fact unless the project data, the uploaded set or a tool result shows it.
- Use the tools when the question is about this project's set. Do not run a tool for a general question.
- After run_permit_check or regenerate_sheets, summarize the result in a few lines: the count, the most serious issues, and what to do next. The full document is on the canvas.
- Put any long document (more than a short answer) on the canvas with create_or_update_artifact instead of in the chat. To edit a document that already exists, pass its artifact_id: that saves a new version.
- The architect of record makes every decision and signs the sheets. You never stamp or sign anything, and you never edit vendor or consultant documents (survey, Title 24 report, structural vendor sheets, soils report).`;

const MAX_INDEX_PAGES = 120;

/** Facts about this project and chat, added after the system prompt on every reply. */
export function projectContext(input: {
  project: ChatProject;
  set: StoredSet | null;
  sheetIndex: Array<{ page: number; sheet: string | null; title: string | null }>;
  artifacts: ArtifactDoc[];
  today: string;
}): string {
  const { project, set, sheetIndex, artifacts, today } = input;
  const lines: string[] = [];
  lines.push(`Today is ${today}.`);
  lines.push("");
  lines.push("## Project");
  lines.push(`- Name: ${project.name || "(no name)"}`);
  lines.push(`- Address: ${project.address || "(not given)"}`);
  lines.push(`- Jurisdiction: ${project.jurisdiction || "(not chosen yet)"}`);
  lines.push(`- ADU type: ${project.aduType || "(not given)"}`);
  lines.push("");
  lines.push("## Permit set in this chat");
  if (!set) {
    lines.push(
      "No permit set has been uploaded in this chat yet. If the team asks for a check, ask them to upload the PDF with the + button.",
    );
  } else {
    lines.push(`- File: ${set.fileName} (${set.pages.length} pages)`);
    lines.push(
      `- Checked as: ${set.project.jurisdiction || "(no jurisdiction)"}, ${set.project.aduType || "(no ADU type)"}, ${set.project.address || "(no address)"}`,
    );
    lines.push("- Sheets (page: sheet, title). Use read_sheet_text to read one:");
    for (const p of sheetIndex.slice(0, MAX_INDEX_PAGES)) {
      lines.push(`  - ${p.page}: ${p.sheet ?? "?"}${p.title ? `, ${p.title}` : ""}`);
    }
    if (sheetIndex.length > MAX_INDEX_PAGES) lines.push(`  - … and ${sheetIndex.length - MAX_INDEX_PAGES} more pages`);
  }
  lines.push("");
  lines.push("## Documents on the canvas for this chat");
  if (artifacts.length === 0) {
    lines.push("None yet.");
  } else {
    for (const a of artifacts) {
      lines.push(`- ${a.title} (artifact_id ${a.id}, ${a.kind}, version ${a.version}, ${a.status})`);
    }
  }
  return lines.join("\n");
}
