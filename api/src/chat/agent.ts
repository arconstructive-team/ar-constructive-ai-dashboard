// One assistant reply in the team chat: read the chat, ask Claude, run the tools it calls, and
// write the reply into the shared chat while it streams, so every teammate sees it.
import type { ChatUser } from "./auth";
import type { ChatConfig } from "./config";
import { isText, isToolUse, type ModelClient, type ModelMessage, type ToolResultBlock } from "./model";
import { projectContext } from "./prompt";
import type { ChatStore, StoredMessage } from "./store";
import { TOOL_SPECS, runTool, sheetIndex, type ToolContext } from "./tools";

/** The assistant's name on its chat messages (the same as the workspace's built-in replies). */
export const ASSISTANT_AUTHOR = "arconstructive";
/** How often the streaming reply is saved to the shared chat, in milliseconds. */
export const SAVE_EVERY_MS = 300;

export class ChatError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ChatDeps {
  store: ChatStore;
  model: ModelClient;
  config: ChatConfig;
  now?: () => Date;
}

export interface ChatRequest {
  projectId: string;
  chatId: string;
  user: ChatUser;
}

export interface ChatEvents {
  onText?(delta: string): void;
  onTool?(name: string): void;
}

export interface ChatResult {
  messageId: string;
  text: string;
  artifactIds: string[];
}

/** Chat messages as Claude's conversation: user turns carry the writer's name. */
export function toModelMessages(history: StoredMessage[]): ModelMessage[] {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of history) {
    const text = m.text.trim();
    if (!text) continue;
    const attached = m.sources?.length
      ? `\n\n[Attached project documents: ${m.sources.map((src) => `${src.name} (source id ${src.id})`).join("; ")}]`
      : "";
    const content = m.role === "user" ? `${m.author || "Teammate"}: ${text}${attached}` : text;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${content}`;
    else out.push({ role: m.role, content });
  }
  while (out[0]?.role === "assistant") out.shift();
  return out;
}

export async function runChatTurn(deps: ChatDeps, req: ChatRequest, events: ChatEvents = {}): Promise<ChatResult> {
  const { store, model, config } = deps;
  const { projectId, chatId, user } = req;
  const project = await store.getProject(projectId);
  if (!project || !(await store.chatExists(projectId, chatId))) throw new ChatError(404, "This chat does not exist.");

  const history = await store.listMessages(projectId, chatId, config.historyMessages);
  const messages = toModelMessages(history);
  if (messages.length === 0 || messages[messages.length - 1]!.role !== "user") {
    throw new ChatError(409, "The chat has no new message to answer.");
  }

  const [set, artifacts, documents, projectArtifacts] = await Promise.all([
    store.latestSet(projectId, chatId),
    store.listChatArtifacts(projectId, chatId),
    store.listDocuments(projectId),
    store.listProjectArtifacts(projectId),
  ]);
  const context = projectContext({
    project,
    set,
    sheetIndex: set ? sheetIndex(set) : [],
    artifacts,
    documents,
    projectArtifacts,
    today: (deps.now?.() ?? new Date()).toISOString().slice(0, 10),
  });

  const messageId = await store.addMessage(projectId, chatId, {
    role: "assistant",
    text: "",
    author: ASSISTANT_AUTHOR,
    streaming: true,
  });

  const artifactIds: string[] = [];
  const toolCtx: ToolContext = {
    store,
    projectId,
    chatId,
    project,
    set,
    updatedBy: user.email,
    onArtifact(id) {
      if (!artifactIds.includes(id)) artifactIds.push(id);
    },
  };

  let full = "";
  let roundStarted = false;
  let lastSave = 0;
  let saving: Promise<void> = Promise.resolve();
  const save = () => {
    saving = saving.then(() => store.updateMessage(projectId, chatId, messageId, { text: full })).catch(() => undefined);
  };
  const onText = (delta: string) => {
    let piece = delta;
    if (!roundStarted) {
      roundStarted = true;
      if (full && !full.endsWith("\n\n")) piece = `\n\n${piece.replace(/^\n+/, "")}`;
    }
    full += piece;
    events.onText?.(piece);
    const now = Date.now();
    if (now - lastSave >= SAVE_EVERY_MS) {
      lastSave = now;
      save();
    }
  };

  try {
    let finished = false;
    for (let round = 0; round < config.maxToolRounds && !finished; round += 1) {
      roundStarted = false;
      const response = await model.stream(
        {
          model: config.model,
          max_tokens: config.maxTokens,
          system: [config.systemPrompt, context],
          messages,
          tools: TOOL_SPECS,
        },
        onText,
      );
      if (!roundStarted) {
        // A model client that does not stream still returns its text blocks.
        const text = response.content.filter(isText).map((b) => b.text).join("");
        if (text) onText(text);
      }
      const calls = response.content.filter(isToolUse);
      if (response.stop_reason !== "tool_use" || calls.length === 0) {
        if (response.stop_reason === "max_tokens") onText("\n\n_(The reply reached its length limit.)_");
        finished = true;
        break;
      }
      messages.push({ role: "assistant", content: response.content });
      const results: ToolResultBlock[] = [];
      for (const call of calls) {
        events.onTool?.(call.name);
        const outcome = await runTool(call.name, call.input, toolCtx);
        results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
    }
    if (!finished) {
      roundStarted = true;
      onText(`${full ? "\n\n" : ""}_(I stopped after ${config.maxToolRounds} tool steps. Ask me to continue.)_`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    full += `${full ? "\n\n" : ""}_The assistant could not finish this reply: ${reason}_`;
    await saving;
    await store
      .updateMessage(projectId, chatId, messageId, { text: full, streaming: false })
      .catch(() => undefined);
    throw error;
  }

  await saving;
  const last = artifactIds[artifactIds.length - 1];
  await store.updateMessage(projectId, chatId, messageId, {
    text: full.trim() || "_(No reply.)_",
    streaming: false,
    ...(last ? { artifactId: last } : {}),
  });
  return { messageId, text: full.trim(), artifactIds };
}
