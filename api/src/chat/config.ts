// Every setting of the team chat assistant, in one place. Change them with environment
// variables on the Cloud Run service; the code holds only the defaults.
import { SYSTEM_PROMPT } from "./prompt";

/** The default Claude model: a current Claude Sonnet. Override with ANTHROPIC_MODEL. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";

export interface ChatConfig {
  /** The Claude model id (ANTHROPIC_MODEL). */
  model: string;
  /** The longest reply, in tokens (CHAT_MAX_TOKENS). */
  maxTokens: number;
  /** The assistant's instructions (CHAT_SYSTEM_PROMPT replaces the built-in prompt). */
  systemPrompt: string;
  /** Team members who may use the chat (ALLOWED_EMAILS, comma separated: the same list as sign-in). */
  allowedEmails: string[];
  /** How many tool rounds one reply may take before it stops (CHAT_MAX_TOOL_ROUNDS). */
  maxToolRounds: number;
  /** How many earlier chat messages go to Claude (CHAT_HISTORY_MESSAGES). */
  historyMessages: number;
}

/** Same rules as the web app's sign-in list: comma separated, trimmed, any case. */
export function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function chatConfig(env: Record<string, string | undefined> = process.env): ChatConfig {
  return {
    model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL,
    maxTokens: positive(env.CHAT_MAX_TOKENS, 8000),
    systemPrompt: env.CHAT_SYSTEM_PROMPT?.trim() || SYSTEM_PROMPT,
    allowedEmails: parseAllowedEmails(env.ALLOWED_EMAILS),
    maxToolRounds: positive(env.CHAT_MAX_TOOL_ROUNDS, 8),
    historyMessages: positive(env.CHAT_HISTORY_MESSAGES, 40),
  };
}
