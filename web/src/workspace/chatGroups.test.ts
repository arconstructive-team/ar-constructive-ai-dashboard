import { describe, expect, it } from "vitest";
import { chatTimeLabel, groupChatsByDate } from "./chatGroups";
import type { Chat } from "./types";

const NOW = new Date(2026, 10, 5, 15, 0); // Thu Nov 5 2026, 3 PM

function chat(id: string, updatedAt: Date | null): Chat {
  return { id, projectId: "p", title: id, createdBy: "a", createdAt: updatedAt, updatedAt };
}

describe("groupChatsByDate", () => {
  it("puts chats under Today, Yesterday, the last week and month, then months, newest first", () => {
    const groups = groupChatsByDate(
      [
        chat("older", new Date(2026, 8, 2)),
        chat("today-early", new Date(2026, 10, 5, 8)),
        chat("yesterday", new Date(2026, 10, 4, 23)),
        chat("today-late", new Date(2026, 10, 5, 14)),
        chat("week", new Date(2026, 10, 1)),
        chat("month", new Date(2026, 9, 20)),
        chat("last-year", new Date(2025, 11, 1)),
        chat("saving", null),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.label, g.chats.map((c) => c.id)])).toEqual([
      ["Today", ["saving", "today-late", "today-early"]],
      ["Yesterday", ["yesterday"]],
      ["Previous 7 days", ["week"]],
      ["Previous 30 days", ["month"]],
      ["September", ["older"]],
      ["December 2025", ["last-year"]],
    ]);
  });
});

describe("chatTimeLabel", () => {
  it("is short and gets coarser with age", () => {
    expect(chatTimeLabel(new Date(2026, 10, 5, 14, 7), NOW)).toBe("2:07 PM");
    expect(chatTimeLabel(new Date(2026, 10, 4, 9), NOW)).toBe("Yesterday");
    expect(chatTimeLabel(new Date(2026, 10, 2), NOW)).toBe("Mon");
    expect(chatTimeLabel(new Date(2026, 9, 3), NOW)).toBe("Oct 3");
    expect(chatTimeLabel(new Date(2025, 9, 3), NOW)).toBe("Oct 3, 2025");
  });
});
