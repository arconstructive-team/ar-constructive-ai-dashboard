import type { Chat } from "./types";

/** A date section of the sidebar chat list: Today, Yesterday, Previous 7 days, then months. */
export interface ChatGroup {
  key: string;
  label: string;
  chats: Chat[];
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** When the chat last had activity: its last message, else when it was made. A chat still saving counts as now. */
export function chatActivity(chat: Chat, now: Date): Date {
  return chat.updatedAt ?? chat.createdAt ?? now;
}

function groupOf(at: Date, now: Date): { key: string; label: string } {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 0) return { key: "today", label: "Today" };
  if (days === 1) return { key: "yesterday", label: "Yesterday" };
  if (days < 7) return { key: "week", label: "Previous 7 days" };
  if (days < 30) return { key: "month", label: "Previous 30 days" };
  const sameYear = at.getFullYear() === now.getFullYear();
  const label = at.toLocaleDateString("en-US", sameYear ? { month: "long" } : { month: "long", year: "numeric" });
  return { key: `${at.getFullYear()}-${at.getMonth()}`, label };
}

/** Sorts chats newest first and splits them into date sections, newest section first. */
export function groupChatsByDate(chats: Chat[], now: Date = new Date()): ChatGroup[] {
  const sorted = [...chats].sort((a, b) => chatActivity(b, now).getTime() - chatActivity(a, now).getTime());
  const groups: ChatGroup[] = [];
  for (const chat of sorted) {
    const { key, label } = groupOf(chatActivity(chat, now), now);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.chats.push(chat);
    else groups.push({ key, label, chats: [chat] });
  }
  return groups;
}

/** A short time for a chat row: "2:14 PM" today, "Mon" this week, "Oct 3" this year, "Oct 3, 2025" before. */
export function chatTimeLabel(at: Date, now: Date = new Date()): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 0) return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return at.toLocaleDateString("en-US", { weekday: "short" });
  if (at.getFullYear() === now.getFullYear()) return at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The full date and time, for the row's tooltip and machine-readable datetime. */
export function chatTimeTitle(at: Date): string {
  return at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
