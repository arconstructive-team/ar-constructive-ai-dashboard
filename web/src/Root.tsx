import { useEffect, useMemo, useState } from "react";
import { App } from "./App";
import { createFirestoreSource } from "./artifacts/firestoreSource";
import { db } from "./auth/firebase";
import { useSignedInUser } from "./auth/user";
import { CODE_CYCLE } from "./lib/project";
import { Assistant } from "./workspace/assistant";
import { createFirestoreStore } from "./workspace/firestoreStore";
import type { WorkspaceStore } from "./workspace/types";
import { Workspace } from "./workspace/Workspace";

type Route = "projects" | "tools";

/** "#/check" and "#/library" open the single-set check and the code library; everything else opens the projects. */
export function routeFromHash(hash: string): Route {
  return hash.startsWith("#/check") || hash.startsWith("#/library") ? "tools" : "projects";
}

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function Root({ store: injected }: { store?: WorkspaceStore } = {}) {
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash));
  const user = useSignedInUser();
  const store = useMemo(() => injected ?? (db ? createFirestoreStore(db) : null), [injected]);
  const assistant = useMemo(() => (store ? new Assistant({ store }) : null), [store]);
  // The artifact canvas reads the same Firestore documents the assistant writes.
  const canvas = useMemo(() => (!injected && db ? createFirestoreSource(db) : undefined), [injected]);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (route === "tools") return <App />;

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-border">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 md:px-8">
          <span className="font-display text-lg font-semibold">arconstructive</span>
          <nav aria-label="Main" className="flex items-center gap-1">
            {(
              [
                ["Projects", "#/"],
                ["New check", "#/check"],
                ["Code library", "#/library"],
              ] as const
            ).map(([label, href]) => (
              <a
                key={href}
                href={href}
                aria-current={href === "#/" ? "page" : undefined}
                className={`inline-flex h-11 items-center px-3 text-sm font-medium ${
                  href === "#/" ? "text-ink underline decoration-accent decoration-2 underline-offset-8" : "text-muted"
                } ${focusRing}`}
              >
                {label}
              </a>
            ))}
          </nav>
          <span className="hidden text-sm text-muted md:inline">Permit-set check · {CODE_CYCLE} California codes</span>
        </div>
      </header>
      {store && assistant && user ? (
        <Workspace store={store} assistant={assistant} user={user} canvas={canvas} />
      ) : (
        <main className="mx-auto max-w-[680px] px-4 py-16">
          <p className="text-base text-ink">The team workspace needs sign-in. Sign in with your team account to see the projects.</p>
        </main>
      )}
    </div>
  );
}
