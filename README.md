# ar-constructive-ai-dashboard

The arconstructive dashboard: an AI permit-set assistant for California architecture firms.
An architect uploads a permit set as one PDF and gets a sheet-by-sheet issue report.

## Layout

- `web/`: the dashboard (Vite, React, TypeScript, Tailwind CSS v4). It builds to `web/dist`, which Firebase Hosting serves (`firebase.json`).
- `DESIGN.md`: the design tokens and rules. `web/src/app.css` holds the same tokens in code.
- `.github/workflows/ci.yml`: type check, unit tests and build on every pull request.

## Run it

```sh
cd web
corepack enable
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # unit tests (Vitest)
pnpm typecheck
pnpm build      # writes web/dist
```

## What works now

The first screen, "Check a permit set":

1. Enter the project address, the jurisdiction (7 Contra Costa County jurisdictions) and the ADU type. The code cycle is 2025.
2. Drop or choose the permit set PDF. The screen checks that the file is a real PDF and is under 200 MB.
3. "Start the check" confirms the set and the project data.

The single-set check stays at `#/check`, and the code library at `#/library`.

## Calling chat-api from Autopo agents

Autopo agents (and team scripts) call chat-api's engines server to server, without a browser sign-in.
Base URL: `https://chat-api-kfzvlbf5aq-wl.a.run.app`. Every call below sends `Authorization: Bearer <token>`;
a call without a token answers 401, and a valid token of an account that is not on a list answers 403.

### Get a token

chat-api accepts three kinds of token (`api/src/agent/auth.ts`):

1. **A Google identity token of an allowlisted service account (preferred).** The token's audience must be
   the service URL above, and it must carry the account's email. The allowlist is `AGENT_SERVICE_ACCOUNTS`
   (repository variable; default `autopo@arconstructive.iam.gserviceaccount.com`). The deploy sets the
   accepted audiences (`AGENT_AUDIENCES`) to the service's URLs. Ways to get one, valid for one hour:

   ```sh
   # As the service account (its key or workload identity is the active gcloud account):
   TOKEN=$(gcloud auth print-identity-token --audiences=https://chat-api-kfzvlbf5aq-wl.a.run.app --include-email)
   # As a person or another account allowed to impersonate it (roles/iam.serviceAccountTokenCreator):
   TOKEN=$(gcloud auth print-identity-token --impersonate-service-account=autopo@arconstructive.iam.gserviceaccount.com \
     --audiences=https://chat-api-kfzvlbf5aq-wl.a.run.app --include-email)
   ```

   With the IAM Credentials API: `POST https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/autopo@arconstructive.iam.gserviceaccount.com:generateIdToken`
   with `{"audience": "https://chat-api-kfzvlbf5aq-wl.a.run.app", "includeEmail": true}`; the answer's `token` is the
   token. On Cloud Run or GCE: the metadata server's `identity?audience=<service URL>&format=full`.
2. **The agents' API key.** The value of the Secret Manager secret `AGENT_API_KEY` in the `arconstructive` project
   (the deploy binds it when it exists). Send it as the bearer token. Use it only where a Google identity token
   cannot be minted.
3. **A team member's Firebase ID token**, as the web app sends it (the email must be on the team list).

### Site report by address

```sh
curl -X POST https://chat-api-kfzvlbf5aq-wl.a.run.app/api/site/report \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"address": "428 El Rio Rd, Danville, CA 94526"}'
```

No `projectId` is needed. The answer is the full site report: `steps.jurisdiction`, `flood`, `seismic`
(liquefaction and fault zones), `parcel`, `solar` (roof), `zoning`, `fire`, `elevation`, `climateZone`, `geocode`,
`streetView` and `satellite`. Each step has `status`, `data`, `summary` and `sources` (name, exact URL, `fetchedAt`).
Add `"projectId": "…"` to also save the snapshot on that web app project.

### Permit-set check

```sh
curl -X POST https://chat-api-kfzvlbf5aq-wl.a.run.app/api/check \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"pdf": "gs://arconstructive.firebasestorage.app/projects/P/documents/D/set.pdf",
       "jurisdiction": "Town of Danville", "aduType": "Attached ADU", "address": "428 El Rio Rd, Danville, CA 94526"}'
```

`pdf` is a `gs://bucket/path`, a project document's `storagePath` (read from the web app's bucket), or a public
`https://` URL. The PDF must be under 200 MB. The answer has `report` (the engine result: pages, findings with code
citations, missing items, counts), `issueReport` (`title`, `markdown`) and `regenerated` (`title`, `markdown` of the
regenerated sheets, or null). Errors: 400 bad body or source, 404 no file, 413 too large, 415 not a PDF, 422
unreadable PDF. The web app's raw PDF upload (`content-type: application/pdf`) still works as before.

### Sheet regeneration

```sh
curl -X POST https://chat-api-kfzvlbf5aq-wl.a.run.app/api/regenerate \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"pdf": "https://example.com/set.pdf", "jurisdiction": "Town of Danville", "aduType": "Attached ADU"}'
```

The same body as the check. The answer has `regenerated` (sheets A-0.1, A-0.2, A-5.2 and A-5.3 with their
sections and citations, `to_confirm`, and the findings still on them), `markdown`, and `pdf.base64` (the sheets as
one PDF). It answers 422 when the set has no architectural cover sheet.

### Export every project

```sh
curl https://chat-api-kfzvlbf5aq-wl.a.run.app/api/export -H "authorization: Bearer $TOKEN"
```

The answer is `{exportedAt, count, projects}`. Each project has `id`, `name`, `address`, `jurisdiction`, `aduType`,
`client`, `status`, `createdAt`, `members`, `siteReport` (the facts snapshot with sources, or null), `documents`
(`title`, `kind`, `status`, `source`, `link` (the URL, or `gs://bucket/storagePath`), `storagePath`, `updatedAt`)
and `artifacts` (issue reports, sheet sets and the site report document, with their markdown). It reads only.

## Team workspace (projects, chats, artifacts)

The home page (`#/`) is the team workspace. Both team accounts see every project and chat.

1. "New project" creates a project with its address, jurisdiction and ADU type.
2. "New chat" opens a chat session under the project. "Chat options" renames the chat or the project.
3. In a chat, + (or `/check`) uploads the permit set PDF. The assistant runs the check engine and writes an
   **issue report** artifact on the right. `/regenerate` (or "regenerate the sheets") writes a **sheet set** artifact.
4. A follow-up such as "check it as San Ramon", "detached ADU" or "fix the jurisdiction on the sheets" checks the
   set again and writes a new version of the same artifact.
5. While the assistant writes, the artifact status is `generating` and the text fills in part by part.
   Then the status is `ready` (or `error` with the reason).

Data lives in Firestore (`web/src/workspace/types.ts` has the full layout):

- `projects/{projectId}`, with `chats/{chatId}/messages/{messageId}` and `chats/{chatId}/sets/{setId}` (the set text, for follow-ups)
- `projects/{projectId}/artifacts/{artifactId}`, with `versions/{version}`
- `projects/{projectId}/artifacts/site-report`: the site info as an editable document (no chat). It is written when a
  project is created and on every "Refresh site info"; each refresh saves a new version, and the team's edits stay in
  the version history. It opens at `#/projects/{projectId}/artifacts/site-report` and is listed in Documents.
- `projects/{projectId}.siteReport`: the site facts snapshot (every fact with its sources, and `fetchedAt`). chat-api
  saves it when a project is created and on every "Refresh site info" (`POST /api/site/report` with `projectId`).
  Street View and satellite images are not stored; they stay rendered live. Only the API writes this field.
- `projects/{projectId}.client` and `.status` (`intake`, `design`, `permit_set`, `submitted`, `approved`): edited on
  the project page.
- `projects/{projectId}/documents/{documentId}`: the project's documents, uploads (the file in Cloud Storage at
  `storagePath`) or links (`url`), with title, kind, status, updated and added by. The project page's Documents
  section adds, lists and opens them.

### Backfill the site facts snapshot on older projects

Projects made before the snapshot existed have no `siteReport`. Fill it in once, in one of two ways. Both skip
projects that already have one, reuse the full report the web app stored at `projects/{id}/site/report` when its
address matches, and read the sources again only for the rest.

1. From the deployed API, signed in as a team account (the Firebase ID token from the web app):

   ```sh
   curl -X POST https://chat-api-kfzvlbf5aq-wl.a.run.app/api/site/backfill \
     -H "authorization: Bearer $ID_TOKEN" -H "content-type: application/json" -d '{}'
   ```

   Send `{"force": true}` to rewrite every project. The answer lists the projects saved, skipped and failed.
2. From a computer with access to the company's Google project, in `api/`:

   ```sh
   gcloud auth application-default login
   GOOGLE_CLOUD_PROJECT=arconstructive pnpm backfill:site          # add --force to rewrite every project
   ```

`firestore.rules` lets only the signed-in team accounts read or write, and denies everything else. It also checks
the project status and client, each document's title, kind, status and link, and keeps `siteReport` for the API.
CI tests the rules on the Firestore emulator (`rules` job, `web/rules/firestore.rules.test.ts`).
To run them locally (Java 11 or later):

```sh
npx firebase-tools emulators:exec --only firestore --project demo-arconstructive "pnpm --dir web test:rules"
```

The deploy workflow publishes the rules together with the site.

### Check realtime updates with two sessions

`web/src/workspace/Workspace.test.tsx` renders two members on one store and checks that each sees the other's
messages and artifact versions at once. To check it on the live site:

1. Sign in as ahk.archteam@gmail.com in one browser, and as rdghoorchian@gmail.com in a private window.
2. In the first window, create a project and a chat. The second window shows them without a reload.
3. Open the chat in both windows. Upload a permit set in the first one.
4. The second window shows the messages, and the issue report fills in while its status is "Writing".
5. In the second window, write "check it as Danville". The first window shows the new version of the report.
