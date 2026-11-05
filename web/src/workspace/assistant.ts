// The chat assistant. Text messages go to Claude through the chat API (ARCO-15), which answers
// in the shared chat and runs the check engine (ARCO-8) and the sheet regeneration (ARCO-10) as
// tools. Uploads stay in the browser: the PDF is read and checked here, and the set is saved to
// the chat so Claude and every team member can work on it.
import { runCheck, type CheckResult, type PageText } from "../lib/engine";
import { ChatApiError, type ChatApi } from "../lib/chatApi";
import { checkSetFile, formatBytes, readHeader, type ProjectData } from "../lib/project";
import { HELP_TEXT, applyChanges, hasChanges, readInstruction } from "./intent";
import { issueReportMarkdown, issueReportTitle, progressiveParts, sheetSetMarkdown, sheetSetTitle } from "./report";
import type { ArtifactKind, Message, WorkspaceArtifact, WorkspaceStore } from "./types";

/** The name the generator writes under, in messages and artifact versions. */
export const ASSISTANT_NAME = "arconstructive";

export interface AssistantDeps {
  store: WorkspaceStore;
  /**
   * The chat API (Claude on the server). When it is set, every text message goes to it.
   * Without it (no VITE_CHAT_API_URL, or tests), the keyword commands answer.
   */
  chat?: ChatApi;
  extractPages?: (file: File) => Promise<PageText[]>;
  check?: (pages: PageText[], project: ProjectData) => CheckResult;
  pause?: (ms: number) => Promise<void>;
  /** Time between the parts of a document while it is written. */
  stepMs?: number;
}

export interface ChatContext {
  projectId: string;
  chatId: string;
  /** The project data the chat checks sets against. */
  project: ProjectData;
  /** The signed-in person's name, written on their messages. */
  author: string;
  /** The chat's messages as the screen shows them, oldest first. */
  messages: Message[];
}

/** A set checked in this chat: its text, the project data it was checked with and the result. */
export interface ChatSet {
  setId: string | null;
  fileName: string;
  pages: PageText[];
  project: ProjectData;
  result: CheckResult;
  /** The PDF itself, only in the browser that uploaded it (for the page previews). */
  file?: File;
}

const extractInBrowser = async (file: File) => {
  const { extractPagesInBrowser } = await import("../lib/pdf");
  return extractPagesInBrowser(file);
};

const engineCheck = (pages: PageText[], project: ProjectData) =>
  runCheck(pages, { jurisdiction: project.jurisdiction, aduType: project.aduType, address: project.address.trim() });

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export class Assistant {
  private readonly store: WorkspaceStore;
  private readonly chat: ChatApi | undefined;
  private readonly extractPages: (file: File) => Promise<PageText[]>;
  private readonly check: (pages: PageText[], project: ProjectData) => CheckResult;
  private readonly pause: (ms: number) => Promise<void>;
  private readonly stepMs: number;
  private readonly sets = new Map<string, ChatSet>();

  constructor(deps: AssistantDeps) {
    this.store = deps.store;
    this.chat = deps.chat;
    this.extractPages = deps.extractPages ?? extractInBrowser;
    this.check = deps.check ?? engineCheck;
    this.pause = deps.pause ?? wait;
    this.stepMs = deps.stepMs ?? 250;
  }

  /** The set this browser checked in the chat, with its PDF, when there is one. */
  sessionSet(chatId: string): ChatSet | undefined {
    return this.sets.get(chatId);
  }

  private say(ctx: ChatContext, text: string, artifactId?: string) {
    return this.store.addMessage(ctx.projectId, ctx.chatId, {
      role: "assistant",
      text,
      author: ASSISTANT_NAME,
      ...(artifactId ? { artifactId } : {}),
    });
  }

  /** Writes the document a part at a time while status is "generating", then saves it as a new version. */
  private async write(ctx: ChatContext, artifactId: string, title: string, markdown: string): Promise<number> {
    for (const part of progressiveParts(markdown)) {
      await this.store.updateArtifact(ctx.projectId, artifactId, { status: "generating", title, content: part });
      await this.pause(this.stepMs);
    }
    return this.store.commitVersion(ctx.projectId, artifactId, { title, content: markdown, updatedBy: ASSISTANT_NAME });
  }

  private async fail(ctx: ChatContext, artifactId: string, message: string) {
    await this.store.updateArtifact(ctx.projectId, artifactId, { status: "error", error: message }).catch(() => undefined);
    await this.say(ctx, `The work stopped: ${message}`, artifactId);
  }

  /** Uploading a PDF in the chat: check it and write an issue report. */
  async upload(ctx: ChatContext, file: File): Promise<void> {
    await this.store.addMessage(ctx.projectId, ctx.chatId, {
      role: "user",
      text: `Uploaded ${file.name} (${formatBytes(file.size)})`,
      author: ctx.author,
    });

    let problem: string | null;
    try {
      problem = checkSetFile(file, await readHeader(file));
    } catch {
      problem = "We could not read this file. Check that it is not open in another program, then choose it again.";
    }
    if (problem) {
      await this.say(ctx, problem);
      return;
    }
    if (!ctx.project.jurisdiction) {
      await this.say(ctx, "This project has no jurisdiction yet. Name one, for example \"check it as Danville\", then upload the set again.");
      return;
    }

    const title = issueReportTitle(ctx.project);
    const artifactId = await this.store.createArtifact(ctx.projectId, {
      title,
      kind: "issue_report",
      chatId: ctx.chatId,
      updatedBy: ASSISTANT_NAME,
      content: `# ${title}\n\nReading ${file.name}…\n`,
    });
    await this.say(ctx, `I am checking ${file.name} as ${ctx.project.jurisdiction}. The issue report fills in on the right as I write it.`, artifactId);

    try {
      const pages = await this.extractPages(file);
      await this.store.updateArtifact(ctx.projectId, artifactId, {
        content: `# ${title}\n\nRead ${pages.length} pages. Running the rules…\n`,
      });
      const result = this.check(pages, ctx.project);
      const version = await this.write(ctx, artifactId, title, issueReportMarkdown(result, ctx.project, file.name));

      let setId: string | null = null;
      let kept = "";
      try {
        setId = await this.store.saveSet(ctx.projectId, ctx.chatId, { fileName: file.name, pages, project: ctx.project });
      } catch {
        kept = " The set is too large to keep for the team, so follow-up requests work only in this browser.";
      }
      this.sets.set(ctx.chatId, { setId, fileName: file.name, pages, project: ctx.project, result, file });

      const count = result.findings.length;
      await this.say(
        ctx,
        `The check found ${count} ${count === 1 ? "issue" : "issues"} in ${result.pages.length} pages (version ${version}). ` +
          `Write "regenerate the sheets" for new cover data and notes sheets.${kept}`,
        artifactId,
      );
    } catch (err) {
      await this.fail(ctx, artifactId, errorText(err, "The check failed. Check that the PDF opens in a PDF reader, then upload it again."));
    }
  }

  private async loadSet(ctx: ChatContext): Promise<ChatSet | null> {
    const cached = this.sets.get(ctx.chatId);
    if (cached) return cached;
    const stored = await this.store.latestSet(ctx.projectId, ctx.chatId);
    if (!stored) return null;
    const set: ChatSet = {
      setId: stored.id,
      fileName: stored.fileName,
      pages: stored.pages,
      project: stored.project,
      result: this.check(stored.pages, stored.project),
    };
    this.sets.set(ctx.chatId, set);
    return set;
  }

  /** The chat's artifacts, newest first, as its messages name them. */
  private async chatArtifacts(ctx: ChatContext): Promise<WorkspaceArtifact[]> {
    const ids: string[] = [];
    for (const m of [...ctx.messages].reverse()) {
      if (m.artifactId && !ids.includes(m.artifactId)) ids.push(m.artifactId);
    }
    const found = await Promise.all(ids.map((id) => this.store.getArtifact(ctx.projectId, id)));
    return found.filter((a): a is WorkspaceArtifact => a !== null);
  }

  /** Writes the artifact of this kind: a new version of the chat's latest one, or a new artifact. */
  private async writeKind(
    ctx: ChatContext,
    kind: Extract<ArtifactKind, "issue_report" | "sheet_set">,
    existing: WorkspaceArtifact | undefined,
    set: ChatSet,
  ): Promise<{ artifactId: string; version: number; title: string } | null> {
    let title: string;
    let markdown: string;
    if (kind === "sheet_set") {
      const regenerated = set.result.regenerated;
      if (!regenerated || regenerated.sheets.length === 0) {
        await this.say(ctx, "No sheets were regenerated. We need an architectural cover sheet (A-0.1) in the set to read the project data from.");
        return null;
      }
      title = sheetSetTitle(regenerated);
      markdown = sheetSetMarkdown(regenerated);
    } else {
      title = issueReportTitle(set.project);
      markdown = issueReportMarkdown(set.result, set.project, set.fileName);
    }

    if (existing && existing.status === "generating") {
      await this.say(ctx, `${existing.title} is still being written. Send the request again when it finishes.`, existing.id);
      return null;
    }

    const artifactId =
      existing?.id ??
      (await this.store.createArtifact(ctx.projectId, {
        title,
        kind,
        chatId: ctx.chatId,
        updatedBy: ASSISTANT_NAME,
        content: `# ${title}\n\nWriting…\n`,
      }));
    try {
      const version = await this.write(ctx, artifactId, title, markdown);
      return { artifactId, version, title };
    } catch (err) {
      await this.fail(ctx, artifactId, errorText(err, "The document could not be saved. Try again."));
      return null;
    }
  }

  /**
   * Asks Claude (the chat API) to answer the chat. The server streams the reply into the shared
   * chat itself, so every team member sees it grow. A request the server refused never reached
   * the chat, so this browser says why.
   */
  private async askClaude(ctx: ChatContext, chat: ChatApi): Promise<void> {
    try {
      await chat.send({ projectId: ctx.projectId, chatId: ctx.chatId });
    } catch (err) {
      // Status 500 is a failure the server already wrote into its reply message.
      if (err instanceof ChatApiError && err.status === 500) return;
      await this.say(ctx, `The assistant could not answer: ${errorText(err, "try again")}`);
    }
  }

  /** A text message: Claude answers it; without the chat API, the keyword commands do. */
  async send(ctx: ChatContext, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    await this.store.addMessage(ctx.projectId, ctx.chatId, { role: "user", text: trimmed, author: ctx.author });

    if (this.chat) {
      await this.askClaude(ctx, this.chat);
      return;
    }

    let set: ChatSet | null;
    try {
      set = await this.loadSet(ctx);
    } catch (err) {
      await this.say(ctx, `I could not read the set of this chat: ${errorText(err, "try again")}.`);
      return;
    }

    const instruction = readInstruction(trimmed, set?.result.jurisdiction?.detected ?? null);
    const wantsWork = instruction.regenerate || hasChanges(instruction);
    if (!set) {
      await this.say(ctx, wantsWork ? "Upload the permit set PDF here first: select + and choose the file. Then ask again." : HELP_TEXT);
      return;
    }
    if (!wantsWork) {
      await this.say(ctx, HELP_TEXT);
      return;
    }

    const artifacts = await this.chatArtifacts(ctx);
    const latestOf = (kind: ArtifactKind) => artifacts.find((a) => a.kind === kind);

    if (hasChanges(instruction)) {
      const { project, said } = applyChanges(set.project, instruction.changes);
      if (said.length === 0) {
        await this.say(ctx, "The set was already checked with those settings. Nothing changed.");
        return;
      }
      const result = this.check(set.pages, project);
      const next: ChatSet = { ...set, project, result };
      this.sets.set(ctx.chatId, next);
      if (next.setId) {
        await this.store.updateSetProject(ctx.projectId, ctx.chatId, next.setId, project).catch(() => undefined);
      }

      // The follow-up edits the artifact the message is about: the sheets, or the open artifact.
      const target =
        instruction.regenerate || instruction.aboutSheets
          ? (latestOf("sheet_set") ?? (instruction.regenerate ? undefined : artifacts[0]))
          : (artifacts[0] ?? latestOf("issue_report"));
      const kind = target?.kind === "sheet_set" || (!target && instruction.regenerate) ? "sheet_set" : "issue_report";
      const done = await this.writeKind(ctx, kind, target, next);
      if (!done) return;
      const count = result.findings.length;
      await this.say(
        ctx,
        `I changed the ${said.join(" and the ")} and checked the set again: ${count} ${count === 1 ? "issue" : "issues"}. ` +
          `${done.title} is now version ${done.version}.`,
        done.artifactId,
      );
      return;
    }

    const done = await this.writeKind(ctx, "sheet_set", latestOf("sheet_set"), set);
    if (!done) return;
    const sheets = set.result.regenerated?.sheets.map((s) => s.sheet).join(", ") ?? "";
    await this.say(
      ctx,
      `I regenerated ${sheets} for ${set.project.jurisdiction} (version ${done.version}). Check the list at the end before you issue them.`,
      done.artifactId,
    );
  }
}
