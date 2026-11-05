import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { isAllowedEmail } from "../lib/access";
import { allowedEmails, auth, authConfigured } from "./firebase";

type GateState =
  | { kind: "loading" }
  | { kind: "signed-out"; message?: string }
  | { kind: "signed-in"; user: User };

const NOT_ON_TEAM =
  "This account is not on the arconstructive team. Ask the team owner to add your email, then sign in again.";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const inputBase =
  "h-11 w-full rounded-control border border-border bg-surface px-3 text-base text-ink focus:border-accent " +
  focusRing;

/**
 * Shows the app only to signed-in team members. There is no sign-up form:
 * team accounts are added by the team owner.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!auth) return;
    const authInstance = auth;
    return onAuthStateChanged(authInstance, (user) => {
      if (!user) {
        setState((prev) => (prev.kind === "signed-out" ? prev : { kind: "signed-out" }));
        return;
      }
      if (!isAllowedEmail(user.email, allowedEmails)) {
        void signOut(authInstance);
        setState({ kind: "signed-out", message: NOT_ON_TEAM });
        return;
      }
      setState({ kind: "signed-in", user });
    });
  }, []);

  if (!authConfigured || !auth) {
    return (
      <Shell>
        <p className="text-base text-ink">Sign-in is not set up for this copy of the dashboard yet.</p>
      </Shell>
    );
  }

  const authInstance = auth;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      let message = "Sign-in failed. Try again.";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        message = "The email or password is not correct.";
      } else if (code === "auth/admin-restricted-operation" || code === "auth/user-disabled") {
        message = NOT_ON_TEAM;
      } else if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        message = "The Google window closed before sign-in finished.";
      }
      setState({ kind: "signed-out", message });
    } finally {
      setBusy(false);
    }
  }

  function onPasswordSubmit(event: FormEvent) {
    event.preventDefault();
    void run(() => signInWithEmailAndPassword(authInstance, email.trim(), password));
  }

  if (state.kind === "loading") {
    return (
      <Shell>
        <p className="text-base text-muted">Checking your sign-in…</p>
      </Shell>
    );
  }

  if (state.kind === "signed-in") {
    return (
      <>
        <div className="flex items-center justify-end gap-3 border-b border-border bg-surface px-4 py-2 text-sm text-muted">
          <span>{state.user.email}</span>
          <button
            type="button"
            className={"rounded-control px-2 py-1 text-ink underline " + focusRing}
            onClick={() => void signOut(authInstance)}
          >
            Sign out
          </button>
        </div>
        {children}
      </>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-ink">Sign in to arconstructive</h1>
      <p className="mt-2 text-sm text-muted">This dashboard is for the arconstructive team only.</p>
      {state.message && (
        <p role="alert" className="mt-4 rounded-control border border-danger px-3 py-2 text-sm text-danger">
          {state.message}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        className={
          "mt-6 h-11 w-full rounded-control bg-accent px-4 text-base font-medium text-on-accent disabled:opacity-60 " +
          focusRing
        }
        onClick={() => void run(() => signInWithPopup(authInstance, new GoogleAuthProvider()))}
      >
        Sign in with Google
      </button>
      <form className="mt-6 space-y-3" onSubmit={onPasswordSubmit}>
        <label className="block text-sm text-ink">
          Email
          <input
            type="email"
            autoComplete="email"
            required
            className={inputBase + " mt-1"}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="block text-sm text-ink">
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            className={inputBase + " mt-1"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className={
            "h-11 w-full rounded-control border border-border bg-surface px-4 text-base font-medium text-ink disabled:opacity-60 " +
            focusRing
          }
        >
          Sign in with email
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6">{children}</div>
    </main>
  );
}
