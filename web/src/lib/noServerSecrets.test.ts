import { describe, expect, it } from "vitest";

// Claude runs only on the server. The web app (and the engine code it bundles from api/) must
// never import the Anthropic client or read the Anthropic key. CI also searches the built files.
const FORBIDDEN = ["@anthropic-ai/" + "sdk", "ANTHROPIC_" + "API_KEY", "sk-" + "ant-", "firebase-" + "admin"];

const webSources = import.meta.glob<string>("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
const engineSources = import.meta.glob<string>("../../../api/src/engine/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("the web build holds no server secrets", () => {
  it("reads the web and engine sources", () => {
    expect(Object.keys(webSources).length).toBeGreaterThan(5);
    expect(Object.keys(engineSources).length).toBeGreaterThan(5);
  });

  it("never imports the Anthropic client or reads its key", () => {
    const hits: string[] = [];
    for (const [path, text] of Object.entries({ ...webSources, ...engineSources })) {
      if (path.endsWith("noServerSecrets.test.ts")) continue;
      for (const word of FORBIDDEN) if (text.includes(word)) hits.push(`${path}: ${word}`);
    }
    expect(hits).toEqual([]);
  });
});
