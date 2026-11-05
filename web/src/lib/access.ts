/**
 * The dashboard is private to the team. Only the email addresses in
 * VITE_ALLOWED_EMAILS (comma separated) may use it once signed in.
 */
export function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export function isAllowedEmail(email: string | null | undefined, allowed: string[]): boolean {
  if (!email) return false;
  return allowed.includes(email.trim().toLowerCase());
}
