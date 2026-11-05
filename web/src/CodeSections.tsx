import { ExternalLink } from "lucide-react";
import type { Citation } from "./lib/engine";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Cited code sections, each with a link to the official source. */
export function CodeSections(props: { citations: Citation[]; label?: string }) {
  const { citations, label = "Code sections" } = props;
  if (citations.length === 0) {
    return <p className="text-sm text-muted">{label}: none stored for this rule yet.</p>;
  }
  return (
    <div className="text-sm">
      <p className="font-medium">{label}:</p>
      <ul aria-label={label} className="mt-1 grid gap-1">
        {citations.map((c) => (
          <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{c.label}</span>
            <span className="text-muted">{c.title}</span>
            <a
              href={c.source_url}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center gap-1 text-accent-2 underline underline-offset-2 ${focusRing}`}
            >
              Official source
              <span className="sr-only"> for {c.label} (opens in a new tab)</span>
              <ExternalLink aria-hidden className="size-3.5" strokeWidth={1.5} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
