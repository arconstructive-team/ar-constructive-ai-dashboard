// The production server on Cloud Run: the permit check (POST /api/check), the team chat
// assistant (POST /api/chat), the site report (/api/site/*), and the routes for Autopo agents
// (POST /api/check with a PDF path or URL, POST /api/regenerate, GET /api/export). Firebase Admin
// uses the service's own Google identity. The Anthropic key (ANTHROPIC_API_KEY), the Google Maps
// Platform key (GOOGLE_MAPS_API_KEY) and the agents' API key (AGENT_API_KEY) come from Secret
// Manager and are read only here.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createCallerAuth, createGoogleIdTokenVerifier, parseList } from "./agent/auth";
import { createFirestoreExportStore } from "./agent/export";
import { SourceProblem, type ReadStorage } from "./agent/source";
import type { VerifyToken } from "./chat/auth";
import { chatConfig } from "./chat/config";
import { createFirestoreChatStore } from "./chat/firestore";
import { anthropicModel } from "./chat/model";
import { createApp } from "./server";
import { createFirestoreSiteProjectStore } from "./site/projects";

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "arconstructive";
// The web app's default bucket, where project documents are uploaded.
const bucket = process.env.STORAGE_BUCKET?.trim() || `${projectId}.firebasestorage.app`;
const app = initializeApp({ projectId, storageBucket: bucket });
const auth = getAuth(app);
const db = getFirestore(app);
const config = chatConfig();
const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
const googleKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
const agentServiceAccounts = parseList(process.env.AGENT_SERVICE_ACCOUNTS, true);
const agentAudiences = parseList(process.env.AGENT_AUDIENCES);
const agentApiKeys = parseList(process.env.AGENT_API_KEY);

if (!apiKey) console.warn("ANTHROPIC_API_KEY is not set: POST /api/chat answers 503 until it is.");
if (!googleKey) console.warn("GOOGLE_MAPS_API_KEY is not set: the site report uses the Census geocoder and has no Google images.");
if (config.allowedEmails.length === 0) console.warn("ALLOWED_EMAILS is empty: POST /api/chat lets nobody in.");
if (agentServiceAccounts.length === 0 || agentAudiences.length === 0) {
  console.warn("AGENT_SERVICE_ACCOUNTS or AGENT_AUDIENCES is empty: service account tokens are refused.");
}
if (agentApiKeys.length === 0) console.warn("AGENT_API_KEY is not set: API keys are refused.");

const verifyToken: VerifyToken = async (token) => {
  const claims = await auth.verifyIdToken(token);
  return { uid: claims.uid, email: claims.email, name: typeof claims.name === "string" ? claims.name : undefined };
};

// Team members (Firebase), allowlisted service accounts (Google identity tokens) or the API key.
const callerAuth = createCallerAuth({
  verifyFirebase: verifyToken,
  allowedEmails: config.allowedEmails,
  serviceAccounts: agentServiceAccounts,
  verifyGoogle: createGoogleIdTokenVerifier({ audiences: agentAudiences }),
  apiKeys: agentApiKeys,
});

const storage = getStorage(app);
const readStorage: ReadStorage = async (bucketName, path, maxBytes) => {
  const file = storage.bucket(bucketName).file(path);
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size ?? 0) > maxBytes) throw new SourceProblem(413, "The permit set is larger than 200 MB. Split it or compress it, then try again.");
  const [data] = await file.download();
  return new Uint8Array(data);
};

const port = Number(process.env.PORT ?? 8080);
createApp({
  allowedOrigin: process.env.ALLOWED_ORIGIN,
  chat: {
    config,
    store: createFirestoreChatStore(db),
    model: apiKey ? anthropicModel(apiKey) : null,
    verifyToken,
  },
  site: {
    apiKey: googleKey,
    // The snapshot on projects/{id}.siteReport, written with the service's own identity.
    projects: createFirestoreSiteProjectStore(db),
    authorize: callerAuth,
  },
  agent: {
    authorize: callerAuth,
    exportStore: createFirestoreExportStore(db, bucket),
    source: { readStorage, defaultBucket: bucket },
  },
}).listen(port, () => {
  console.log(`arconstructive API listening on port ${port} (chat model ${config.model})`);
});
