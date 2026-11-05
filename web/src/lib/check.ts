import { runEngine, type EngineResult } from "./engine";
import type { ProjectData } from "./project";

export type CheckSet = (file: File, project: ProjectData) => Promise<EngineResult>;

/**
 * Checks a permit set. With VITE_API_URL set, the API reads the PDF and runs the rules.
 * Without it (the demo), the browser reads the PDF and runs the same rules locally.
 */
export const checkPermitSet: CheckSet = async (file, project) => {
  const api = import.meta.env.VITE_API_URL as string | undefined;
  if (api) {
    const query = new URLSearchParams({
      jurisdiction: project.jurisdiction,
      aduType: project.aduType,
      address: project.address.trim(),
    });
    const res = await fetch(`${api.replace(/\/$/, "")}/api/check?${query}`, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: file,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `The check service answered ${res.status}. Try again.`);
    }
    return (await res.json()) as EngineResult;
  }
  const { extractPagesInBrowser } = await import("./pdf");
  const pages = await extractPagesInBrowser(file);
  return runEngine(pages, {
    jurisdiction: project.jurisdiction,
    aduType: project.aduType,
    address: project.address.trim(),
  });
};
