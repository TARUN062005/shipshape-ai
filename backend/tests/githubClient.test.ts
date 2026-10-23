import { describe, expect, it, vi } from "vitest";
import { GithubError, createGithubClient } from "../src/github/client.js";
import { silentLogger } from "../src/logger.js";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const packageJson = JSON.stringify({ name: "widget", scripts: { test: "vitest run" }, secretMarker: "SUPER_SECRET_SENTINEL_9f3a" });

function route(url: string): string {
  const parsed = new URL(url);
  expect(parsed.protocol).toBe("https:");
  expect(parsed.hostname).toBe("api.github.com");
  expect(parsed.port).toBe("");
  expect(parsed.username).toBe("");
  return parsed.pathname;
}

describe("createGithubClient", () => {
  it("reads public metadata and allowlisted files without fetching secrets", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      const pathname = route(url);
      expect(init?.redirect).toBe("manual");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer ghp_testtoken123");
      if (pathname.endsWith("/git/trees/main")) {
        return json({
          truncated: false,
          tree: [
            { path: "README.md", type: "blob" },
            { path: "package.json", type: "blob" },
            { path: ".env", type: "blob" },
            { path: "src/secret.txt", type: "blob" },
            { path: "../escape", type: "blob" },
            { path: "docs", type: "tree" },
          ],
        });
      }
      if (pathname.endsWith("/releases")) {
        return json([{ tag_name: "v1.0.0", name: "one", draft: false, prerelease: false }]);
      }
      if (pathname.includes("/contents/package.json")) {
        return json({
          type: "file",
          encoding: "base64",
          size: packageJson.length,
          content: Buffer.from(packageJson).toString("base64"),
        });
      }
      if (pathname === "/repos/acme/widget") {
        return json({
          private: false,
          description: "Widget",
          default_branch: "main",
          stargazers_count: 4,
          forks_count: 1,
          language: "TypeScript",
          archived: false,
          pushed_at: "2026-10-01T00:00:00Z",
          open_issues_count: 2,
          license: { spdx_id: "MIT" },
        });
      }
      return json({ message: "unexpected" }, 500);
    });

    const client = createGithubClient({ token: "ghp_testtoken123", fetchImpl, logger: silentLogger });
    const snapshot = await client.loadRepository("acme", "widget");

    expect(snapshot.owner).toBe("acme");
    expect(snapshot.repo).toBe("widget");
    expect(snapshot.license).toBe("MIT");
    expect(snapshot.latestRelease?.tag).toBe("v1.0.0");
    expect(snapshot.paths).toContain("package.json");
    expect(snapshot.paths).toContain(".env");
    expect(snapshot.paths).not.toContain("../escape");
    expect(snapshot.ignoredPathCount).toBe(1);
    expect(snapshot.texts["package.json"]).toContain("vitest run");
    expect(snapshot.texts[".env"]).toBeUndefined();
    expect(calls.some((url) => url.includes("/contents/.env"))).toBe(false);
    expect(calls.some((url) => url.includes("secret.txt"))).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain("ghp_testtoken123");
  });

  it("stops before reading a private repository", async () => {
    const fetchImpl = vi.fn(async () => json({
      private: true,
      default_branch: "main",
      description: "hidden",
    }));
    const client = createGithubClient({ token: null, fetchImpl, logger: silentLogger });
    await expect(client.loadRepository("acme", "widget")).rejects.toMatchObject({ code: "private" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps a missing repository and a rate limit", async () => {
    const missing = createGithubClient({
      token: null,
      logger: silentLogger,
      fetchImpl: vi.fn(async () => json({ message: "Not Found" }, 404)),
    });
    await expect(missing.loadRepository("acme", "missing")).rejects.toBeInstanceOf(GithubError);

    const limited = createGithubClient({
      token: null,
      logger: silentLogger,
      fetchImpl: vi.fn(async () => json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0" })),
    });
    await expect(limited.loadRepository("acme", "widget")).rejects.toMatchObject({ code: "rate_limit" });
  });

  it("does not follow a redirect off api.github.com", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(new URL(String(input)).hostname).toBe("api.github.com");
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } });
    });
    const client = createGithubClient({ token: null, fetchImpl, logger: silentLogger });
    await expect(client.loadRepository("acme", "widget")).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports an empty repository", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname.endsWith("/git/trees/main")) return json({ message: "Git Repository is empty." }, 409);
      return json({ private: false, default_branch: "main", description: null });
    });
    const client = createGithubClient({ token: null, fetchImpl, logger: silentLogger });
    await expect(client.loadRepository("acme", "widget")).rejects.toMatchObject({ code: "empty" });
  });

  it("rejects an owner that is not a single GitHub name", async () => {
    const fetchImpl = vi.fn();
    const client = createGithubClient({ token: null, fetchImpl, logger: silentLogger });
    await expect(client.loadRepository("acme/evil", "widget")).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
