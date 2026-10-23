import type { Severity, Status } from "../types";

const STATUS_ORDER: Record<Status, number> = {
  FAIL: 0,
  NEEDS_REVIEW: 1,
  PASS: 2,
  NOT_CHECKED: 3,
};

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function statusLabel(status: Status): string {
  switch (status) {
    case "PASS":
      return "PASS";
    case "FAIL":
      return "FAIL";
    case "NOT_CHECKED":
      return "NOT CHECKED";
    case "NEEDS_REVIEW":
      return "NEEDS REVIEW";
  }
}

export function statusNote(status: Status): string {
  switch (status) {
    case "PASS":
      return "No medium, high, or critical check failed. Not-checked items were not verified.";
    case "FAIL":
      return "At least one medium, high, or critical check failed.";
    case "NEEDS_REVIEW":
      return "Nothing medium or higher failed, but open items still need a person.";
    case "NOT_CHECKED":
      return "The auditor did not have enough information to judge this repository.";
  }
}

export function projectLabel(type: string): string {
  switch (type) {
    case "node":
      return "Node.js";
    case "python":
      return "Python";
    case "go":
      return "Go";
    case "rust":
      return "Rust";
    case "java":
      return "Java";
    default:
      return type;
  }
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatTimestamp(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function sortFindings<T extends { status: Status; severity: Severity }>(findings: readonly T[]): T[] {
  return [...findings].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });
}

export function filterFindings<T extends { status: Status }>(findings: readonly T[], filter: Status | "ALL"): T[] {
  if (filter === "ALL") return [...findings];
  return findings.filter((finding) => finding.status === filter);
}

/** Same-origin when unset. Ignores non-http values so a bad build env cannot retarget the browser. */
export function normalizeApiBase(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return "";
    const path = url.pathname.replace(/\/$/, "");
    return `${url.origin}${path === "/" ? "" : path}`;
  } catch {
    return "";
  }
}
