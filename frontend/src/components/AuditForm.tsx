import type { FormEvent } from "react";

interface AuditFormProps {
  url: string;
  loading: boolean;
  onUrl: (value: string) => void;
  onExample: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function AuditForm({ url, loading, onUrl, onExample, onSubmit }: AuditFormProps) {
  return (
    <form onSubmit={onSubmit} className="rounded-md border border-line bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-brass uppercase">Inspection desk</p>
          <h2 className="mt-1 font-serif text-3xl text-ink">Paste a public repository</h2>
        </div>
        <button
          type="button"
          onClick={onExample}
          className="text-sm font-medium text-navy underline decoration-brass decoration-2 underline-offset-4"
        >
          Use expressjs/express
        </button>
      </div>
      <label htmlFor="repository-url" className="mt-5 block text-sm font-medium">
        GitHub repository URL
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <input
          id="repository-url"
          name="repositoryUrl"
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          placeholder="https://github.com/owner/repo"
          value={url}
          onChange={(event) => onUrl(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-3 text-base text-ink"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md border-b-4 border-brass bg-navy px-5 py-3 font-semibold text-paper disabled:cursor-wait disabled:opacity-70"
        >
          {loading ? "Inspecting…" : "Run inspection"}
        </button>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-mute">
        ShipShape reads the repository through the GitHub API and checks manifests, lockfiles, workflows, and test configuration.
        It does not install dependencies, run tests, or execute repository code.
      </p>
    </form>
  );
}
