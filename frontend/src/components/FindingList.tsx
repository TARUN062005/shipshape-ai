import type { Finding, Status } from "../types";
import { filterFindings, sortFindings, statusLabel } from "../lib/presentation";
import { StatusMark } from "./StatusMark";

const FILTERS: Array<Status | "ALL"> = ["ALL", "FAIL", "NEEDS_REVIEW", "PASS", "NOT_CHECKED"];

interface FindingListProps {
  findings: Finding[];
  filter: Status | "ALL";
  onFilter: (filter: Status | "ALL") => void;
}

export function FindingList({ findings, filter, onFilter }: FindingListProps) {
  const ordered = sortFindings(findings);
  const visible = filterFindings(ordered, filter);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-serif text-2xl">Findings</h2>
        <div role="group" aria-label="Filter findings" className="flex flex-wrap gap-2">
          {FILTERS.map((item) => {
            const count = item === "ALL" ? findings.length : findings.filter((finding) => finding.status === item).length;
            const selected = filter === item;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={selected}
                onClick={() => onFilter(item)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${selected ? "border-navy bg-navy text-paper" : "border-line bg-card text-ink"}`}
              >
                {item === "ALL" ? "ALL" : statusLabel(item)} {count}
              </button>
            );
          })}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-mute">No findings in this view.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {visible.map((finding) => (
            <li key={finding.id} data-status={finding.status} className="finding rounded-md border border-line border-l-4 bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusMark status={finding.status} />
                <span className="text-xs font-semibold tracking-wide text-mute uppercase">{finding.severity}</span>
                <span className="text-xs text-mute">{finding.category}</span>
              </div>
              <h3 className="mt-2 text-lg font-semibold">{finding.title}</h3>
              <p className="mt-1 text-sm leading-6">{finding.summary}</p>
              <p className="mt-3 rounded bg-paper px-3 py-2 font-mono text-xs leading-5 text-ink">{finding.evidence}</p>
              {finding.paths.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {finding.paths.map((filePath) => (
                    <li key={filePath} className="rounded border border-line bg-paper px-2 py-1 font-mono text-xs">
                      {filePath}
                    </li>
                  ))}
                </ul>
              ) : null}
              {finding.guidance ? (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="text-xs font-semibold tracking-[0.14em] text-brass uppercase">BharatCode</p>
                  <p className="mt-1 text-sm leading-6">{finding.guidance}</p>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
