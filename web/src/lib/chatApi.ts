/**
 * The web side of the team chat assistant. The browser never talks to Claude and never holds an
 * Anthropic key: it asks the chat API on Cloud Run (VITE_CHAT_API_URL) to answer a chat, with the
 * signed-in user's Firebase ID token. The server streams the reply back and also saves it to the
 * shared chat, so every teammate sees it through Firestore.
 */

export const CHAT_API_URL = (import.meta.env.VITE_CHAT_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";

export interface ChatTarget {
  projectId: string;
  chatId: string;
}

export interface ChatHandlers {
  onText?(delta: string): void;
  onTool?(name: string): void;
}

export interface ChatReply {
  messageId: string;
  artifactIds: string[];
}

export class ChatApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ChatApi {
  /** Asks the assistant to answer the newest messages of the chat. */
  send(target: ChatTarget, handlers?: ChatHandlers): Promise<ChatReply>;
}

/** Reads server-sent events ("event: x\ndata: {...}\n\n") from a stream of text chunks. */
export function createSseParser(onEvent: (name: string, data: unknown) => void) {
  let buffer = "";
  const flush = (block: string) => {
    let name = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) return;
    try {
      onEvent(name, JSON.parse(data.join("\n")));
    } catch {
      onEvent(name, data.join("\n"));
    }
  };
  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n/g, "\n");
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        flush(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
      }
    },
    end() {
      if (buffer.trim()) flush(buffer);
      buffer = "";
    },
  };
}

export function createChatApi(options: {
  baseUrl: string;
  getIdToken: () => Promise<string>;
  fetch?: typeof fetch;
}): ChatApi {
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const base = options.baseUrl.replace(/\/+$/, "");
  return {
    async send(target, handlers = {}) {
      if (!base) throw new ChatApiError(503, "The chat assistant is not set up for this site yet.");
      const token = await options.getIdToken();
      const res = await doFetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(target),
      });
      if (!res.ok) {
        let message = "The assistant could not answer. Try again.";
        try {
          const body = (await res.json()) as { error?: unknown };
          if (typeof body.error === "string") message = body.error;
        } catch {
          // Keep the general message.
        }
        throw new ChatApiError(res.status, message);
      }

      const state: { reply: ChatReply | null; failure: string | null } = { reply: null, failure: null };
      const parser = createSseParser((name, data) => {
        const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
        if (name === "text" && typeof d.delta === "string") handlers.onText?.(d.delta);
        else if (name === "tool" && typeof d.name === "string") handlers.onTool?.(d.name);
        else if (name === "done" && typeof d.messageId === "string") {
          state.reply = {
            messageId: d.messageId,
            artifactIds: Array.isArray(d.artifactIds) ? d.artifactIds.filter((a): a is string => typeof a === "string") : [],
          };
        } else if (name === "error") state.failure = typeof d.error === "string" ? d.error : "The assistant stopped.";
      });

      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.push(decoder.decode());
      } else {
        parser.push(await res.text());
      }
      parser.end();
      if (state.failure) throw new ChatApiError(500, state.failure);
      if (!state.reply) throw new ChatApiError(502, "The assistant's reply was cut off. Try again.");
      return state.reply;
    },
  };
}
