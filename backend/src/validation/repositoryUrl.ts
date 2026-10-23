import { isIP } from "node:net";

export interface ParsedRepository {
  owner: string;
  repo: string;
  url: string;
}

export class RepositoryUrlError extends Error {
  readonly code = "INVALID_REPOSITORY_URL" as const;

  constructor(message: string) {
    super(message);
    this.name = "RepositoryUrlError";
  }
}

const GENERIC = "Only https://github.com/owner/repo URLs are accepted.";

/**
 * Parse a repository URL. Callers must fetch GitHub with the owner and repo
 * fields only. The original string is never used as a request URL.
 */
export function parseRepositoryUrl(input: string): ParsedRepository {
  if (typeof input !== "string") throw new RepositoryUrlError("Enter a GitHub repository URL.");
  const trimmed = input.trim();
  if (!trimmed) throw new RepositoryUrlError("Enter a GitHub repository URL.");
  if (trimmed.length > 300) throw new RepositoryUrlError("That URL is too long.");
  if (/[\u0000-\u001F\u007F\s]/.test(trimmed)) throw new RepositoryUrlError(GENERIC);
  if (!/^https:\/\//i.test(trimmed)) throw new RepositoryUrlError(GENERIC);

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new RepositoryUrlError(GENERIC);
  }

  if (url.protocol !== "https:") throw new RepositoryUrlError(GENERIC);
  if (url.username || url.password) throw new RepositoryUrlError(GENERIC);
  if (url.port) throw new RepositoryUrlError(GENERIC);

  let hostname = url.hostname.toLowerCase();
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  const ipHost = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (isIP(ipHost) !== 0 || isIP(hostname) !== 0) throw new RepositoryUrlError(GENERIC);
  if (hostname !== "github.com" && hostname !== "www.github.com") throw new RepositoryUrlError(GENERIC);
  if (url.pathname.includes("//")) throw new RepositoryUrlError(GENERIC);

  const rawSegments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (rawSegments.length !== 2) {
    throw new RepositoryUrlError(
      rawSegments.length > 2
        ? "Paste the repository root URL, not a file or branch link."
        : GENERIC,
    );
  }

  const decoded = rawSegments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      throw new RepositoryUrlError("That owner or repository name is not valid on GitHub.");
    }
  });

  const owner = decoded[0] ?? "";
  let repo = decoded[1] ?? "";
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  if (!isValidOwner(owner) || !isValidRepo(repo)) {
    throw new RepositoryUrlError("That owner or repository name is not valid on GitHub.");
  }

  return {
    owner,
    repo,
    url: `https://github.com/${owner}/${repo}`,
  };
}

function isValidOwner(owner: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner);
}

function isValidRepo(repo: string): boolean {
  if (repo === "." || repo === "..") return false;
  return /^[A-Za-z0-9._-]{1,100}$/.test(repo);
}
