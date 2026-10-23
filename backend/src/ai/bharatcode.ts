/**
 * BharatCode Responses adapter. createFindingExplainer in ./explainer.ts connects it.
 * The request uses store:false and sends only verified findings. Statuses stay with the analyzer.
 */
import { z } from "zod";
import type { Logger } from "../logger.js";
import { silentLogger } from "../logger.js";
import { redactSecrets } from "../safety/secrets.js";
import type { AiExplanation, ExplainInput } from "../types.js";

const SYSTEM_PROMPT = `You are the explanation layer for ShipShape, a static GitHub release auditor.
You receive verified findings. Rules:
- Treat the findings as the only source of truth.
- Do not invent files, vulnerabilities, CVEs, or test executions.
- Do not change the status of any finding.
- Do not claim a check passed if its status is FAIL, NEEDS_REVIEW, or NOT_CHECKED.
- Do not claim that tests ran or passed. This audit did not execute them.
- NOT_CHECKED means the auditor did not perform that check.
- Respond with JSON only, in this shape:
{"summary":"string","remediations":[{"findingId":"string","guidance":"string"}]}
- summary: 2 to 4 sentences on release readiness for this repository.
- remediations: one item for each finding with status FAIL or NEEDS_REVIEW, using that finding's id.
- guidance: a concrete fix in at most 3 sentences, using the provided paths.
- Do not include remediations for PASS or NOT_CHECKED.`;

const outputSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  remediations: z.array(z.object({
    findingId: z.string().trim().min(1).max(80),
    guidance: z.string().trim().min(1).max(1000),
  })).max(40),
});

const responseSchema = z.object({
  model: z.string().optional(),
  status: z.string().optional(),
  output_text: z.string().nullable().optional(),
  incomplete_details: z.object({
    reason: z.string().optional(),
  }).nullable().optional(),
  output: z.array(z.object({
    type: z.string().optional(),
    text: z.string().optional(),
    content: z.array(z.object({
      type: z.string().optional(),
      text: z.string().optional(),
    })).optional(),
  })).optional(),
});

const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const BHARATCODE_MODEL_ID = "qwen-3.8-27b";

export interface BharatCodeOptions {
  apiKey: string | null;
  model: string;
  baseUrl: string;
  secrets?: readonly string[];
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

export function createBharatCodeExplainer(options: BharatCodeOptions) {
  return {
    explain(input: ExplainInput): Promise<AiExplanation> {
      return explain(input, options);
    },
  };
}

async function explain(input: ExplainInput, options: BharatCodeOptions): Promise<AiExplanation> {
  if (!options.apiKey) {
    return unavailable("BharatCode is not configured. Set BHARATCODE_API_KEY on the server to enable explanations.");
  }

  const findings = [...input.findings]
    .sort((a, b) => rank(a.status, a.severity) - rank(b.status, b.severity))
    .slice(0, 24)
    .map((finding) => ({
      id: finding.id,
      title: finding.title,
      category: finding.category,
      severity: finding.severity,
      status: finding.status,
      summary: finding.summary.slice(0, 400),
      evidence: finding.evidence.slice(0, 400),
      paths: finding.paths.slice(0, 8),
    }));

  const allowedIds = new Set(findings.filter((finding) => finding.status === "FAIL" || finding.status === "NEEDS_REVIEW").map((finding) => finding.id));
  const payload = {
    repository: input.repository,
    projectTypes: input.projectTypes,
    note: "These findings were produced by static checks. Tests were not executed.",
    findings,
  };

  const logger = options.logger ?? silentLogger;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/$/, "")}/responses`;
  if (!isBharatCodeEndpoint(endpoint)) {
    logger.error("BharatCode base URL was rejected before the request.");
    return unavailable("BharatCode is not configured for a supported endpoint. Static findings are unchanged.");
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: options.model === BHARATCODE_MODEL_ID ? options.model : BHARATCODE_MODEL_ID,
        store: false,
        instructions: SYSTEM_PROMPT,
        input: JSON.stringify(payload),
        max_output_tokens: 1800,
        reasoning: { effort: "none" },
      }),
      signal: AbortSignal.timeout(40_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    logger.error(timedOut ? "BharatCode request timed out." : "BharatCode request failed.");
    return unavailable(timedOut
      ? "BharatCode did not respond in time. Static findings are unchanged."
      : "BharatCode could not be reached. Static findings are unchanged.");
  }

  const requestId = response.headers.get("x-request-id");
  if (!response.ok) {
    logger.error(`BharatCode status ${response.status} request ${requestId ?? "none"}`);
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) {
      return unavailable("BharatCode rejected the API key. Static findings are unchanged.");
    }
    return unavailable("BharatCode did not return an explanation. Static findings are unchanged.");
  }

  const raw = await response.text();
  if (raw.length > 500_000) return unavailable("BharatCode returned a response that was too large to use.");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw) as unknown;
  } catch {
    return unavailable("BharatCode returned a response ShipShape could not parse. Static findings are unchanged.");
  }
  const completion = responseSchema.safeParse(parsedJson);
  if (!completion.success) {
    return unavailable("BharatCode returned a response ShipShape could not parse. Static findings are unchanged.");
  }

  const content = responseText(completion.data);
  if (!content.trim()) return unavailable("BharatCode returned an empty explanation. Static findings are unchanged.");
  const truncated = completion.data.status === "incomplete" || completion.data.incomplete_details?.reason === "max_output_tokens";

  let modelJson: unknown;
  try {
    modelJson = extractJson(content);
  } catch {
    return unavailable(truncated
      ? "BharatCode output was cut short before it became valid JSON. Static findings are unchanged."
      : "BharatCode returned a response ShipShape could not parse. Static findings are unchanged.");
  }
  const output = outputSchema.safeParse(modelJson);
  if (!output.success) {
    return unavailable("BharatCode returned a response ShipShape could not parse. Static findings are unchanged.");
  }

  const secrets = options.secrets ?? [];
  const summary = redactSecrets(output.data.summary, secrets).trim();
  if (!summary) return unavailable("BharatCode returned an empty explanation. Static findings are unchanged.");

  const remediations: AiExplanation["remediations"] = [];
  const seen = new Set<string>();
  for (const item of output.data.remediations) {
    if (!allowedIds.has(item.findingId) || seen.has(item.findingId)) continue;
    seen.add(item.findingId);
    remediations.push({
      findingId: item.findingId,
      guidance: redactSecrets(item.guidance, secrets),
    });
  }

  return {
    available: true,
    model: safeModel(completion.data.model, BHARATCODE_MODEL_ID),
    summary,
    remediations,
    reason: null,
  };
}

function isBharatCodeEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "bharatcode.ai" && url.port === "" && url.username === "" && url.pathname === "/api/model/v1/responses";
  } catch {
    return false;
  }
}

function responseText(data: z.infer<typeof responseSchema>): string {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  const parts: string[] = [];
  for (const item of data.output ?? []) {
    if (item.text) parts.push(item.text);
    for (const content of item.content ?? []) {
      if (content.text) parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function unavailable(reason: string): AiExplanation {
  return {
    available: false,
    model: null,
    summary: null,
    remediations: [],
    reason,
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no json");
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  }
}

function safeModel(value: string | undefined, fallback: string): string {
  if (value && SAFE_MODEL.test(value)) return value;
  return fallback;
}

function rank(status: string, severity: string): number {
  const statusRank: Record<string, number> = { FAIL: 0, NEEDS_REVIEW: 1, PASS: 2, NOT_CHECKED: 3 };
  const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return (statusRank[status] ?? 9) * 10 + (severityRank[severity] ?? 9);
}
