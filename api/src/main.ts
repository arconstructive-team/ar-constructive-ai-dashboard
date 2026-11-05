// The production server on Cloud Run: the permit check (POST /api/check) and the team chat
// assistant (POST /api/chat). Firebase Admin uses the service's own Google identity; the
// Anthropic key comes from Secret Manager as ANTHROPIC_API_KEY and is read only here.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { chatConfig } from "./chat/config";
import { createFirestoreChatStore } from "./chat/firestore";
import { anthropicModel } from "./chat/model";
import { createApp } from "./server";

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "arconstructive";
const app = initializeApp({ projectId });
const auth = getAuth(app);
const config = chatConfig();
const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

if (!apiKey) console.warn("ANTHROPIC_API_KEY is not set: POST /api/chat answers 503 until it is.");
if (config.allowedEmails.length === 0) console.warn("ALLOWED_EMAILS is empty: POST /api/chat lets nobody in.");

const port = Number(process.env.PORT ?? 8080);
createApp({
  allowedOrigin: process.env.ALLOWED_ORIGIN,
  chat: {
    config,
    store: createFirestoreChatStore(getFirestore(app)),
    model: apiKey ? anthropicModel(apiKey) : null,
    verifyToken: async (token) => {
      const claims = await auth.verifyIdToken(token);
      return { uid: claims.uid, email: claims.email, name: typeof claims.name === "string" ? claims.name : undefined };
    },
  },
}).listen(port, () => {
  console.log(`arconstructive API listening on port ${port} (chat model ${config.model})`);
});
