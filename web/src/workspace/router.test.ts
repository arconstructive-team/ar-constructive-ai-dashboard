import { describe, expect, it, vi } from "vitest";
import { memoryRouter, parseRoute, routeHref } from "./router";

describe("workspace routes", () => {
  it("reads and writes project and chat links", () => {
    expect(parseRoute("")).toEqual({ projectId: null, chatId: null });
    expect(parseRoute("#/")).toEqual({ projectId: null, chatId: null });
    expect(parseRoute("#/projects/p1")).toEqual({ projectId: "p1", chatId: null });
    expect(parseRoute("#/projects/p1/chats/c9")).toEqual({ projectId: "p1", chatId: "c9" });
    expect(parseRoute("#/check")).toEqual({ projectId: null, chatId: null });
    expect(routeHref({ projectId: null, chatId: null })).toBe("#/");
    expect(routeHref({ projectId: "p 1", chatId: null })).toBe("#/projects/p%201");
    expect(routeHref({ projectId: "p1", chatId: "c9" })).toBe("#/projects/p1/chats/c9");
    expect(parseRoute(routeHref({ projectId: "a/b", chatId: "c d" }))).toEqual({ projectId: "a/b", chatId: "c d" });
    expect(parseRoute("#/projects/p1/documents")).toEqual({ projectId: "p1", chatId: null, page: "documents" });
    expect(routeHref({ projectId: "p1", chatId: null, page: "documents" })).toBe("#/projects/p1/documents");
    expect(parseRoute("#/projects/p1/chats/c9/artifacts/a3")).toEqual({ projectId: "p1", chatId: "c9", artifactId: "a3" });
    expect(routeHref({ projectId: "p1", chatId: "c9", artifactId: "a3" })).toBe("#/projects/p1/chats/c9/artifacts/a3");
  });

  it("tells subscribers when the route changes", () => {
    const router = memoryRouter();
    const seen = vi.fn();
    const stop = router.subscribe(seen);
    router.go({ projectId: "p1", chatId: null });
    expect(seen).toHaveBeenCalledWith({ projectId: "p1", chatId: null });
    stop();
    router.go({ projectId: "p2", chatId: null });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(router.current()).toEqual({ projectId: "p2", chatId: null });
  });
});
