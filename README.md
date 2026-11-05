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

The issue engine, the upload to storage and sign-in come in the next pull requests.
The screen needs no settings or secrets yet.
