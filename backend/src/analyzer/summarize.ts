import type { Finding, Status, Summary } from "../types.js";

const BLOCKING = new Set(["critical", "high", "medium"]);

export function summarizeFindings(findings: readonly Finding[]): Summary {
  const counts: Record<Status, number> = {
    PASS: 0,
    FAIL: 0,
    NOT_CHECKED: 0,
    NEEDS_REVIEW: 0,
  };
  for (const finding of findings) counts[finding.status] += 1;

  const applicable = counts.PASS + counts.FAIL + counts.NEEDS_REVIEW;
  const score = applicable === 0 ? 0 : Math.round((counts.PASS / applicable) * 100);
  const blocking = findings.some(
    (finding) => finding.status === "FAIL" && BLOCKING.has(finding.severity),
  );
  const held =
    findings.some((finding) => finding.status === "FAIL" || finding.status === "NEEDS_REVIEW");

  let status: Status;
  if (blocking) status = "FAIL";
  else if (applicable === 0 || held) status = "NEEDS_REVIEW";
  else status = "PASS";

  return { status, score, applicable, counts };
}
