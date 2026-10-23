import { ZodError } from "zod";
import { GithubError } from "../github/client.js";
import { RepositoryUrlError } from "../validation/repositoryUrl.js";

export interface MappedError {
  status: number;
  code: string;
  message: string;
  log: string;
}

export function mapError(err: unknown): MappedError {
  if (err instanceof ZodError) {
    return {
      status: 400,
      code: "INVALID_REQUEST",
      message: "Send a JSON object with a repositoryUrl string.",
      log: "invalid request",
    };
  }
  if (err instanceof RepositoryUrlError) {
    return { status: 400, code: err.code, message: err.message, log: err.message };
  }
  if (err instanceof GithubError) {
    return {
      status: githubStatus(err.code),
      code: githubCode(err.code),
      message: err.message,
      log: err.message,
    };
  }
  if (isHttpError(err, 400)) {
    return { status: 400, code: "INVALID_JSON", message: "Request body must be valid JSON.", log: "invalid json" };
  }
  if (isHttpError(err, 413)) {
    return { status: 413, code: "PAYLOAD_TOO_LARGE", message: "Request body is too large.", log: "payload too large" };
  }
  const detail = err instanceof Error ? err.message : "unknown error";
  return { status: 500, code: "INTERNAL", message: "The audit could not be completed.", log: detail.slice(0, 300) };
}

function githubStatus(code: GithubError["code"]): number {
  switch (code) {
    case "not_found":
      return 404;
    case "private":
      return 403;
    case "rate_limit":
      return 429;
    case "empty":
      return 422;
    case "unavailable":
      return 502;
  }
}

function githubCode(code: GithubError["code"]): string {
  switch (code) {
    case "not_found":
      return "NOT_FOUND";
    case "private":
      return "PRIVATE_REPOSITORY";
    case "rate_limit":
      return "GITHUB_RATE_LIMITED";
    case "empty":
      return "EMPTY_REPOSITORY";
    case "unavailable":
      return "GITHUB_UNAVAILABLE";
  }
}

function isHttpError(err: unknown, status: number): boolean {
  if (!(err instanceof SyntaxError) && status === 400) return false;
  if (!err || typeof err !== "object" || !("status" in err)) return false;
  return (err as { status?: unknown }).status === status;
}
