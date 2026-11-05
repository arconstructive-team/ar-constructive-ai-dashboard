import { isSiteReport, type SiteReport } from "./types";

/**
 * The address of the team's API service (Cloud Run), the same one the chat uses. The Google
 * Maps key stays on that server: the browser only sends the address and loads signed image paths.
 */
export const SITE_API_URL = ((import.meta.env.VITE_CHAT_API_URL as string | undefined) ?? "").trim().replace(/\/+$/, "");

export interface SiteApi {
  /** Runs the site report pipeline for an address. */
  buildReport(address: string): Promise<SiteReport>;
  /** The image address for a signed image path from the report. */
  imageUrl(path: string): string;
}

export interface SiteApiOptions {
  baseUrl: string;
  /** The signed-in person's Firebase ID token. */
  getIdToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export function createSiteApi({ baseUrl, getIdToken, fetch: doFetch = (input, init) => fetch(input, init) }: SiteApiOptions): SiteApi {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return {
    imageUrl: (path) => `${base}${path}`,
    async buildReport(address) {
      if (!base) throw new Error("The site report service is not set up yet (VITE_CHAT_API_URL is empty).");
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again, then refresh the site info.");
      let res: Response;
      try {
        res = await doFetch(`${base}/api/site/report`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ address }),
        });
      } catch {
        throw new Error("The site report service could not be reached. Check the connection, then refresh.");
      }
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message = (body as { error?: unknown } | null)?.error;
        throw new Error(typeof message === "string" ? message : `The site report service answered with HTTP ${res.status}.`);
      }
      if (!isSiteReport(body)) throw new Error("The site report service sent an answer this page cannot read.");
      return body;
    },
  };
}
