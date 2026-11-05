// The production server on Cloud Run: the permit check (POST /api/check), the team chat
// assistant (POST /api/chat) and the site report (/api/site/*). Firebase Admin uses the service's
// own Google identity. The Anthropic key (ANTHROPIC_API_KEY) and the Google Maps Platform key
// (GOOGLE_MAPS_API_KEY) come from Secret Manager and are read only here.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { authorize, type VerifyToken } from "./chat/auth";
import { chatConfig } from "./chat/config";
import { createFirestoreChatStore } from "./chat/firestore";
import { anthropicModel } from "./chat/model";
import { createApp } from "./server";

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "arconstructive";
const app = initializeApp({ projectId });
const auth = getAuth(app);
const config = chatConfig();
const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
const googleKey = process.env.GOOGLE_MAPS_API_KEY?.trim();

if (!apiKey) console.warn("ANTHROPIC_API_KEY is not set: POST /api/chat answers 503 until it is.");
if (!googleKey) console.warn("GOOGLE_MAPS_API_KEY is not set: the site report uses the Census geocoder and has no Google images.");
if (config.allowedEmails.length === 0) console.warn("ALLOWED_EMAILS is empty: POST /api/chat lets nobody in.");

const verifyToken: VerifyToken = async (token) => {
  const claims = await auth.verifyIdToken(token);
  return { uid: claims.uid, email: claims.email, name: typeof claims.name === "string" ? claims.name : undefined };
};

const port = Number(process.env.PORT ?? 8080);
createApp({
  allowedOrigin: process.env.ALLOWED_ORIGIN,
  chat: {
    config,
    store: createFirestoreChatStore(getFirestore(app)),
    model: apiKey ? anthropicModel(apiKey) : null,
    verifyToken,
  },
  site: {
    apiKey: googleKey,
    authorize: (header) => authorize(header, verifyToken, config.allowedEmails),
  },
}).listen(port, () => {
  console.log(`arconstructive API listening on port ${port} (chat model ${config.model})`);
});
