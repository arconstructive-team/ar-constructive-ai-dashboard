import { defineConfig } from "vitest/config";

// The Firestore security rules tests. They need the Firestore emulator, so CI runs them with
// `firebase emulators:exec --only firestore` (see the rules job in .github/workflows/ci.yml).
export default defineConfig({
  test: {
    environment: "node",
    include: ["rules/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
