import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Root, routeFromHash } from "./Root";
import { SignedInUser } from "./auth/user";
import { MemoryStore } from "./workspace/memoryStore";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("Root", () => {
  it("keeps the single-set check and the code library at their own addresses", () => {
    expect(routeFromHash("")).toBe("projects");
    expect(routeFromHash("#/")).toBe("projects");
    expect(routeFromHash("#/check")).toBe("tools");
    expect(routeFromHash("#/library")).toBe("tools");
  });

  it("opens the team projects for a signed-in member", async () => {
    render(
      <SignedInUser.Provider value={{ uid: "u1", email: "ahk.archteam@gmail.com", name: "Ahk" }}>
        <Root store={new MemoryStore()} />
      </SignedInUser.Provider>,
    );
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New check" }).getAttribute("href")).toBe("#/check");
    expect(screen.getByRole("link", { name: "Code library" }).getAttribute("href")).toBe("#/library");
  });

  it("asks for sign-in when there is no signed-in member", () => {
    render(<Root store={new MemoryStore()} />);
    expect(screen.getByText(/The team workspace needs sign-in/)).toBeTruthy();
  });
});
