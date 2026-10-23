export type ProjectType = "node" | "python" | "go" | "rust" | "java";
export type Status = "PASS" | "FAIL" | "NOT_CHECKED" | "NEEDS_REVIEW";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Finding {
  id: string;
  title: string;
  category: "repository" | "structure" | "dependencies" | "tests" | "release" | "security";
  severity: Severity;
  status: Status;
  summary: string;
  evidence: string;
  paths: string[];
  guidance: string | null;
}

export interface AuditReport {
  checkedAt: string;
  repository: {
    owner: string;
    repo: string;
    url: string;
    description: string | null;
    defaultBranch: string;
    stars: number;
    forks: number;
    language: string | null;
    license: string | null;
    archived: boolean;
    pushedAt: string | null;
    openIssues: number;
    latestRelease: { tag: string; name: string | null; prerelease: boolean } | null;
  };
  projectTypes: ProjectType[];
  summary: {
    status: Status;
    score: number;
    applicable: number;
    counts: Record<Status, number>;
  };
  findings: Finding[];
  ai: {
    available: boolean;
    model: string | null;
    summary: string | null;
    reason: string | null;
  };
  limitations: string[];
}
