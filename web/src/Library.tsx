import { useMemo, useState } from "react";
import { AlertCircle, ExternalLink, Search } from "lucide-react";
import { CODE_LIBRARY, groupLibrary, validateLibrary, type CodeLibraryData, type CodeSection } from "./lib/engine";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function matches(s: CodeSection, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [s.id, s.code, s.part, s.section, s.title, s.label, s.summary].some((v) => v.toLowerCase().includes(q));
}

function SourceLink(props: { href: string; name: string; children?: string }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1 text-sm text-accent-2 underline underline-offset-2 ${focusRing}`}
    >
      {props.children ?? "Official source"}
      <span className="sr-only"> for {props.name} (opens in a new tab)</span>
      <ExternalLink aria-hidden className="size-3.5" strokeWidth={1.5} />
    </a>
  );
}

/**
 * The code library: every code section a rule or a regenerated sheet cites, by jurisdiction and
 * code part, with each pack's edition and last-checked date. The data lives in the repository
 * (api/src/engine/library/data.ts); this page only reads it.
 */
export function Library(props: { data?: CodeLibraryData }) {
  const data = props.data ?? CODE_LIBRARY;
  const [query, setQuery] = useState("");
  const problems = useMemo(() => validateLibrary(data), [data]);
  const shown = useMemo(() => data.sections.filter((s) => matches(s, query)), [data, query]);
  const groups = useMemo(() => groupLibrary(shown, data.packs), [shown, data]);

  return (
    <section aria-labelledby="library-title" className="grid content-start gap-8">
      <div className="max-w-[680px]">
        <p className="text-xs font-medium text-muted">Code library · version {data.version}</p>
        <h1 id="library-title" className="mt-2 font-display text-[32px] font-semibold leading-[1.1] md:text-[40px]">
          Code library
        </h1>
        <p className="mt-4 text-lg text-muted">
          Every code section our rules and regenerated sheets cite, with a link to the official source. For the
          ICC, NFPA and IAPMO codes and the municipal codes we store only the section number, the title and our own
          summary. Open the official source to read the exact words.
        </p>
      </div>

      {problems.length > 0 && (
        <div role="alert" className="flex items-start gap-3 border-l-4 border-danger pl-4">
          <AlertCircle aria-hidden className="mt-1 size-5 shrink-0 text-danger" strokeWidth={1.5} />
          <div>
            <p className="font-semibold">The code library has {problems.length} data {problems.length === 1 ? "problem" : "problems"}.</p>
            <ul className="mt-1 grid list-disc gap-1 pl-5 text-sm text-muted">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ul aria-label="Code packs" className="grid gap-4 md:grid-cols-2">
        {data.packs.map((pack) => {
          const count = data.sections.filter((s) => s.pack === pack.id).length;
          return (
            <li key={pack.id} className="grid content-start gap-2 rounded-card border border-border bg-surface p-4">
              <p className="text-xs font-medium text-muted">{pack.jurisdiction}</p>
              <p className="font-display text-lg font-semibold leading-[1.25]">{pack.name}</p>
              <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">Edition</dt>
                <dd>{pack.edition}</dd>
                <dt className="text-muted">In effect from</dt>
                <dd>{pack.effective}</dd>
                <dt className="text-muted">Last checked</dt>
                <dd>{pack.last_checked}</dd>
                <dt className="text-muted">Sections</dt>
                <dd>{count}</dd>
              </dl>
              <p className="text-sm text-muted">{pack.check_note}</p>
              <SourceLink href={pack.source_url} name={pack.name} />
            </li>
          );
        })}
      </ul>

      <div className="grid gap-2">
        <label htmlFor="library-filter" className="text-sm font-medium">
          Find a section
        </label>
        <div className="relative max-w-[480px]">
          <Search aria-hidden className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted" strokeWidth={1.5} />
          <input
            id="library-filter"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="For example R314, smoke alarms or ADU"
            className={`h-11 w-full rounded-control border border-border bg-surface pr-3 pl-9 text-base text-ink focus:border-accent ${focusRing}`}
          />
        </div>
        <p aria-live="polite" className="text-sm text-muted">
          {shown.length} of {data.sections.length} sections
        </p>
      </div>

      {data.sections.length === 0 ? (
        <p className="text-muted">The code library has no sections yet.</p>
      ) : groups.length === 0 ? (
        <div className="grid justify-items-start gap-3">
          <p className="text-muted">No section matches “{query.trim()}”.</p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className={`inline-flex h-11 items-center justify-center rounded-control border border-border bg-surface px-6 text-[15px] font-semibold text-ink ${focusRing}`}
          >
            Clear the filter
          </button>
        </div>
      ) : (
        <div className="grid gap-10">
          {groups.map((group) => (
            <section key={group.pack.id} aria-labelledby={`pack-${group.pack.id}`} className="grid gap-6">
              <h2 id={`pack-${group.pack.id}`} className="border-b border-border pb-2 font-display text-2xl font-semibold leading-[1.25]">
                {group.jurisdiction}
                <span className="ml-2 text-sm font-normal text-muted">
                  {group.pack.edition} · checked {group.pack.last_checked}
                </span>
              </h2>
              {group.parts.map((part) => (
                <section key={part.part} aria-label={`${group.jurisdiction}: ${part.part}`} className="grid gap-2">
                  <h3 className="font-display text-lg font-semibold">{part.part}</h3>
                  <ul className="divide-y divide-border border-y border-border">
                    {part.sections.map((s) => (
                      <li
                        key={s.id}
                        className="grid gap-1 py-3 md:grid-cols-[220px_minmax(0,1fr)_160px] md:gap-4"
                      >
                        <span className="text-sm font-medium">{s.label}</span>
                        <span className="text-sm">
                          <span className="font-medium">{s.title}.</span> <span className="text-muted">{s.summary}</span>
                          <span className="block text-xs text-muted">
                            Edition {s.edition} · checked {s.last_checked} · id {s.id}
                          </span>
                        </span>
                        <span className="md:text-right">
                          <SourceLink href={s.source_url} name={s.label} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
