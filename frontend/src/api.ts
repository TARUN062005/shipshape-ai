import type { AuditReport } from "./types";
import { normalizeApiBase } from "./lib/presentation";

export class AuditClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditClientError";
  }
}

export function apiBase(): string {
  return normalizeApiBase(import.meta.env.VITE_API_BASE_URL);
}

export async function fetchHealth(base = apiBase()): Promise<boolean> {
  try {
    const response = await fetch(`${base}/api/health`, { headers: { Accept: "application/json" } });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return Boolean(body && typeof body === "object" && "ok" in body && (body as { ok?: unknown }).ok === true);
  } catch {
    return false;
  }
}

export async function requestAudit(repositoryUrl: string, base = apiBase()): Promise<AuditReport> {
  let response: Response;
  try {
    response = await fetch(`${base}/api/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ repositoryUrl }),
    });
  } catch {
    throw new AuditClientError("The ShipShape API is not reachable. Start the backend and try again.");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error.slice(0, 300)
      : "The audit could not be completed.";
    throw new AuditClientError(message);
  }
  if (!isAuditReport(payload)) throw new AuditClientError("The API returned an unexpected report.");
  return payload;
}

function isAuditReport(value: unknown): value is AuditReport {
  if (!value || typeof value !== "object") return false;
  const record = value as { findings?: unknown; summary?: unknown; repository?: unknown; limitations?: unknown };
  return Array.isArray(record.findings) && Array.isArray(record.limitations) && typeof record.summary === "object" && record.summary !== null && typeof record.repository === "object" && record.repository !== null;
}
