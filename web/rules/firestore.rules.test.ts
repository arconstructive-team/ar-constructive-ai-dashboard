import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";

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
    await setDoc(doc(db, "projects/p1/documents/d1"), {
      name: "Survey.pdf",
      kind: "survey",
      status: "final",
      source: "upload",
      storagePath: "projects/p1/documents/d1/Survey.pdf",
      uploadedBy: "Ahk",
    });
    await setDoc(doc(db, "projects/p1/documents/d2"), {
      name: "Permit portal",
      kind: "permit",
      status: "draft",
      source: "link",
      url: "https://permits.danville.ca.gov/case/123",
      storagePath: "",
      uploadedBy: "Ahk",
    });
    // A project with the site facts snapshot the API saved.
    await setDoc(doc(db, "projects/p5"), {
      name: "Walnut St ADU",
      members: ["team"],
      siteReport: { version: 1, fetchedAt: "2026-11-07T06:00:00.000Z", facts: [], sources: [] },
    });
  });
});

const link = (extra: Record<string, unknown> = {}) => ({
  name: "Drawings on the shared drive",
  kind: "drawings",
  status: "draft",
  source: "link",
  url: "https://drive.google.com/file/d/abc",
  storagePath: "",
  uploadedBy: "Ahk",
  ...extra,
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

  it("include the founder's account mohsen.naghipourfar@gmail.com", async () => {
    const db = env.authenticatedContext("u-mn", { email: "mohsen.naghipourfar@gmail.com" }).firestore();
    await assertSucceeds(getDocs(collection(db, "projects")));
    await assertSucceeds(setDoc(doc(db, "projects/p4"), { name: "Founder project", createdBy: "mohsen.naghipourfar@gmail.com", members: ["team"] }));
    await assertSucceeds(getDoc(doc(db, "projects/p1/chats/c1/messages/m1")));
    await assertSucceeds(setDoc(doc(db, "projects/p1/chats/c1/messages/m4"), { role: "user", text: "hello from the founder" }));
  });

  it("cannot reach anything outside projects", async () => {
    await assertFails(getDoc(doc(team(), "secrets/s1")));
    await assertFails(setDoc(doc(team(), "users/u-ahk"), { name: "Ahk" }));
  });

  it("read the site report and its snapshot, and write the full report", async () => {
    const db = team();
    await assertSucceeds(getDoc(doc(db, "projects/p5")));
    await assertSucceeds(setDoc(doc(db, "projects/p1/site/report"), { version: 1, address: "428 El Rio Rd", steps: {} }));
    await assertSucceeds(getDoc(doc(db, "projects/p1/site/report")));
  });
});

describe("Firestore rules: project fields", () => {
  it("let the team set the client and a known status", async () => {
    const db = team();
    await assertSucceeds(updateDoc(doc(db, "projects/p1"), { client: "Rivera family", status: "permit_set" }));
    await assertSucceeds(updateDoc(doc(db, "projects/p5"), { status: "approved" }));
    await assertSucceeds(setDoc(doc(db, "projects/p6"), { name: "New", members: ["team"], client: "", status: "intake" }));
  });

  it("refuse an unknown status or a client that is not text", async () => {
    const db = team();
    await assertFails(updateDoc(doc(db, "projects/p1"), { status: "done" }));
    await assertFails(updateDoc(doc(db, "projects/p1"), { client: 42 }));
    await assertFails(updateDoc(doc(db, "projects/p1"), { client: "x".repeat(201) }));
  });

  it("leave the site facts snapshot to the API", async () => {
    const db = team();
    await assertFails(updateDoc(doc(db, "projects/p5"), { siteReport: { version: 1, fetchedAt: "forged", facts: [], sources: [] } }));
    await assertFails(updateDoc(doc(db, "projects/p1"), { siteReport: { version: 1 } }));
    await assertFails(setDoc(doc(db, "projects/p7"), { name: "New", members: ["team"], siteReport: { version: 1 } }));
  });
});

describe("Firestore rules: project documents", () => {
  it("let the team list, add, change and delete documents", async () => {
    const db = team();
    await assertSucceeds(getDocs(collection(db, "projects/p1/documents")));
    await assertSucceeds(getDoc(doc(db, "projects/p1/documents/d2")));
    await assertSucceeds(setDoc(doc(db, "projects/p1/documents/d3"), link()));
    await assertSucceeds(
      setDoc(doc(db, "projects/p1/documents/d4"), {
        name: "Title 24.pdf",
        kind: "report",
        status: "final",
        source: "upload",
        storagePath: "projects/p1/documents/d4/Title 24.pdf",
        uploadedBy: "Ahk",
      }),
    );
    await assertSucceeds(updateDoc(doc(db, "projects/p1/documents/d1"), { status: "superseded", kind: "drawings", updatedBy: "Ahk" }));
    await assertSucceeds(updateDoc(doc(db, "projects/p1/documents/d2"), { name: "City portal" }));
    await assertSucceeds(deleteDoc(doc(db, "projects/p1/documents/d2")));
  });

  it("refuse a document without a title, with an unknown kind or status, or a link that is not a web address", async () => {
    const db = team();
    await assertFails(setDoc(doc(db, "projects/p1/documents/d5"), link({ name: "" })));
    await assertFails(setDoc(doc(db, "projects/p1/documents/d5"), link({ kind: "spreadsheet" })));
    await assertFails(setDoc(doc(db, "projects/p1/documents/d5"), link({ status: "lost" })));
    await assertFails(setDoc(doc(db, "projects/p1/documents/d5"), link({ url: "javascript:alert(1)" })));
    await assertFails(setDoc(doc(db, "projects/p1/documents/d5"), link({ source: "email" })));
  });

  it("never change where a document comes from or which file it points at", async () => {
    const db = team();
    await assertFails(updateDoc(doc(db, "projects/p1/documents/d1"), { storagePath: "projects/p2/documents/x/other.pdf" }));
    await assertFails(updateDoc(doc(db, "projects/p1/documents/d2"), { source: "upload" }));
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
      await assertFails(getDocs(collection(store, "projects/p1/documents")));
      await assertFails(getDoc(doc(store, "projects/p1/documents/d1")));
      await assertFails(setDoc(doc(store, "projects/p1/documents/d9"), link()));
      await assertFails(updateDoc(doc(store, "projects/p1/documents/d1"), { status: "draft" }));
      await assertFails(deleteDoc(doc(store, "projects/p1/documents/d1")));
      await assertFails(updateDoc(doc(store, "projects/p1"), { client: "Someone" }));
    });
  }
});
