import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { GithubError } from "../src/github/client.js";
import { silentLogger } from "../src/logger.js";
import type { AiExplanation, ExplainInput, RepoSnapshot } from "../src/types.js";
import { makeSnapshot } from "./fixtures.js";

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 8787,
    host: "127.0.0.1",
    corsOrigin: "http://localhost:5173",
    githubToken: "ghp_testtoken123",
    bharatcodeApiKey: "bc_live_supersecretvalue",
    bharatcodeModel: "qwen-3.8-27b",
    bharatcodeBaseUrl: "https://bharatcode.ai/api/model/v1",
    rateLimitMax: 20,
    rateLimitWindowMs: 60_000,
    ...overrides,
  };
}

describe("audit API", () => {
  let loadRepository: ReturnType<typeof vi.fn<(owner: string, repo: string) => Promise<RepoSnapshot>>>;
  let explain: ReturnType<typeof vi.fn<(input: ExplainInput) => Promise<AiExplanation>>>;

  beforeEach(() => {
    loadRepository = vi.fn<(owner: string, repo: string) => Promise<RepoSnapshot>>();
    explain = vi.fn<(input: ExplainInput) => Promise<AiExplanation>>();
  });

  function app(overrides: Partial<AppConfig> = {}) {
    return createApp(testConfig(overrides), {
      loadRepository,
      explain,
    }, { logger: silentLogger });
  }

  it("returns a static report and does not leak snapshot text or server secrets", async () => {
    const snapshot = makeSnapshot({
      paths: ["package.json"],
      texts: {
        "package.json": JSON.stringify({ name: "widget", scripts: {}, secretMarker: "SUPER_SECRET_SENTINEL_9f3a" }),
        ".env": "AWS_SECRET_ACCESS_KEY=trapvalue123",
      },
      license: null,
      latestRelease: null,
    });
    loadRepository.mockResolvedValue(snapshot);
    explain.mockResolvedValue({
      available: true,
      model: "qwen-3.8-27b",
      summary: "Add a README and a license.",
      remediations: [
        { findingId: "readme", guidance: "Add README.md at the repository root." },
        { findingId: "not-a-real-check", guidance: "Ignore me." },
      ],
      reason: null,
    });

    const response = await request(app()).post("/api/audit").send({ repositoryUrl: "https://github.com/acme/widget" });

    expect(response.status).toBe(200);
    expect(response.body.repository.url).toBe("https://github.com/acme/widget");
    expect(response.body.summary.status).toBe("FAIL");
    expect(response.body.limitations.join(" ")).toContain("were not run");
    const readme = response.body.findings.find((finding: { id: string }) => finding.id === "readme");
    expect(readme.status).toBe("FAIL");
    expect(readme.guidance).toContain("README.md");
    expect(response.body.findings.some((finding: { id: string }) => finding.id === "not-a-real-check")).toBe(false);
    expect(loadRepository).toHaveBeenCalledWith("acme", "widget");
    const sent = explain.mock.calls[0]?.[0];
    expect(JSON.stringify(sent)).not.toContain("trapvalue123");
    expect(JSON.stringify(sent)).not.toContain("SUPER_SECRET_SENTINEL_9f3a");
    expect(JSON.stringify(response.body)).not.toContain("trapvalue123");
    expect(JSON.stringify(response.body)).not.toContain("SUPER_SECRET_SENTINEL_9f3a");
    expect(JSON.stringify(response.body)).not.toContain("bc_live_supersecretvalue");
    expect(JSON.stringify(response.body)).not.toContain("ghp_testtoken123");
  });

  it("rejects non-GitHub and non-root URLs before loading a repository", async () => {
    const client = app();
    const blocked = [
      "http://169.254.169.254/latest/meta-data",
      "https://github.com/acme/widget/tree/main",
      "https://evil.example/acme/widget",
      "http://127.0.0.1:8787/admin",
    ];
    for (const repositoryUrl of blocked) {
      const response = await request(client).post("/api/audit").send({ repositoryUrl });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("INVALID_REPOSITORY_URL");
    }
    expect(loadRepository).not.toHaveBeenCalled();
    expect(explain).not.toHaveBeenCalled();
  });

  it("maps private and missing repositories and still returns findings if explanation throws", async () => {
    loadRepository.mockRejectedValueOnce(new GithubError("ShipShape only audits public repositories.", "private"));
    const forbidden = await request(app()).post("/api/audit").send({ repositoryUrl: "https://github.com/acme/widget" });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe("PRIVATE_REPOSITORY");
    expect(explain).not.toHaveBeenCalled();

    loadRepository.mockRejectedValueOnce(new GithubError("That repository was not found or is not public.", "not_found"));
    const missing = await request(app()).post("/api/audit").send({ repositoryUrl: "https://github.com/acme/missing" });
    expect(missing.status).toBe(404);

    loadRepository.mockResolvedValueOnce(makeSnapshot({ paths: ["README.md"] }));
    explain.mockRejectedValueOnce(new Error("socket hang up"));
    const recovered = await request(app()).post("/api/audit").send({ repositoryUrl: "https://github.com/acme/widget" });
    expect(recovered.status).toBe(200);
    expect(recovered.body.ai.available).toBe(false);
    expect(recovered.body.findings.length).toBeGreaterThan(0);
  });

  it("rejects invalid JSON and limits repeated audits", async () => {
    const response = await request(app())
      .post("/api/audit")
      .set("Content-Type", "application/json")
      .send("{");
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_JSON");

    const limited = app({ rateLimitMax: 1 });
    loadRepository.mockResolvedValue(makeSnapshot({ paths: ["README.md"] }));
    explain.mockResolvedValue({ available: false, model: null, summary: null, remediations: [], reason: "off" });
    const first = await request(limited).post("/api/audit").send({ repositoryUrl: "https://github.com/acme/widget" });
    const second = await request(limited).post("/api/audit").send({ repositoryUrl: "https://github.com/acme/widget" });
    const health = await request(limited).get("/api/health");
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("RATE_LIMITED");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true });
  });
});
