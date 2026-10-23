import { describe, expect, it } from "vitest";
import { filterFindings, formatCount, formatTimestamp, normalizeApiBase, sortFindings, statusLabel, statusNote } from "../src/lib/presentation";
import type { Severity, Status } from "../src/types";

describe("presentation", () => {
  it("uses the four release statuses as labels", () => {
    expect(statusLabel("PASS")).toBe("PASS");
    expect(statusLabel("FAIL")).toBe("FAIL");
    expect(statusLabel("NOT_CHECKED")).toBe("NOT CHECKED");
    expect(statusLabel("NEEDS_REVIEW")).toBe("NEEDS REVIEW");
    expect(statusNote("FAIL")).toContain("medium");
    expect(statusNote("NOT_CHECKED")).toContain("did not");
  });

  it("sorts failures ahead of passes and can filter them", () => {
    const findings: Array<{ id: string; status: Status; severity: Severity }> = [
      { id: "pass", status: "PASS", severity: "info" },
      { id: "low-fail", status: "FAIL", severity: "low" },
      { id: "high-fail", status: "FAIL", severity: "high" },
      { id: "review", status: "NEEDS_REVIEW", severity: "low" },
      { id: "unchecked", status: "NOT_CHECKED", severity: "info" },
    ];
    expect(sortFindings(findings).map((finding) => finding.id)).toEqual(["high-fail", "low-fail", "review", "pass", "unchecked"]);
    expect(filterFindings(findings, "FAIL").map((finding) => finding.id)).toEqual(["low-fail", "high-fail"]);
  });

  it("formats counts and rejects unsafe API bases", () => {
    expect(formatCount(1200)).toBe("1,200");
    expect(formatTimestamp(null)).toBe("Unknown");
    expect(formatTimestamp("not-a-date")).toBe("Unknown");
    expect(normalizeApiBase(undefined)).toBe("");
    expect(normalizeApiBase("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787");
    expect(normalizeApiBase("javascript:alert(1)")).toBe("");
    expect(normalizeApiBase("https://user:pass@example.com")).toBe("");
  });
});
