import type { AuditReport, Status } from "../types";
import { formatCount, formatTimestamp, projectLabel, statusLabel, statusNote } from "../lib/presentation";
import { FindingList } from "./FindingList";
import { StatusMark } from "./StatusMark";

interface ReportViewProps {
  report: AuditReport;
  filter: Status | "ALL";
  onFilter: (filter: Status | "ALL") => void;
}

export function ReportView({ report, filter, onFilter }: ReportViewProps) {
  const { repository, summary } = report;
  const score = Math.max(0, Math.min(100, summary.score));

  return (
    <section aria-live="polite" className="mt-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-brass uppercase">Inspection log</p>
          <h2 className="mt-1 font-serif text-4xl">
            <a href={repository.url} className="underline decoration-line decoration-2 underline-offset-4">{repository.owner}/{repository.repo}</a>
          </h2>
          {repository.description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-mute">{repository.description}</p> : null}
        </div>
        <p className="text-sm text-mute">Checked {formatTimestamp(report.checkedAt)}</p>
      </div>

      <dl className="mt-4 flex flex-wrap gap-2 text-xs text-mute">
        {(report.projectTypes.length > 0 ? report.projectTypes.map(projectLabel) : ["Unrecognized"]).map((label) => (
          <span key={label} className="rounded-full border border-brass px-2 py-1 font-semibold text-brass">{label}</span>
        ))}
        <Meta label="Branch" value={repository.defaultBranch} />
        <Meta label="Stars" value={formatCount(repository.stars)} />
        <Meta label="License" value={repository.license ?? "None detected"} />
        <Meta label="Language" value={repository.language ?? "Unknown"} />
        <Meta label="Release" value={repository.latestRelease ? repository.latestRelease.tag : "None"} />
        <Meta label="Last push" value={formatTimestamp(repository.pushedAt)} />
      </dl>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <article data-status={summary.status} className="status-plate rounded-md border border-line bg-card p-4 md:col-span-2">
          <p className="text-xs font-semibold tracking-[0.16em] text-mute uppercase">Release status</p>
          <p className="mt-2 font-serif text-5xl">{statusLabel(summary.status)}</p>
          <p className="mt-2 text-sm leading-6">{statusNote(summary.status)}</p>
        </article>
        <article className="rounded-md border border-line bg-card p-4">
          <p className="text-xs font-semibold tracking-[0.16em] text-mute uppercase">Check score</p>
          <p className="mt-2 font-serif text-5xl">{score}</p>
          <div
            role="meter"
            aria-label="Check score"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={score}
            className="mt-3 h-2 rounded bg-line"
          >
            <div className="h-2 rounded bg-navy" style={{ width: `${score}%` }} />
          </div>
          <p className="mt-2 text-sm leading-5 text-mute">
            {summary.counts.PASS} of {summary.applicable} applicable checks passed. Not checked is excluded.
          </p>
        </article>
        <article className="rounded-md border border-line bg-card p-4">
          <p className="text-xs font-semibold tracking-[0.16em] text-mute uppercase">Counts</p>
          <ul className="mt-3 space-y-2 text-sm">
            <Count status="FAIL" count={summary.counts.FAIL} />
            <Count status="NEEDS_REVIEW" count={summary.counts.NEEDS_REVIEW} />
            <Count status="PASS" count={summary.counts.PASS} />
            <Count status="NOT_CHECKED" count={summary.counts.NOT_CHECKED} />
          </ul>
        </article>
      </div>

      <aside className="mt-4 rounded-md border border-line bg-card p-4">
        <p className="text-xs font-semibold tracking-[0.16em] text-brass uppercase">AI explanations</p>
        {report.ai.available && report.ai.summary ? (
          <>
            <p className="mt-2 text-sm leading-6">{report.ai.summary}</p>
            {report.ai.model ? <p className="mt-2 text-xs text-mute">Model {report.ai.model}. Explanations are tied to the findings below.</p> : null}
          </>
        ) : (
          <p className="mt-2 text-sm leading-6 text-mute">{report.ai.reason ?? "No explanation was returned. The statuses above are from static checks."}</p>
        )}
      </aside>

      <FindingList findings={report.findings} filter={filter} onFilter={onFilter} />

      <section className="mt-8">
        <h2 className="font-serif text-2xl">What this report does not claim</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-mute">
          {report.limitations.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-card px-2 py-1">
      <dt className="inline font-semibold text-ink">{label}</dt>
      <dd className="inline"> {value}</dd>
    </div>
  );
}

function Count({ status, count }: { status: Status; count: number }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <StatusMark status={status} />
      <span className="font-semibold">{count}</span>
    </li>
  );
}
