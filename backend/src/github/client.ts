import { z } from "zod";
import type { Logger } from "../logger.js";
import { silentLogger } from "../logger.js";
import { isSafeRepoPath } from "../safety/repoPath.js";
import type { ReleaseInfo, RepoSnapshot } from "../types.js";
import { parseRepositoryUrl } from "../validation/repositoryUrl.js";

export type GithubErrorCode = "not_found" | "private" | "rate_limit" | "empty" | "unavailable";

export class GithubError extends Error {
  readonly code: GithubErrorCode;

  constructor(message: string, code: GithubErrorCode) {
    super(message);
    this.name = "GithubError";
    this.code = code;
  }
}

export interface GithubClientOptions {
  token: string | null;
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

const CONTENT_FILES = new Set(["package.json", "pyproject.toml", ".gitignore"]);
const MAX_PATHS = 5000;
const MAX_TREE_CHARS = 5_000_000;
const MAX_META_CHARS = 500_000;
const MAX_CONTENT_CHARS = 400_000;
const MAX_TEXT_CHARS = 200_000;

const repoSchema = z.object({
  private: z.boolean(),
  description: z.string().nullable().optional(),
  default_branch: z.string().min(1),
  stargazers_count: z.number().optional(),
  forks_count: z.number().optional(),
  language: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  pushed_at: z.string().nullable().optional(),
  open_issues_count: z.number().optional(),
  license: z.object({ spdx_id: z.string().nullable().optional() }).nullable().optional(),
});

const treeSchema = z.object({
  truncated: z.boolean().optional(),
  tree: z.array(z.object({
    path: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
});

const releasesSchema = z.array(z.object({
  tag_name: z.string().optional(),
  name: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
}));

const contentSchema = z.object({
  type: z.string().optional(),
  encoding: z.string().optional(),
  size: z.number().optional(),
  content: z.string().optional(),
});

export function createGithubClient(options: GithubClientOptions) {
  return {
    loadRepository(owner: string, repo: string): Promise<RepoSnapshot> {
      return loadRepository(owner, repo, options);
    },
  };
}

async function loadRepository(owner: string, repo: string, options: GithubClientOptions): Promise<RepoSnapshot> {
  const parsed = parseRepositoryUrl(`https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger ?? silentLogger;
  const repoUrl = apiPath(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`);
  const repoResponse = await githubFetch(repoUrl, options.token, fetchImpl, logger);
  if (repoResponse.status === 404) {
    await repoResponse.body?.cancel();
    throw new GithubError("That repository was not found or is not public.", "not_found");
  }
  if (!repoResponse.ok) throw await toGithubError(repoResponse);

  const repoJson = repoSchema.safeParse(await readJson(repoResponse, MAX_META_CHARS));
  if (!repoJson.success) throw new GithubError("GitHub returned a response ShipShape could not understand.", "unavailable");
  if (repoJson.data.private) throw new GithubError("ShipShape only audits public repositories.", "private");

  const branch = cleanBranch(repoJson.data.default_branch);
  const treeUrl = apiPath(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const releasesUrl = apiPath(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/releases?per_page=5`);

  const [treeResult, releaseResult] = await Promise.all([
    fetchTree(treeUrl, options.token, fetchImpl, logger),
    fetchReleases(releasesUrl, options.token, fetchImpl, logger),
  ]);

  const wanted = CONTENT_FILES;
  const readable = treeResult.paths.filter((path) => wanted.has(path));
  const texts: Record<string, string> = {};
  const omittedTexts: string[] = [];
  await Promise.all(readable.map(async (path) => {
    const encoded = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
    const url = apiPath(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/contents/${encoded}?ref=${encodeURIComponent(branch)}`);
    const text = await fetchTextFile(url, options.token, fetchImpl, logger);
    if (text === null) omittedTexts.push(path);
    else texts[path] = text;
  }));

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    description: cleanText(repoJson.data.description, 280),
    defaultBranch: branch,
    stars: count(repoJson.data.stargazers_count),
    forks: count(repoJson.data.forks_count),
    language: cleanText(repoJson.data.language, 60),
    license: normalizeLicense(repoJson.data.license?.spdx_id),
    archived: repoJson.data.archived === true,
    pushedAt: cleanDate(repoJson.data.pushed_at),
    openIssues: count(repoJson.data.open_issues_count),
    latestRelease: releaseResult.latestRelease,
    releaseLookup: releaseResult.releaseLookup,
    treeTruncated: treeResult.truncated,
    ignoredPathCount: treeResult.ignoredPathCount,
    paths: treeResult.paths,
    texts,
    omittedTexts,
  };
}

async function fetchTree(url: string, token: string | null, fetchImpl: typeof fetch, logger: Logger) {
  const response = await githubFetch(url, token, fetchImpl, logger);
  if (response.status === 409) {
    await response.body?.cancel();
    throw new GithubError("That repository has no commits to inspect yet.", "empty");
  }
  if (response.status === 404) {
    await response.body?.cancel();
    throw new GithubError("That repository was not found or is not public.", "not_found");
  }
  if (!response.ok) throw await toGithubError(response);
  const parsed = treeSchema.safeParse(await readJson(response, MAX_TREE_CHARS));
  if (!parsed.success) throw new GithubError("GitHub returned a response ShipShape could not understand.", "unavailable");

  const paths: string[] = [];
  let ignoredPathCount = 0;
  let truncated = parsed.data.truncated === true;
  for (const entry of parsed.data.tree ?? []) {
    if (entry.type !== "blob" || !entry.path) continue;
    if (!isSafeRepoPath(entry.path)) {
      ignoredPathCount += 1;
      continue;
    }
    if (paths.length >= MAX_PATHS) {
      truncated = true;
      break;
    }
    paths.push(entry.path);
  }
  return { paths, truncated, ignoredPathCount };
}

async function fetchReleases(
  url: string,
  token: string | null,
  fetchImpl: typeof fetch,
  logger: Logger,
): Promise<{ latestRelease: ReleaseInfo | null; releaseLookup: "ok" | "failed" }> {
  try {
    const response = await githubFetch(url, token, fetchImpl, logger);
    if (!response.ok) {
      const error = await toGithubError(response);
      if (error.code === "rate_limit") throw error;
      return { latestRelease: null, releaseLookup: "failed" };
    }
    const parsed = releasesSchema.safeParse(await readJson(response, MAX_META_CHARS));
    if (!parsed.success) return { latestRelease: null, releaseLookup: "failed" };
    for (const release of parsed.data) {
      if (release.draft) continue;
      const tag = cleanTag(release.tag_name);
      if (!tag) continue;
      return {
        latestRelease: {
          tag,
          name: cleanText(release.name, 120),
          prerelease: release.prerelease === true,
        },
        releaseLookup: "ok",
      };
    }
    return { latestRelease: null, releaseLookup: "ok" };
  } catch (error) {
    if (error instanceof GithubError && error.code === "rate_limit") throw error;
    if (error instanceof GithubError && error.code === "unavailable" && /left api\.github\.com/.test(error.message)) throw error;
    return { latestRelease: null, releaseLookup: "failed" };
  }
}

async function fetchTextFile(url: string, token: string | null, fetchImpl: typeof fetch, logger: Logger): Promise<string | null> {
  try {
    const response = await githubFetch(url, token, fetchImpl, logger);
    if (!response.ok) return null;
    const raw = await response.text();
    if (raw.length > MAX_CONTENT_CHARS) return null;
    const parsed = contentSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.type !== "file") return null;
    if (parsed.data.size !== undefined && parsed.data.size > MAX_TEXT_CHARS) return null;
    if (!parsed.data.content) return null;
    if (parsed.data.encoding === "base64") {
      const decoded = Buffer.from(parsed.data.content.replace(/\s/g, ""), "base64").toString("utf8");
      return decoded.length > MAX_TEXT_CHARS ? null : decoded;
    }
    return parsed.data.content.length > MAX_TEXT_CHARS ? null : parsed.data.content;
  } catch (error) {
    if (error instanceof GithubError && (error.code === "rate_limit" || /left api\.github\.com/.test(error.message))) throw error;
    return null;
  }
}

function apiPath(path: string): string {
  return `https://api.github.com${path}`;
}

async function githubFetch(url: string, token: string | null, fetchImpl: typeof fetch, logger: Logger): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 3; hop += 1) {
    assertGithubApi(current);
    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        headers: githubHeaders(token),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      logger.error(`GitHub request failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
      throw new GithubError("GitHub could not be reached for this repository.", "unavailable");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new GithubError("GitHub could not be reached for this repository.", "unavailable");
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  throw new GithubError("GitHub could not be reached for this repository.", "unavailable");
}

function assertGithubApi(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GithubError("Refusing a GitHub response that left api.github.com.", "unavailable");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.github.com" || parsed.port || parsed.username || parsed.password) {
    throw new GithubError("Refusing a GitHub response that left api.github.com.", "unavailable");
  }
  if (!parsed.pathname.startsWith("/repos/")) {
    throw new GithubError("Refusing an unexpected GitHub path.", "unavailable");
  }
}

function githubHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "shipshape-ai",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readJson(response: Response, maxChars: number): Promise<unknown> {
  const text = await response.text();
  if (text.length > maxChars) throw new GithubError("GitHub response was too large to inspect safely.", "unavailable");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GithubError("GitHub returned a response ShipShape could not understand.", "unavailable");
  }
}

async function toGithubError(response: Response): Promise<GithubError> {
  const message = await readErrorMessage(response);
  if (isRateLimit(response.status, message, response.headers)) {
    return new GithubError("GitHub rate limit was reached. Set GITHUB_TOKEN on the server and try again.", "rate_limit");
  }
  if (response.status === 404) return new GithubError("That repository was not found or is not public.", "not_found");
  if (response.status === 401) return new GithubError("GitHub rejected the server token. Check GITHUB_TOKEN.", "unavailable");
  if (response.status === 409) return new GithubError("That repository has no commits to inspect yet.", "empty");
  return new GithubError("GitHub could not be reached for this repository.", "unavailable");
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text.length > 1000) return "";
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !("message" in parsed)) return "";
    const message = (parsed as { message?: unknown }).message;
    return typeof message === "string" ? message.slice(0, 200) : "";
  } catch {
    return "";
  }
}

function isRateLimit(status: number, message: string, headers: Headers): boolean {
  if (status === 429) return true;
  if ((status === 403 || status === 429) && headers.get("x-ratelimit-remaining") === "0") return true;
  return /rate limit/i.test(message);
}

function cleanBranch(value: string): string {
  if (value.length > 250 || value.includes("..") || value.startsWith("/") || /[\u0000-\u001F\u007F\\?#%\s]/.test(value)) {
    throw new GithubError("GitHub returned a response ShipShape could not understand.", "unavailable");
  }
  return value;
}

function cleanText(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, max);
}

function cleanDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function cleanTag(value: string | undefined): string | null {
  if (!value) return null;
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!clean || clean.length > 100) return null;
  return clean;
}

function normalizeLicense(spdx: string | null | undefined): string | null {
  if (!spdx || spdx === "NOASSERTION" || spdx === "OTHER") return null;
  if (!/^[A-Za-z0-9.+-]{1,40}$/.test(spdx)) return null;
  return spdx;
}

function count(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), 100_000_000);
}
