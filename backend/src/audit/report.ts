import { AUDIT_LIMITATIONS } from "../constants.js";
import type { AiExplanation, Analysis, AuditReport, RepoSnapshot } from "../types.js";

export function buildAuditReport(input: {
  snapshot: RepoSnapshot;
  analysis: Analysis;
  ai: AiExplanation;
  checkedAt: string;
}): AuditReport {
  const guidance = new Map<string, string>();
  for (const item of input.ai.remediations) {
    if (!guidance.has(item.findingId)) guidance.set(item.findingId, item.guidance);
  }

  const snapshot = input.snapshot;
  return {
    checkedAt: input.checkedAt,
    repository: {
      owner: snapshot.owner,
      repo: snapshot.repo,
      url: `https://github.com/${snapshot.owner}/${snapshot.repo}`,
      description: snapshot.description,
      defaultBranch: snapshot.defaultBranch,
      stars: snapshot.stars,
      forks: snapshot.forks,
      language: snapshot.language,
      license: snapshot.license,
      archived: snapshot.archived,
      pushedAt: snapshot.pushedAt,
      openIssues: snapshot.openIssues,
      latestRelease: snapshot.latestRelease,
    },
    projectTypes: input.analysis.projectTypes,
    summary: input.analysis.summary,
    findings: input.analysis.findings.map((finding) => ({
      id: finding.id,
      title: finding.title,
      category: finding.category,
      severity: finding.severity,
      status: finding.status,
      summary: finding.summary,
      evidence: finding.evidence,
      paths: finding.paths,
      guidance: guidance.get(finding.id) ?? null,
    })),
    ai: {
      available: input.ai.available,
      model: input.ai.model,
      summary: input.ai.summary,
      reason: input.ai.reason,
    },
    limitations: [...AUDIT_LIMITATIONS],
  };
}
