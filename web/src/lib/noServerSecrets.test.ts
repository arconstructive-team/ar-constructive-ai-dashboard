import { describe, expect, it } from "vitest";

// Claude runs only on the server. The web app must never import the Anthropic client, the
// Firebase Admin SDK or read the Anthropic key. CI also searches the built files (web/dist),
// which holds everything the web app bundles, the engine code from api/ included.
const FORBIDDEN = ["@anthropic-ai/" + "sdk", "ANTHROPIC_" + "API_KEY", "sk-" + "ant-", "firebase-" + "admin"];

const webSources = import.meta.glob<string>("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });

describe("the web app holds no server secrets", () => {
  it("reads the web sources", () => {
    expect(Object.keys(webSources).length).toBeGreaterThan(5);
  });

  it("never imports the Anthropic client or reads its key", () => {
    const hits: string[] = [];
    for (const [path, text] of Object.entries(webSources)) {
      if (path.endsWith("noServerSecrets.test.ts")) continue;
      for (const word of FORBIDDEN) if (text.includes(word)) hits.push(`${path}: ${word}`);
    }
    expect(hits).toEqual([]);
  });
});
