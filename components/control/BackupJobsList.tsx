import { shortDate } from "@/lib/format";

// What the founder has asked a box to do, and what came back.
//
// It exists because the whole feature is asynchronous by design: a click writes
// a row and the box collects it on its next poll (~5 min), because sofra holds
// no credential that can reach a box (ADR-012 invariant 2). Without this list a
// request would simply vanish for five minutes, and the natural response to that
// is to click again.

type Translator = (key: string, values?: Record<string, string | number>) => string;

export type JobRow = {
  id: string;
  box: string;
  action: string;
  tenantSlug: string;
  status: string;
  ref: string | null;
  error: string | null;
  createdAt: Date;
  requestedBy: { name: string } | null;
};

function statusTone(status: string): string {
  if (status === "DONE") return "text-craft-success-text dark:text-craft-success";
  if (status === "FAILED") return "text-craft-error-text dark:text-craft-error";
  return "text-muted-foreground";
}

export default function BackupJobsList({
  jobs,
  t,
}: Readonly<{ jobs: JobRow[]; t: Translator }>) {
  if (jobs.length === 0) {
    return <p className="font-label text-muted-foreground">{t("jobs.empty")}</p>;
  }
  return (
    <ul className="grid gap-2">
      {jobs.map((j) => (
        <li key={j.id} className="hand-drawn-border bg-card p-4 font-label text-sm">
          <span className="font-bold">{t(`jobs.action.${j.action}`)}</span>{" "}
          <span>{j.tenantSlug}</span>
          <span className="text-muted-foreground"> · {j.box} · {shortDate(j.createdAt)}</span>
          <span className={`ml-3 ${statusTone(j.status)}`}>{t(`jobs.status.${j.status}`)}</span>
          {/* The requester's NAME, never their email — CLAUDE.md §5.8, and a name
              is what identifies a person to the one operator who reads this. */}
          {j.requestedBy && (
            <span className="block text-muted-foreground">
              {t("jobs.requestedBy", { name: j.requestedBy.name })}
            </span>
          )}
          {j.error && (
            <span role="alert" className="block text-craft-error-text">
              {t("jobs.failed", { error: j.error })}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
