export const PROJECT_TYPES = ["node", "python", "go", "rust", "java"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const STATUSES = ["PASS", "FAIL", "NOT_CHECKED", "NEEDS_REVIEW"] as const;
export type Status = (typeof STATUSES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = [
  "repository",
  "structure",
  "dependencies",
  "tests",
  "release",
  "security",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Finding {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  status: Status;
  summary: string;
  evidence: string;
  paths: string[];
}

export interface ReleaseInfo {
  tag: string;
  name: string | null;
  prerelease: boolean;
}

/**
 * Facts read from the public GitHub API. Text contents are an analyzer input
 * only and must not be copied into the API response.
 */
export interface RepoSnapshot {
  owner: string;
  repo: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  archived: boolean;
  pushedAt: string | null;
  openIssues: number;
  latestRelease: ReleaseInfo | null;
  releaseLookup: "ok" | "failed";
  treeTruncated: boolean;
  ignoredPathCount: number;
  paths: string[];
  texts: Record<string, string>;
  omittedTexts: string[];
}

export interface Summary {
  status: Status;
  score: number;
  applicable: number;
  counts: Record<Status, number>;
}

export interface Analysis {
  projectTypes: ProjectType[];
  findings: Finding[];
  summary: Summary;
}

export interface PublicFinding extends Finding {
  guidance: string | null;
}

export interface AuditRepository {
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
  latestRelease: ReleaseInfo | null;
}

export interface AiExplanation {
  available: boolean;
  model: string | null;
  summary: string | null;
  remediations: Array<{ findingId: string; guidance: string }>;
  reason: string | null;
}

export interface ExplainInput {
  repository: string;
  projectTypes: ProjectType[];
  findings: Array<
    Pick<Finding, "id" | "title" | "category" | "severity" | "status" | "summary" | "evidence" | "paths">
  >;
}

export interface AuditReport {
  checkedAt: string;
  repository: AuditRepository;
  projectTypes: ProjectType[];
  summary: Summary;
  findings: PublicFinding[];
  ai: {
    available: boolean;
    model: string | null;
    summary: string | null;
    reason: string | null;
  };
  limitations: string[];
}
