import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage, type FirebaseStorage } from "firebase/storage";
import { parseAllowedEmails } from "../lib/access";

// Public Firebase web config. These values are not secrets: they identify the
// project. They are set at build time in web/.env.production.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) ?? "arconstructive.firebaseapp.com",
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) ?? "arconstructive",
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  // New Firebase projects name their default bucket {projectId}.firebasestorage.app.
  storageBucket:
    (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) ??
    `${(import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) ?? "arconstructive"}.firebasestorage.app`,
};

export const authConfigured = Boolean(config.apiKey && config.appId);

const app: FirebaseApp | null = authConfigured ? initializeApp(config) : null;

export const auth: Auth | null = app ? getAuth(app) : null;

/** The team database: projects, chats, messages and artifacts (Firestore, default database). */
export const db: Firestore | null = app ? getFirestore(app) : null;

/** The project documents' files (Firebase Storage, default bucket). */
export const storage: FirebaseStorage | null = app ? getStorage(app) : null;
// The SDK retries a failed upload for 10 minutes by default. Give up after 30 seconds, so a missing
// bucket or a network problem says so instead of keeping the chat waiting.
if (storage) storage.maxUploadRetryTime = 30_000;

// Local testing only (`pnpm dev:emulator`, web/.env.emulator): talk to the Firebase Auth and
// Firestore emulators instead of the live project. Never set in a production build.
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true" && auth && db) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  if (storage) connectStorageEmulator(storage, "127.0.0.1", 9199);
}

export const allowedEmails = parseAllowedEmails(import.meta.env.VITE_ALLOWED_EMAILS as string | undefined);
