import { initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { parseAllowedEmails } from "../lib/access";

// Public Firebase web config. These values are not secrets: they identify the
// project. They are set at build time in web/.env.production.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) ?? "arconstructive.firebaseapp.com",
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) ?? "arconstructive",
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const authConfigured = Boolean(config.apiKey && config.appId);

export const auth: Auth | null = authConfigured ? getAuth(initializeApp(config)) : null;

export const allowedEmails = parseAllowedEmails(import.meta.env.VITE_ALLOWED_EMAILS as string | undefined);
