import type { Artifact } from "./types";

/**
 * A sample issue report, used by the tests and the preview page to play a
 * generation. It is sample text in the shape the generator writes, not a real
 * check of the El Rio set.
 */
export const SAMPLE_REPORT_MD = `# Sample issue report: 428 El Rio Rd

## Summary

We read **52 sheets** of the permit set and found **4 issues** a plan checker would send back. Fix the two \`high\` items before you submit. The architect of record approves every change.

## Findings

| Sheet | Rule | Finding | Suggested fix |
| --- | --- | --- | --- |
| \`A-0.1\` | BP | General notes name another city's building department. | Replace the notes with the Town of Danville notes. |
| \`A-5.3\` | CY | Fire notes cite the 2022 California Fire Code. | Cite the 2025 California Fire Code. |
| \`A-1.0\` | AR | The site plan states 1,180 sq ft; the area plan states 1,212 sq ft. | Use one floor area on every sheet. |
| \`T-24\` | MS | The Title 24 report is not in the set. | Add the signed Title 24 report sheets. |

## Next steps

- [ ] Replace the general notes on \`A-0.1\`
- [ ] Update the code year on \`A-5.3\`
- [x] Confirm the floor area with the owner

## Method

1. Read the text of every page.
2. Sort the pages by sheet number.
3. Run the 2025 California code rules and the Danville rules.

> The architect of record approves every finding. We never stamp or sign sheets.
`;

export function sampleArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "sample-report",
    projectId: "sample-project",
    title: "Sample issue report: 428 El Rio Rd",
    kind: "issue_report",
    status: "ready",
    content: SAMPLE_REPORT_MD,
    version: 1,
    chatId: "sample-chat",
    updatedBy: "arconstructive",
    updatedAt: new Date("2026-11-05T15:00:00Z"),
    ...overrides,
  };
}
