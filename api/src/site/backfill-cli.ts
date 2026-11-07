// One-off backfill: saves the site report snapshot (projects/{id}.siteReport) on every project
// that has none yet. It reuses the report the web app already stored for the same address, and
// runs the pipeline only for the rest. Safe to run again: projects with a snapshot are skipped.
//
// Run it from api/ with a Google account that may write the company's Firestore:
//   gcloud auth application-default login
//   GOOGLE_CLOUD_PROJECT=arconstructive pnpm backfill:site            # only projects without one
//   GOOGLE_CLOUD_PROJECT=arconstructive pnpm backfill:site --force    # rewrite every project
// GOOGLE_MAPS_API_KEY is optional: without it a rebuilt report uses the free public sources only.
// The deployed API does the same with POST /api/site/backfill (see README.md).
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { buildSiteReport } from "./pipeline";
import { backfillSiteReports, createFirestoreSiteProjectStore } from "./projects";

async function main() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "arconstructive";
  const db = getFirestore(initializeApp({ projectId }));
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || undefined;
  const result = await backfillSiteReports(createFirestoreSiteProjectStore(db), {
    build: (address) => buildSiteReport(address, { apiKey }),
    force: process.argv.includes("--force"),
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
