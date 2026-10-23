import { useEffect, useState, type FormEvent } from "react";
import { AuditClientError, fetchHealth, requestAudit } from "./api";
import { AuditForm } from "./components/AuditForm";
import { ReportView } from "./components/ReportView";
import { statusLabel } from "./lib/presentation";
import type { AuditReport, Status } from "./types";

const EXAMPLE_URL = "https://github.com/expressjs/express";
const STATUSES: Status[] = ["PASS", "FAIL", "NOT_CHECKED", "NEEDS_REVIEW"];

export function App() {
  const [url, setUrl] = useState(() => new URLSearchParams(window.location.search).get("repo") ?? "");
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [filter, setFilter] = useState<Status | "ALL">("ALL");

  useEffect(() => {
    let cancelled = false;
    fetchHealth().then((ok) => {
      if (!cancelled) setOnline(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const next = await requestAudit(url);
      setReport(next);
      setFilter("ALL");
      setOnline(true);
      document.title = `ShipShape · ${next.repository.owner}/${next.repository.repo}`;
    } catch (caught) {
      const message = caught instanceof AuditClientError ? caught.message : "The audit could not be completed.";
      setError(message);
      if (message.includes("not reachable")) setOnline(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="bg-navy text-paper">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-brass uppercase">Harbor inspection</p>
            <h1 className="font-serif text-4xl">ShipShape</h1>
          </div>
          <p className="max-w-md text-sm leading-6 text-paper/80">Public GitHub repositories. Static checks. BharatCode explains the result.</p>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {online === false ? (
          <p role="status" className="mb-4 rounded-md border border-review bg-[#f8efd8] px-4 py-3 text-sm text-review">
            The API is not reachable at /api/health. From the repository root, run npm run dev.
          </p>
        ) : null}
        <AuditForm
          url={url}
          loading={loading}
          onUrl={setUrl}
          onExample={() => setUrl(EXAMPLE_URL)}
          onSubmit={onSubmit}
        />
        <section className="mt-4 grid gap-2 sm:grid-cols-4" aria-label="Status legend">
          {STATUSES.map((status) => (
            <p key={status} className="rounded border border-line bg-card px-3 py-2 text-xs leading-5">
              <span className="font-semibold">{statusLabel(status)}</span>
              <span className="text-mute"> {legend(status)}</span>
            </p>
          ))}
        </section>
        {error ? <p role="alert" className="mt-4 rounded-md border border-fail bg-[#fbeceb] px-4 py-3 text-sm text-fail">{error}</p> : null}
        {loading ? <p className="mt-6 text-sm text-mute">Checking the public repository. This does not run its tests.</p> : null}
        {report ? <ReportView report={report} filter={filter} onFilter={setFilter} /> : null}
      </main>
    </div>
  );
}

function legend(status: Status): string {
  switch (status) {
    case "PASS":
      return "is a confirmed signal.";
    case "FAIL":
      return "is a confirmed problem.";
    case "NEEDS_REVIEW":
      return "needs a person, or the file list was incomplete.";
    case "NOT_CHECKED":
      return "was not performed.";
  }
}
