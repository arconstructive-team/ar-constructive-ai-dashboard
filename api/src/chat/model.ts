// The one place that talks to Claude (Anthropic Messages API). The agent loop uses the small
// ModelClient interface, so tests replace Claude with a scripted model and need no key.
import Anthropic from "@anthropic-ai/sdk";

export interface TextBlock {
  type: "text";
  text: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
/** Other blocks (thinking, server tools) go back to the API unchanged. */
export interface OtherBlock {
  type: string;
  [key: string]: unknown;
}
export type ContentBlock = TextBlock | ToolUseBlock | OtherBlock;

export interface ModelMessage {
  role: "user" | "assistant";
  content: string | Array<ContentBlock | ToolResultBlock>;
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface ModelRequest {
  model: string;
  max_tokens: number;
  /** The system prompt, then the project context. */
  system: string[];
  messages: ModelMessage[];
  tools: ToolSpec[];
}

export interface ModelResponse {
  content: ContentBlock[];
  stop_reason: string | null;
}

export interface ModelClient {
  /** Streams one reply; onText gets each piece of text as it arrives. */
  stream(request: ModelRequest, onText: (delta: string) => void): Promise<ModelResponse>;
}

export function isToolUse(block: ContentBlock): block is ToolUseBlock {
  return block.type === "tool_use";
}

export function isText(block: ContentBlock): block is TextBlock {
  return block.type === "text";
}

/** Claude through the official SDK. The key never leaves the server. */
export function anthropicModel(apiKey: string): ModelClient {
  const client = new Anthropic({ apiKey });
  return {
    async stream(request, onText) {
      const [prompt, ...context] = request.system;
      const stream = client.messages.stream({
        model: request.model,
        max_tokens: request.max_tokens,
        // The fixed prompt is cached; the project context changes with each reply.
        system: [
          { type: "text", text: prompt ?? "", cache_control: { type: "ephemeral" } },
          ...context.filter((t) => t.length > 0).map((t) => ({ type: "text" as const, text: t })),
        ],
        messages: request.messages as unknown as Anthropic.MessageParam[],
        tools: request.tools as unknown as Anthropic.Tool[],
      });
      stream.on("text", (delta) => onText(delta));
      const message = await stream.finalMessage();
      return {
        content: message.content as unknown as ContentBlock[],
        stop_reason: message.stop_reason,
      };
    },
  };
}
