// Who may use the chat: a signed-in Firebase user whose email is on the team list. The same
// list as the web app's sign-in (VITE_ALLOWED_EMAILS); the deploy passes it as ALLOWED_EMAILS.

export interface ChatUser {
  uid: string;
  email: string;
  name: string;
}

/** Checks a Firebase ID token and returns its claims. Throws when the token is not valid. */
export type VerifyToken = (token: string) => Promise<{ uid: string; email?: string; name?: string }>;

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

export async function authorize(
  header: string | undefined,
  verify: VerifyToken,
  allowedEmails: string[],
): Promise<ChatUser> {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!match) throw new AuthError(401, "Sign in to use the chat.");
  let claims: Awaited<ReturnType<VerifyToken>>;
  try {
    claims = await verify(match[1]!);
  } catch {
    throw new AuthError(401, "Your sign-in has expired. Sign in again.");
  }
  const email = claims.email?.trim().toLowerCase();
  // An empty team list lets nobody in.
  if (!email || !allowedEmails.includes(email)) {
    throw new AuthError(403, "This account is not on the team list.");
  }
  return { uid: claims.uid, email, name: claims.name?.trim() || email };
}
