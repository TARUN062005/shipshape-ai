import { describe, expect, it, vi } from "vitest";
import { createBharatCodeExplainer } from "../src/ai/bharatcode.js";
import { silentLogger } from "../src/logger.js";
import type { ExplainInput } from "../src/types.js";

const input: ExplainInput = {
  repository: "acme/widget",
  projectTypes: ["node"],
  findings: [
    {
      id: "readme",
      title: "README",
      category: "structure",
      severity: "medium",
      status: "FAIL",
      summary: "No README was found.",
      evidence: "Expected README.md.",
      paths: [],
    },
    {
      id: "license",
      title: "License",
      category: "repository",
      severity: "info",
      status: "PASS",
      summary: "License found.",
      evidence: "Found LICENSE.",
      paths: ["LICENSE"],
    },
  ],
};

const options = {
  apiKey: "bc_live_supersecretvalue",
  model: "qwen-3.8-27b",
  baseUrl: "https://bharatcode.ai/api/model/v1",
  secrets: ["bc_live_supersecretvalue"],
  logger: silentLogger,
};

describe("createBharatCodeExplainer", () => {
  it("does not call BharatCode when the key is missing", async () => {
    const fetchImpl = vi.fn();
    const explain = createBharatCodeExplainer({ ...options, apiKey: null, fetchImpl }).explain;
    const result = await explain(input);
    expect(result.available).toBe(false);
    expect(result.reason).toContain("BHARATCODE_API_KEY");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends verified findings and drops invented remediations", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://bharatcode.ai/api/model/v1/responses");
      expect(init?.redirect).toBe("error");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer bc_live_supersecretvalue");
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        store: boolean;
        instructions: string;
        input: string;
        reasoning: { effort: string };
      };
      expect(body.model).toBe("qwen-3.8-27b");
      expect(body.store).toBe(false);
      expect(body.reasoning.effort).toBe("none");
      expect(body.instructions).toContain("Do not invent");
      expect(body.instructions).toContain("Do not claim that tests ran");
      expect(body.input).toContain("readme");
      expect(body.input).toContain("Tests were not executed");
      expect(body.input).not.toContain("package.json");
      expect(JSON.stringify(body)).not.toContain("bc_live_supersecretvalue");
      return new Response(JSON.stringify({
        model: "qwen-3.8-27b",
        status: "completed",
        output_text: "```json\n{\"summary\":\"Add a README before release. The key is bc_live_supersecretvalue.\",\"remediations\":[{\"findingId\":\"readme\",\"status\":\"PASS\",\"guidance\":\"Create README.md. Token bc_live_supersecretvalue.\"},{\"findingId\":\"invented\",\"guidance\":\"Scan for CVE-2020-0000.\"},{\"findingId\":\"license\",\"guidance\":\"Already passed.\"}]}\n```",
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await createBharatCodeExplainer({ ...options, model: "other-model", fetchImpl }).explain(input);
    expect(result.available).toBe(true);
    expect(result.model).toBe("qwen-3.8-27b");
    expect(result.summary).toContain("[redacted]");
    expect(result.summary).not.toContain("bc_live_supersecretvalue");
    expect(result.remediations).toEqual([{ findingId: "readme", guidance: "Create README.md. Token [redacted]." }]);
    expect(JSON.stringify(result)).not.toContain("\"status\":\"PASS\"");
    expect(input.findings.find((finding) => finding.id === "readme")?.status).toBe("FAIL");
  });

  it("reads explanation text from the Responses output array", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: "qwen-3.8-27b",
      output: [{ content: [{ type: "output_text", text: "{\"summary\":\"Add a README.\",\"remediations\":[{\"findingId\":\"readme\",\"guidance\":\"Create README.md.\"}]}" }] }],
    }), { status: 200 }));
    const result = await createBharatCodeExplainer({ ...options, fetchImpl }).explain(input);
    expect(result.available).toBe(true);
    expect(result.remediations).toEqual([{ findingId: "readme", guidance: "Create README.md." }]);
  });

  it("keeps static findings usable when the model response is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      status: "completed",
      output_text: "Looks fine to me.",
    }), { status: 200 }));
    const result = await createBharatCodeExplainer({ ...options, fetchImpl }).explain(input);
    expect(result.available).toBe(false);
    expect(result.reason).toContain("could not parse");
    expect(result.remediations).toEqual([]);
  });

  it("reports an authentication failure without including the key", async () => {
    const logs: string[] = [];
    const fetchImpl = vi.fn(async () => new Response("nope bc_live_supersecretvalue", { status: 401 }));
    const result = await createBharatCodeExplainer({
      ...options,
      logger: { error(message: string) { logs.push(message); } },
      fetchImpl,
    }).explain(input);
    expect(result.available).toBe(false);
    expect(result.reason).toContain("rejected the API key");
    expect(JSON.stringify(result)).not.toContain("bc_live_supersecretvalue");
    expect(logs.join("\n")).not.toContain("bc_live_supersecretvalue");
  });

  it("does not send the key to an unsupported endpoint", async () => {
    const fetchImpl = vi.fn();
    const result = await createBharatCodeExplainer({
      ...options,
      baseUrl: "https://evil.example/api/model/v1",
      fetchImpl,
    }).explain(input);
    expect(result.available).toBe(false);
    expect(result.reason).toContain("supported endpoint");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("bc_live_supersecretvalue");
  });

  it("reports a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    const result = await createBharatCodeExplainer({ ...options, fetchImpl }).explain(input);
    expect(result.available).toBe(false);
    expect(result.reason).toContain("could not be reached");
  });
});
