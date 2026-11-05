// The tools Claude may call in the team chat. The deterministic check engine stays the source of
// every finding: Claude runs it and explains the result, it never makes findings up.
import { classifyPages, runCheck } from "../engine";
import type { EngineOptions } from "../engine/types";
import { READ_SITE_REPORT_TOOL, runReadSiteReport } from "../site/chat";
import type { ToolSpec } from "./model";
import { issueReportMarkdown, issueReportTitle, progressiveParts, sheetSetMarkdown, sheetSetTitle } from "./report";
import type { ArtifactKind, ChatProject, ChatStore, StoredSet } from "./store";

export const JURISDICTIONS = [
  "Town of Danville",
  "City of San Ramon",
  "City of Lafayette",
  "City of Walnut Creek",
  "City of Orinda",
  "Town of Moraga",
  "Unincorporated Contra Costa County",
];
export const ADU_TYPES = ["No ADU", "Attached ADU", "Detached ADU", "JADU"];

/** The longest page text read_sheet_text returns, in characters. */
export const MAX_SHEET_CHARS = 20_000;

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "run_permit_check",
    description:
      "Runs the rule-based permit-set check on the PDF uploaded in this chat (California 2025 codes, jurisdiction boilerplate, contradictions, code years, areas, cross-references, title blocks, dates, third-party documents). It writes the issue report to the canvas as a new version and returns a summary of the findings. Leave a field out to use the project's value.",
    input_schema: {
      type: "object",
      properties: {
        jurisdiction: { type: "string", enum: JURISDICTIONS, description: "Check the set as this jurisdiction." },
        adu_type: { type: "string", enum: ADU_TYPES },
        address: { type: "string", description: "The project address, e.g. 428 El Rio Rd, Danville." },
      },
    },
  },
  {
    name: "regenerate_sheets",
    description:
      "Writes the set's cover data and notes sheets again under the 2025 California codes for the project's jurisdiction, and saves them to the canvas as a sheet set. Returns what the architect must still confirm.",
    input_schema: {
      type: "object",
      properties: {
        jurisdiction: { type: "string", enum: JURISDICTIONS },
        adu_type: { type: "string", enum: ADU_TYPES },
        address: { type: "string" },
      },
    },
  },
  {
    name: "read_sheet_text",
    description:
      "Returns the extracted text of one page of the uploaded set, found by sheet number (e.g. A-0.1) or page number. With neither, returns the list of pages and sheets.",
    input_schema: {
      type: "object",
      properties: {
        sheet: { type: "string", description: "Sheet number, e.g. A-2.1 or T-1." },
        page: { type: "integer", minimum: 1 },
      },
    },
  },
  {
    name: "create_or_update_artifact",
    description:
      "Writes a markdown document to the shared canvas: a new one, or a new version of an existing one (pass artifact_id). Use it for plan check responses, letters, checklists, notes and edits to reports. The team sees it live.",
    input_schema: {
      type: "object",
      properties: {
        artifact_id: { type: "string", description: "The document to update. Leave out to create a new one." },
        title: { type: "string" },
        content: { type: "string", description: "The whole document, in markdown." },
        kind: { type: "string", enum: ["document", "issue_report", "sheet_set"] },
      },
      required: ["title", "content"],
    },
  },
  READ_SITE_REPORT_TOOL,
  {
    name: "read_project_document",
    description:
      "Read one of the project's documents: a file the team uploaded (source id doc:…) or an artifact from any chat of the project (source id artifact:…). The source ids are listed under \"Project documents\". Long files return a part at a time: pass pages to read further.",
    input_schema: {
      type: "object",
      properties: {
        source_id: { type: "string", description: "The document's source id, e.g. doc:abc123 or artifact:xyz789." },
        pages: { type: "string", description: "Pages to read, e.g. 3 or 3-8. Leave out to start at the first page." },
      },
      required: ["source_id"],
    },
  },
];

export interface ToolContext {
  store: ChatStore;
  projectId: string;
  chatId: string;
  project: ChatProject;
  set: StoredSet | null;
  /** Who the change is saved for: the person who asked. */
  updatedBy: string;
  /** Called with each artifact a tool writes, so the reply links to it. */
  onArtifact(artifactId: string): void;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

export class ToolInputError extends Error {}

const NO_SET =
  "No permit set is uploaded in this chat. Ask the team to upload the PDF with the + button, then try again.";

function record(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolInputError(`${key} must be text.`);
  return value.trim() || undefined;
}

function engineOptions(input: Record<string, unknown>, ctx: ToolContext): EngineOptions & { aduType: string } {
  const jurisdiction = optionalString(input, "jurisdiction");
  if (jurisdiction && !JURISDICTIONS.includes(jurisdiction)) {
    throw new ToolInputError(`Unknown jurisdiction "${jurisdiction}". Use one of: ${JURISDICTIONS.join(", ")}.`);
  }
  const aduType = optionalString(input, "adu_type");
  if (aduType && !ADU_TYPES.includes(aduType)) {
    throw new ToolInputError(`Unknown ADU type "${aduType}". Use one of: ${ADU_TYPES.join(", ")}.`);
  }
  return {
    jurisdiction: jurisdiction ?? (ctx.set?.project.jurisdiction || ctx.project.jurisdiction || undefined),
    aduType: aduType ?? (ctx.set?.project.aduType || ctx.project.aduType || "No ADU"),
    address: optionalString(input, "address") ?? (ctx.set?.project.address || ctx.project.address || undefined),
  };
}

/** "3" → [3, 3]; "3-8" → [3, 8]. */
function pageRange(raw: string | undefined): [number, number] | null {
  if (!raw) return null;
  const m = raw.match(/^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/);
  if (!m) throw new ToolInputError(`pages must look like 3 or 3-8, not "${raw}".`);
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  if (a < 1 || b < a) throw new ToolInputError(`pages "${raw}" is not a range of pages.`);
  return [a, b];
}

async function readProjectDocument(input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const args = record(input);
  const sourceId = optionalString(args, "source_id");
  if (!sourceId) throw new ToolInputError("source_id is required, e.g. doc:abc123.");
  const [kind, id] = sourceId.split(":", 2) as [string, string | undefined];
  if (!id || (kind !== "doc" && kind !== "artifact")) {
    throw new ToolInputError(`"${sourceId}" is not a source id. Use doc:… or artifact:… from the Project documents list.`);
  }

  if (kind === "artifact") {
    const a = await ctx.store.getArtifact(ctx.projectId, id);
    if (!a) return { content: `No artifact ${sourceId} in this project.`, isError: true };
    const body = a.content.length > MAX_SHEET_CHARS ? `${a.content.slice(0, MAX_SHEET_CHARS)}\n\n[cut at ${MAX_SHEET_CHARS} characters]` : a.content;
    return { content: `# ${a.title} (${a.kind}, version ${a.version})\n\n${body}`, isError: false };
  }

  const doc = await ctx.store.getDocument(ctx.projectId, id);
  if (!doc) return { content: `No uploaded document ${sourceId} in this project.`, isError: true };
  if (doc.pages.length === 0) {
    return {
      content: `${doc.name} (${doc.contentType}) has no text I can read: it may be a scan, an image or a format without text. Ask the team what it shows.`,
      isError: false,
    };
  }
  const range = pageRange(optionalString(args, "pages"));
  const wanted = range ? doc.pages.filter((p) => p.page >= range[0] && p.page <= range[1]) : doc.pages;
  if (wanted.length === 0) return { content: `${doc.name} has pages 1 to ${doc.pages.length}; none in ${args.pages}.`, isError: true };

  const out: string[] = [`# ${doc.name} (${doc.pages.length} ${doc.pages.length === 1 ? "page" : "pages"}${doc.truncated ? ", text cut short when uploaded" : ""})`];
  let used = 0;
  let last = 0;
  for (const p of wanted) {
    const block = `\n--- Page ${p.page} ---\n${p.text.trim() || "(no text on this page)"}`;
    if (used + block.length > MAX_SHEET_CHARS && last > 0) break;
    out.push(block.length > MAX_SHEET_CHARS ? `${block.slice(0, MAX_SHEET_CHARS)}\n[page cut short]` : block);
    used += block.length;
    last = p.page;
  }
  const end = wanted[wanted.length - 1]!.page;
  if (last < end) out.push(`\n[Stopped after page ${last} to keep the answer short. Read pages ${last + 1}-${end} next.]`);
  return { content: out.join("\n"), isError: false };
}

/** Writes the document a part at a time, then saves it as the next version. */
async function writeArtifact(
  ctx: ToolContext,
  input: { artifactId?: string; title: string; content: string; kind: ArtifactKind },
): Promise<{ artifactId: string; version: number }> {
  const { store, projectId, chatId, updatedBy } = ctx;
  const artifactId =
    input.artifactId ?? (await store.createArtifact(projectId, { title: input.title, kind: input.kind, chatId, updatedBy }));
  ctx.onArtifact(artifactId);
  try {
    const parts = progressiveParts(input.content);
    for (const part of parts.slice(0, -1)) {
      await store.updateArtifact(projectId, artifactId, { title: input.title, content: part, status: "generating", updatedBy });
    }
    const version = await store.commitVersion(projectId, artifactId, {
      title: input.title,
      content: input.content,
      updatedBy,
      chatId,
    });
    return { artifactId, version };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store
      .updateArtifact(projectId, artifactId, { status: "error", error: message, updatedBy })
      .catch(() => undefined);
    throw error;
  }
}

async function latestOfKind(ctx: ToolContext, kind: ArtifactKind): Promise<string | undefined> {
  const all = await ctx.store.listChatArtifacts(ctx.projectId, ctx.chatId);
  return all.find((a) => a.kind === kind)?.id;
}

async function runPermitCheck(raw: unknown, ctx: ToolContext): Promise<string> {
  if (!ctx.set) return NO_SET;
  const options = engineOptions(record(raw), ctx);
  const result = runCheck(ctx.set.pages, options);
  const project = { address: options.address ?? "", jurisdiction: options.jurisdiction ?? "", aduType: options.aduType };
  const { artifactId, version } = await writeArtifact(ctx, {
    artifactId: await latestOfKind(ctx, "issue_report"),
    title: issueReportTitle(project),
    content: issueReportMarkdown(result, project, ctx.set.fileName),
    kind: "issue_report",
  });
  return JSON.stringify({
    artifact_id: artifactId,
    version,
    checked_as: project,
    rules: result.pack_name,
    code_cycle: result.code_cycle,
    pages: result.pages.length,
    findings_total: result.findings.length,
    counts: result.counts,
    jurisdiction: result.jurisdiction ?? null,
    findings: result.findings.slice(0, 25).map((f) => ({
      rule: f.rule_id,
      severity: f.severity,
      sheet: f.sheets[0] ?? "Whole set",
      issue: f.title,
      fix: f.suggested_fix,
    })),
    more_findings: Math.max(0, result.findings.length - 25),
    missing: result.missing.map((m) => m.item),
  });
}

async function regenerate(raw: unknown, ctx: ToolContext): Promise<string> {
  if (!ctx.set) return NO_SET;
  const options = engineOptions(record(raw), ctx);
  const regenerated = runCheck(ctx.set.pages, options).regenerated;
  if (!regenerated) {
    return "The set has no architectural cover sheet, so the sheets cannot be regenerated.";
  }
  const { artifactId, version } = await writeArtifact(ctx, {
    artifactId: await latestOfKind(ctx, "sheet_set"),
    title: sheetSetTitle(regenerated),
    content: sheetSetMarkdown(regenerated),
    kind: "sheet_set",
  });
  return JSON.stringify({
    artifact_id: artifactId,
    version,
    sheets: regenerated.sheets.map((s) => `${s.sheet} ${s.title}`),
    to_confirm: regenerated.to_confirm,
    still_to_check: regenerated.findings.map((f) => `${f.sheets[0] ?? "Whole set"}: ${f.title}`),
  });
}

export function sheetIndex(set: StoredSet): Array<{ page: number; sheet: string | null; title: string | null }> {
  return classifyPages(set.pages).pages.map((p) => ({ page: p.page, sheet: p.label || p.sheet || null, title: p.title || null }));
}

function readSheet(raw: unknown, ctx: ToolContext): string {
  if (!ctx.set) return NO_SET;
  const input = record(raw);
  const sheet = optionalString(input, "sheet")?.toUpperCase();
  const page = input.page === undefined ? undefined : Number(input.page);
  const pages = classifyPages(ctx.set.pages).pages;
  if (!sheet && page === undefined) {
    return JSON.stringify({ file: ctx.set.fileName, pages: sheetIndex(ctx.set) });
  }
  const found =
    page !== undefined && Number.isFinite(page)
      ? pages.find((p) => p.page === page)
      : pages.find((p) => p.sheet.toUpperCase() === sheet || p.label.toUpperCase() === sheet);
  if (!found) {
    return `No page matches ${sheet ? `sheet ${sheet}` : `page ${page}`}. Call read_sheet_text with no input to list the pages.`;
  }
  const text = found.text.length > MAX_SHEET_CHARS ? `${found.text.slice(0, MAX_SHEET_CHARS)}\n[… text cut at ${MAX_SHEET_CHARS} characters]` : found.text;
  return `Page ${found.page} · sheet ${found.label} · ${found.title}\n\n${text}`;
}

async function createOrUpdate(raw: unknown, ctx: ToolContext): Promise<string> {
  const input = record(raw);
  const title = optionalString(input, "title");
  const content = typeof input.content === "string" ? input.content : "";
  if (!title) throw new ToolInputError("title is required.");
  if (!content.trim()) throw new ToolInputError("content is required.");
  const artifactId = optionalString(input, "artifact_id");
  const kindInput = optionalString(input, "kind");
  const kind: ArtifactKind = kindInput === "issue_report" || kindInput === "sheet_set" ? kindInput : "document";
  if (artifactId) {
    const existing = await ctx.store.getArtifact(ctx.projectId, artifactId);
    if (!existing) throw new ToolInputError(`No document ${artifactId} in this project.`);
  }
  const saved = await writeArtifact(ctx, { artifactId, title, content, kind });
  return JSON.stringify({ artifact_id: saved.artifactId, version: saved.version, title });
}

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "run_permit_check":
        return { content: await runPermitCheck(input, ctx), isError: false };
      case "regenerate_sheets":
        return { content: await regenerate(input, ctx), isError: false };
      case "read_sheet_text":
        return { content: readSheet(input, ctx), isError: false };
      case "create_or_update_artifact":
        return { content: await createOrUpdate(input, ctx), isError: false };
      case "read_site_report":
        return runReadSiteReport(() => ctx.store.getSiteReport(ctx.projectId));
      case "read_project_document":
        return await readProjectDocument(input, ctx);
      default:
        return { content: `Unknown tool ${name}.`, isError: true };
    }
  } catch (error) {
    return { content: error instanceof Error ? error.message : String(error), isError: true };
  }
}
