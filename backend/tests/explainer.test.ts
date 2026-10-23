import { describe, expect, it, vi } from "vitest";
import { createDeferredExplainer, createFindingExplainer } from "../src/ai/explainer.js";
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
  ],
};

describe("createDeferredExplainer", () => {
  it("returns static findings without calling a model", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const result = await createDeferredExplainer().explain(input);
      expect(result).toEqual({
        available: false,
        model: null,
        summary: null,
        remediations: [],
        reason: "BharatCode is not configured. Set BHARATCODE_API_KEY on the server to enable explanations.",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("createFindingExplainer", () => {
  it("uses the deferred explainer when credentials are missing", async () => {
    const fetchImpl = vi.fn();
    const result = await createFindingExplainer({
      apiKey: null,
      model: "qwen-3.8-27b",
      baseUrl: "https://bharatcode.ai/api/model/v1",
      fetchImpl,
    }).explain(input);
    expect(result.available).toBe(false);
    expect(result.reason).toContain("BHARATCODE_API_KEY");
    expect(result.remediations).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(input.findings[0]?.status).toBe("FAIL");
  });

  it("delegates to BharatCode when a key is configured", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: "qwen-3.8-27b",
      status: "completed",
      output_text: "{\"summary\":\"Add a README.\",\"remediations\":[{\"findingId\":\"readme\",\"status\":\"PASS\",\"guidance\":\"Create README.md.\"}]}",
    }), { status: 200 }));
    const result = await createFindingExplainer({
      apiKey: "bc_live_supersecretvalue",
      model: "qwen-3.8-27b",
      baseUrl: "https://bharatcode.ai/api/model/v1",
      secrets: ["bc_live_supersecretvalue"],
      fetchImpl,
    }).explain(input);
    expect(result.available).toBe(true);
    expect(result.remediations).toEqual([{ findingId: "readme", guidance: "Create README.md." }]);
    expect(input.findings[0]?.status).toBe("FAIL");
    expect(JSON.stringify(result)).not.toContain("bc_live_supersecretvalue");
  });
});
