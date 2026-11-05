import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";

const RULES = readFileSync(fileURLToPath(new URL("../../firestore.rules", import.meta.url)), "utf8");

let env: RulesTestEnvironment;

beforeAll(async () => {
  // The emulator host comes from FIRESTORE_EMULATOR_HOST, which `firebase emulators:exec` sets.
  env = await initializeTestEnvironment({ projectId: "demo-arconstructive", firestore: { rules: RULES } });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "projects/p1"), { name: "El Rio ADU", createdBy: "ahk.archteam@gmail.com", members: ["team"] });
    await setDoc(doc(db, "projects/p1/chats/c1"), { title: "Chat 1" });
    await setDoc(doc(db, "projects/p1/chats/c1/messages/m1"), { role: "user", text: "hello", author: "Ahk" });
    await setDoc(doc(db, "projects/p1/artifacts/a1"), { title: "Issue report", kind: "issue_report", status: "ready", version: 1 });
    await setDoc(doc(db, "projects/p1/artifacts/a1/versions/1"), { version: 1, content: "# Issue report" });
    await setDoc(doc(db, "secrets/s1"), { value: "x" });
  });
});

const team = () => env.authenticatedContext("u-ahk", { email: "ahk.archteam@gmail.com" }).firestore();
const teamUpperCase = () => env.authenticatedContext("u-rd", { email: "RDGhoorchian@gmail.com" }).firestore();
const stranger = () => env.authenticatedContext("u-x", { email: "someone@example.com" }).firestore();
const noEmail = () => env.authenticatedContext("u-anon", {}).firestore();
const signedOut = () => env.unauthenticatedContext().firestore();

describe("Firestore rules: team members", () => {
  it("read and write projects, chats, messages, sets, artifacts and versions", async () => {
    const db = team();
    await assertSucceeds(getDocs(collection(db, "projects")));
    await assertSucceeds(setDoc(doc(db, "projects/p2"), { name: "New", createdBy: "ahk.archteam@gmail.com", members: ["team"] }));
    await assertSucceeds(updateDoc(doc(db, "projects/p1"), { name: "Renamed" }));
    await assertSucceeds(getDocs(collection(db, "projects/p1/chats")));
    await assertSucceeds(setDoc(doc(db, "projects/p1/chats/c2"), { title: "Chat 2" }));
    await assertSucceeds(setDoc(doc(db, "projects/p1/chats/c1/messages/m2"), { role: "assistant", text: "hi" }));
    await assertSucceeds(setDoc(doc(db, "projects/p1/chats/c1/sets/s1"), { fileName: "set.pdf", pages: [] }));
    await assertSucceeds(updateDoc(doc(db, "projects/p1/artifacts/a1"), { status: "generating" }));
    await assertSucceeds(setDoc(doc(db, "projects/p1/artifacts/a1/versions/2"), { version: 2, content: "# v2" }));
    await assertSucceeds(getDoc(doc(db, "projects/p1/artifacts/a1/versions/1")));
  });

  it("match the email without regard to case", async () => {
    await assertSucceeds(getDoc(doc(teamUpperCase(), "projects/p1/chats/c1/messages/m1")));
  });

  it("cannot reach anything outside projects", async () => {
    await assertFails(getDoc(doc(team(), "secrets/s1")));
    await assertFails(setDoc(doc(team(), "users/u-ahk"), { name: "Ahk" }));
  });
});

describe("Firestore rules: everyone else", () => {
  for (const [who, db] of [
    ["another signed-in account", stranger],
    ["an account without an email", noEmail],
    ["a signed-out visitor", signedOut],
  ] as const) {
    it(`denies ${who}`, async () => {
      const store = db();
      await assertFails(getDocs(collection(store, "projects")));
      await assertFails(getDoc(doc(store, "projects/p1")));
      await assertFails(setDoc(doc(store, "projects/p3"), { name: "Mine" }));
      await assertFails(getDoc(doc(store, "projects/p1/chats/c1/messages/m1")));
      await assertFails(setDoc(doc(store, "projects/p1/chats/c1/messages/m3"), { text: "spam" }));
      await assertFails(getDoc(doc(store, "projects/p1/artifacts/a1")));
      await assertFails(updateDoc(doc(store, "projects/p1/artifacts/a1"), { content: "changed" }));
    });
  }
});
