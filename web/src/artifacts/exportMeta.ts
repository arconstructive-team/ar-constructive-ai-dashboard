export interface ExportMeta {
  title: string;
  projectName: string;
  /** The date of the version that is exported. */
  date: Date;
  author: string;
  version: number;
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

/** A file name from the title: "Issue report: 428 El Rio" → "issue-report-428-el-rio-v3.pdf". */
export function exportFileName(meta: ExportMeta, extension: "pdf" | "docx"): string {
  const slug =
    meta.title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 80) || "artifact";
  return `${slug}-v${meta.version}.${extension}`;
}

/** The line under the title in both exports. */
export function metaLine(meta: ExportMeta): string {
  return [meta.projectName, formatDate(meta.date), meta.author ? `Prepared by ${meta.author}` : "", `Version ${meta.version}`]
    .filter(Boolean)
    .join("  ·  ");
}

export function downloadFile(data: Blob, fileName: string): void {
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
